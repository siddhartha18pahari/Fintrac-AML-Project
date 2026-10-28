"use client";

import { downloadBytes, downloadText, flattenDocument, linesToPdf } from "@/lib/pdf";

export function FilingActions({
  filename,
  document,
}: {
  filename: string;
  document: Record<string, unknown>;
}) {
  function downloadJson() {
    downloadText(filename, JSON.stringify(document, null, 2), "application/json");
  }

  function downloadPdf() {
    const lines = [
      String(document.reportType ?? "Draft"),
      String(document.disclaimer ?? ""),
      "",
      ...flattenDocument(document),
    ];
    const pdfName = filename.replace(/\.json$/i, ".pdf");
    downloadBytes(pdfName, linesToPdf(lines), "application/pdf");
  }

  return (
    <div className="no-print flex flex-wrap gap-2">
      <button type="button" onClick={downloadJson} className="rounded-md bg-spruce px-4 py-2 text-sm font-semibold text-white">
        Download JSON
      </button>
      <button type="button" onClick={downloadPdf} className="rounded-md border border-line bg-card px-4 py-2 text-sm font-semibold">
        Download PDF
      </button>
    </div>
  );
}
