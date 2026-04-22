import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";

// Configure the worker once at module initialization time.
// Vite resolves the ?url import to a hashed asset path at build time.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * Extracts plain text from a PDF ArrayBuffer using PDF.js.
 *
 * Text items from each page are concatenated in reading order and joined
 * with a double newline between pages. Returns an empty string when the
 * document contains no extractable text (e.g. scanned images only).
 */
export async function extractTextFromPdf(buffer: ArrayBuffer): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdfDoc = await loadingTask.promise;

  const pages: string[] = [];
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      // TextItem has `str`; TextMarkedContent does not — filter to text items only.
      .flatMap((item) => ("str" in item && typeof item.str === "string" ? [item.str] : []))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageText) {
      pages.push(pageText);
    }
  }

  return pages.join("\n\n");
}
