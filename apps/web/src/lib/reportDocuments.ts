import type { ReportSourceDocument } from "@t3tools/contracts";
import {
  canReadReportDocumentTypeAsText,
  detectReportDocumentType,
  normalizeReportFileRefs,
  normalizeReportSourceDocuments as normalizeSharedReportSourceDocuments,
  type ReportDocumentType,
} from "@t3tools/shared/report";

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CONTENT_CHARS = 24_000;

function limitTextContent(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= MAX_TEXT_CONTENT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TEXT_CONTENT_CHARS).trim()}\n...[truncated]`;
}

function detectFileDocumentType(file: File): ReportDocumentType {
  return detectReportDocumentType({
    name: file.name,
    mimeType: file.type,
  });
}

function canReadFileAsDirectText(file: File, documentType: ReportDocumentType): boolean {
  if (file.size > MAX_TEXT_FILE_BYTES) {
    return false;
  }

  return canReadReportDocumentTypeAsText(documentType);
}

export async function readReportSourceDocumentForLlm(file: File): Promise<ReportSourceDocument> {
  let textContent = "";
  const documentType = detectFileDocumentType(file);

  if (documentType === "pdf") {
    // PDFs are binary — skip the byte-size check (images inflate file size but not text
    // output) and use PDF.js to extract the actual text content from all pages.
    try {
      const { extractTextFromPdf } = await import("./pdfExtract");
      const buffer = await file.arrayBuffer();
      textContent = limitTextContent(await extractTextFromPdf(buffer));
    } catch {
      // Extraction failed (e.g. password-protected or corrupted PDF).
      // textContent stays "" — the planner will note the content as unavailable.
    }
  } else if (canReadFileAsDirectText(file, documentType)) {
    textContent = limitTextContent(await file.text());
  }

  return {
    name: file.name.trim(),
    mimeType: (file.type.trim() || "application/octet-stream").toLowerCase(),
    textContent,
  };
}

export const readReportSourceDocument = readReportSourceDocumentForLlm;

export function normalizeReportSourceDocuments(
  documents: ReadonlyArray<ReportSourceDocument>,
): ReportSourceDocument[] {
  return normalizeSharedReportSourceDocuments(documents);
}

export function reportFileRefsFromDocuments(
  documents: ReadonlyArray<ReportSourceDocument>,
): string[] {
  return normalizeReportFileRefs(documents.map((document) => document.name));
}
