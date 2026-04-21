import type { ReportSourceDocument } from "@t3tools/contracts";
import { normalizeReportFileRefs } from "@t3tools/shared/report";

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CONTENT_CHARS = 24_000;

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/csv",
]);

const TEXT_FILE_EXTENSIONS = new Set([
  ".csv",
  ".json",
  ".log",
  ".md",
  ".markdown",
  ".txt",
  ".tsv",
  ".xml",
  ".yaml",
  ".yml",
]);

function limitTextContent(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= MAX_TEXT_CONTENT_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TEXT_CONTENT_CHARS).trim()}\n...[truncated]`;
}

function fileExtension(name: string): string {
  const lastDotIndex = name.lastIndexOf(".");
  if (lastDotIndex < 0) {
    return "";
  }
  return name.slice(lastDotIndex).toLowerCase();
}

function canExtractTextFromFile(file: File): boolean {
  if (file.size > MAX_TEXT_FILE_BYTES) {
    return false;
  }

  const mimeType = file.type.trim().toLowerCase();
  if (mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(mimeType)) {
    return true;
  }

  return TEXT_FILE_EXTENSIONS.has(fileExtension(file.name));
}

export async function readReportSourceDocument(file: File): Promise<ReportSourceDocument> {
  const textContent =
    canExtractTextFromFile(file) && typeof file.text === "function"
      ? limitTextContent(await file.text())
      : "";

  return {
    name: file.name.trim(),
    mimeType: (file.type.trim() || "application/octet-stream").toLowerCase(),
    textContent,
  };
}

export function normalizeReportSourceDocuments(
  documents: ReadonlyArray<ReportSourceDocument>,
): ReportSourceDocument[] {
  const normalized: ReportSourceDocument[] = [];
  const seen = new Set<string>();

  for (const document of documents) {
    const name = document.name.trim();
    const mimeType = document.mimeType.trim().toLowerCase();
    const textContent = document.textContent.trim();
    if (name.length === 0 || mimeType.length === 0) {
      continue;
    }

    const dedupeKey = `${name}::${mimeType}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push({ name, mimeType, textContent });
  }

  return normalized;
}

export function reportFileRefsFromDocuments(
  documents: ReadonlyArray<ReportSourceDocument>,
): string[] {
  return normalizeReportFileRefs(documents.map((document) => document.name));
}
