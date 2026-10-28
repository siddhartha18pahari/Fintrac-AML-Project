const encoder = new TextEncoder();

export function latin(value: string): string {
  return value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "?");
}

function escapePdf(value: string): string {
  return latin(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function flattenDocument(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}: []`];
    return value.flatMap((item, index) => flattenDocument(item, `${prefix}[${index + 1}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
      const label = prefix ? `${prefix}.${key}` : key;
      if (item && typeof item === "object") return flattenDocument(item, label);
      return [`${label}: ${item ?? ""}`];
    });
  }
  return [`${prefix}: ${value ?? ""}`];
}

export function linesToPdf(lines: string[]): Uint8Array {
  const wrapped: string[] = [];
  for (const line of lines) {
    const clean = latin(line);
    if (clean.length <= 92) {
      wrapped.push(clean);
      continue;
    }
    for (let index = 0; index < clean.length; index += 92) wrapped.push(clean.slice(index, index + 92));
  }
  const pages: string[][] = [];
  for (let index = 0; index < wrapped.length; index += 46) pages.push(wrapped.slice(index, index + 46));
  if (pages.length === 0) pages.push([""]);

  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  const contentObjectIds = pages.map((_, index) => 5 + index * 2);
  const catalog = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
  const pagesObj = `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`;
  const font = "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";

  const chunks = pages.map((page, index) => {
    const commands = ["BT", "/F1 10 Tf", "48 760 Td", "14 TL"];
    for (const line of page) {
      commands.push(`(${escapePdf(line)}) Tj`, "T*");
    }
    commands.push("ET");
    const stream = commands.join("\n");
    const contentId = contentObjectIds[index];
    const content = `${contentId} 0 obj\n<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream\nendobj\n`;
    const pageObj =
      `${pageObjectIds[index]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`;
    return { pageObj, content };
  });

  let output = "%PDF-1.4\n";
  const offsets = [0];
  const push = (chunk: string) => {
    offsets.push(encoder.encode(output).length);
    output += chunk;
  };
  push(catalog);
  push(pagesObj);
  push(font);
  for (const chunk of chunks) {
    push(chunk.pageObj);
    push(chunk.content);
  }
  const xrefStart = encoder.encode(output).length;
  const size = offsets.length;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let index = 1; index < size; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return encoder.encode(output + xref);
}

export function downloadBytes(filename: string, bytes: Uint8Array, type: string) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, text: string, type: string) {
  downloadBytes(filename, encoder.encode(text), type);
}
