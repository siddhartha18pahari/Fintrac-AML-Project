/** CSV cells. A leading formula character is quoted so a spreadsheet does not execute it. */

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: unknown) {
  if (value == null) return "";
  let text = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
  if (FORMULA.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: unknown[][]) {
  const lines = [headers.map((header) => csvCell(header)).join(",")];
  for (const row of rows) lines.push(row.map((cell) => csvCell(cell)).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
