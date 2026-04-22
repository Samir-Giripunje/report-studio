import type { ReportSourceDocument } from "@t3tools/contracts";

export type ReportDocumentType =
  | "csv"
  | "html"
  | "json"
  | "markdown"
  | "pdf"
  | "presentation"
  | "spreadsheet"
  | "text"
  | "word"
  | "xml"
  | "yaml"
  | "unknown";

export interface ReportDocumentDescriptor {
  readonly name: string;
  readonly mimeType?: string | null;
}

export interface ReportLlmDocument {
  readonly name: string;
  readonly mimeType: string;
  readonly documentType: ReportDocumentType;
  readonly documentTypeLabel: string;
  readonly textContent: string;
  readonly searchableText: string;
  readonly estimatedWords: number;
  readonly availableToLlm: boolean;
  readonly llmContent: string;
}

const DOCUMENT_TYPE_LABELS: Record<ReportDocumentType, string> = {
  csv: "CSV/table text",
  html: "HTML document",
  json: "JSON document",
  markdown: "Markdown document",
  pdf: "PDF document",
  presentation: "presentation document",
  spreadsheet: "spreadsheet document",
  text: "plain text document",
  word: "word processing document",
  xml: "XML document",
  yaml: "YAML document",
  unknown: "unknown document",
};

const DIRECT_TEXT_DOCUMENT_TYPES = new Set<ReportDocumentType>([
  "csv",
  "html",
  "json",
  "markdown",
  "text",
  "xml",
  "yaml",
]);

function normalizeMimeType(mimeType: string | null | undefined): string {
  return (mimeType ?? "").trim().toLowerCase();
}

function reportFileExtension(name: string): string {
  const lastDotIndex = name.lastIndexOf(".");
  if (lastDotIndex < 0) {
    return "";
  }
  return name.slice(lastDotIndex).toLowerCase();
}

function countEstimatedWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function normalizeReportFileRefs(fileRefs: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const fileRef of fileRefs) {
    const trimmed = fileRef.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

export function detectReportDocumentType(input: ReportDocumentDescriptor): ReportDocumentType {
  const mimeType = normalizeMimeType(input.mimeType);
  const extension = reportFileExtension(input.name);

  if (mimeType === "application/pdf" || extension === ".pdf") {
    return "pdf";
  }

  if (
    mimeType === "text/markdown" ||
    mimeType === "text/x-markdown" ||
    extension === ".md" ||
    extension === ".markdown"
  ) {
    return "markdown";
  }

  if (
    mimeType === "application/json" ||
    mimeType === "application/ld+json" ||
    extension === ".json"
  ) {
    return "json";
  }

  if (
    mimeType === "application/x-yaml" ||
    mimeType === "application/yaml" ||
    mimeType === "text/yaml" ||
    extension === ".yaml" ||
    extension === ".yml"
  ) {
    return "yaml";
  }

  if (mimeType === "application/xml" || mimeType === "text/xml" || extension === ".xml") {
    return "xml";
  }

  if (
    mimeType === "text/csv" ||
    mimeType === "application/csv" ||
    extension === ".csv" ||
    extension === ".tsv"
  ) {
    return "csv";
  }

  if (mimeType === "text/html" || extension === ".html" || extension === ".htm") {
    return "html";
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    extension === ".xlsx" ||
    extension === ".xls"
  ) {
    return "spreadsheet";
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword" ||
    extension === ".docx" ||
    extension === ".doc"
  ) {
    return "word";
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType === "application/vnd.ms-powerpoint" ||
    extension === ".pptx" ||
    extension === ".ppt"
  ) {
    return "presentation";
  }

  if (mimeType.startsWith("text/") || extension === ".txt" || extension === ".log") {
    return "text";
  }

  return "unknown";
}

export function canReadReportDocumentTypeAsText(documentType: ReportDocumentType): boolean {
  return DIRECT_TEXT_DOCUMENT_TYPES.has(documentType);
}

export function normalizeReportSourceDocument(
  document: ReportSourceDocument,
): ReportSourceDocument | null {
  const name = document.name.trim();
  const mimeType = normalizeMimeType(document.mimeType) || "application/octet-stream";
  const textContent = document.textContent.replace(/\r\n/g, "\n").trim();

  if (name.length === 0 || mimeType.length === 0) {
    return null;
  }

  return {
    name,
    mimeType,
    textContent,
  };
}

export function normalizeReportSourceDocuments(
  documents: ReadonlyArray<ReportSourceDocument>,
): ReportSourceDocument[] {
  const normalized: ReportSourceDocument[] = [];
  const seen = new Set<string>();

  for (const document of documents) {
    const normalizedDocument = normalizeReportSourceDocument(document);
    if (!normalizedDocument) {
      continue;
    }

    const dedupeKey = `${normalizedDocument.name}::${normalizedDocument.mimeType}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalized.push(normalizedDocument);
  }

  return normalized;
}

export function prepareReportDocumentsForLlm(
  documents: ReadonlyArray<ReportSourceDocument>,
): ReportLlmDocument[] {
  return normalizeReportSourceDocuments(documents).map((document) => {
    const documentType = detectReportDocumentType(document);
    const documentTypeLabel = DOCUMENT_TYPE_LABELS[documentType];
    const textContent = document.textContent.trim();
    const availableToLlm = textContent.length > 0;
    const unavailableReason = availableToLlm
      ? null
      : documentType === "spreadsheet" || documentType === "word" || documentType === "presentation"
        ? "Text extraction is not available for this binary document type yet."
        : "Text content is unavailable or could not be extracted.";

    const llmContent = [
      `Source: ${document.name}`,
      `Detected type: ${documentTypeLabel}`,
      `MIME type: ${document.mimeType}`,
      "",
      availableToLlm ? textContent : `[${unavailableReason}]`,
    ].join("\n");

    return {
      name: document.name,
      mimeType: document.mimeType,
      documentType,
      documentTypeLabel,
      textContent,
      searchableText: textContent,
      estimatedWords: countEstimatedWords(textContent),
      availableToLlm,
      llmContent,
    };
  });
}

export function buildReportDocumentContextForLlm(
  documents: ReadonlyArray<ReportSourceDocument>,
): string {
  const preparedDocuments = prepareReportDocumentsForLlm(documents);
  if (preparedDocuments.length === 0) {
    return "No uploaded documents were provided.";
  }

  return preparedDocuments
    .map((document, index) => `${index + 1}. ${document.llmContent}`)
    .join("\n\n");
}

export function buildReportDocumentInventoryForLlm(
  documents: ReadonlyArray<ReportSourceDocument>,
): string {
  const preparedDocuments = prepareReportDocumentsForLlm(documents);
  if (preparedDocuments.length === 0) {
    return "No uploaded documents available.";
  }

  return preparedDocuments
    .map((document, index) => {
      const availability = document.availableToLlm
        ? `~${document.estimatedWords} words available`
        : "text unavailable";
      return `${index + 1}. ${document.name} (${document.documentTypeLabel}, ${availability})`;
    })
    .join("\n");
}

function clampPositiveInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function limitToolOutput(text: string, maxChars: number): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars).trim()}\n...[truncated]`;
}

function resolvePreparedDocument(input: {
  readonly documents: ReadonlyArray<ReportSourceDocument>;
  readonly documentName: string;
}): ReportLlmDocument | null {
  const documentName = input.documentName.trim();
  if (documentName.length === 0) {
    return null;
  }

  const documents = prepareReportDocumentsForLlm(input.documents);
  const numericIndex = Number.parseInt(documentName, 10);
  if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= documents.length) {
    return documents[numericIndex - 1] ?? null;
  }

  const normalizedName = documentName.toLowerCase();
  return (
    documents.find((document) => document.name.toLowerCase() === normalizedName) ??
    documents.find((document) => document.name.toLowerCase().includes(normalizedName)) ??
    null
  );
}

export function listReportDocumentsForLlm(documents: ReadonlyArray<ReportSourceDocument>): string {
  const preparedDocuments = prepareReportDocumentsForLlm(documents);
  if (preparedDocuments.length === 0) {
    return "No uploaded documents available.";
  }

  return preparedDocuments
    .map((document, index) => {
      const textStatus = document.availableToLlm
        ? `available (~${document.estimatedWords} words)`
        : "unavailable";
      const tableStatus =
        document.documentType === "csv"
          ? "available as a table-like text document"
          : "not extracted in the current pipeline";
      return [
        `${index + 1}. ${document.name}`,
        `   type: ${document.documentTypeLabel}`,
        `   mime: ${document.mimeType}`,
        `   text: ${textStatus}`,
        `   tables: ${tableStatus}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function readReportDocumentForLlm(input: {
  readonly documents: ReadonlyArray<ReportSourceDocument>;
  readonly documentName: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly maxChars?: number;
}): string {
  const document = resolvePreparedDocument({
    documents: input.documents,
    documentName: input.documentName,
  });
  if (!document) {
    return `Error: document "${input.documentName.trim() || "<empty>"}" was not found.`;
  }
  if (!document.availableToLlm) {
    return `Text for "${document.name}" is unavailable. The current report pipeline only exposes extracted text, not the original binary document.`;
  }

  const maxChars = clampPositiveInt(input.maxChars, 12_000, 1_000, 30_000);
  const lines = document.textContent.split("\n");
  const startLine = clampPositiveInt(input.startLine, 1, 1, lines.length);
  const endLine = clampPositiveInt(input.endLine, lines.length, startLine, lines.length);
  const selectedText = lines.slice(startLine - 1, endLine).join("\n");

  return [
    `[Source: ${document.name}]`,
    `[Detected type: ${document.documentTypeLabel}]`,
    `[Lines: ${startLine}-${endLine} of ${lines.length}]`,
    "",
    limitToolOutput(selectedText, maxChars),
  ].join("\n");
}

export function listReportTablesForLlm(documents: ReadonlyArray<ReportSourceDocument>): string {
  const tableDocuments = prepareReportDocumentsForLlm(documents).filter(
    (document) => document.documentType === "csv" && document.availableToLlm,
  );
  if (tableDocuments.length === 0) {
    return [
      "No extracted tables are available yet.",
      "Current support is limited to CSV/TSV source documents already stored as text.",
      "PDF table extraction will require a server-side extraction stage that stores detected tables separately.",
    ].join("\n");
  }

  return tableDocuments
    .map(
      (document, index) =>
        `${index + 1}. ${document.name} (table-like CSV/TSV text, ~${document.estimatedWords} words)`,
    )
    .join("\n");
}

export function readReportTableForLlm(input: {
  readonly documents: ReadonlyArray<ReportSourceDocument>;
  readonly documentName: string;
  readonly tableIndex?: number;
  readonly maxRows?: number;
}): string {
  const document = resolvePreparedDocument({
    documents: input.documents,
    documentName: input.documentName,
  });
  if (!document) {
    return `Error: table source "${input.documentName.trim() || "<empty>"}" was not found.`;
  }
  if (document.documentType !== "csv" || !document.availableToLlm) {
    return `No extracted table is available for "${document.name}". Current support is limited to CSV/TSV source documents stored as text.`;
  }

  const tableIndex = clampPositiveInt(input.tableIndex, 1, 1, 1);
  const maxRows = clampPositiveInt(input.maxRows, 80, 1, 500);
  const rows = document.textContent.split("\n").slice(0, maxRows);
  const truncated = document.textContent.split("\n").length > rows.length;

  return [
    `[Table ${tableIndex} from ${document.name}]`,
    `[Rows returned: ${rows.length}${truncated ? ", truncated" : ""}]`,
    "",
    rows.join("\n"),
  ].join("\n");
}

export function searchReportDocumentsForLlm(input: {
  readonly documents: ReadonlyArray<ReportSourceDocument>;
  readonly query: string;
  readonly contextLines?: number;
}): string {
  const query = input.query.trim();
  if (!query) {
    return "Error: search query cannot be empty.";
  }

  const contextLines = Math.min(Math.max(input.contextLines ?? 5, 1), 20);
  const results: string[] = [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "gi");

  for (const document of prepareReportDocumentsForLlm(input.documents)) {
    if (!document.searchableText.trim()) {
      continue;
    }

    const lines = document.searchableText.split("\n");
    const matchedIndices: number[] = [];

    for (let index = 0; index < lines.length; index++) {
      pattern.lastIndex = 0;
      if (pattern.test(lines[index]!)) {
        matchedIndices.push(index);
      }
    }

    if (matchedIndices.length === 0) {
      continue;
    }

    const ranges: Array<[number, number]> = [];
    for (const matchedIndex of matchedIndices) {
      const start = Math.max(0, matchedIndex - contextLines);
      const end = Math.min(lines.length - 1, matchedIndex + contextLines);
      const last = ranges[ranges.length - 1];
      if (last && last[1] >= start - 1) {
        last[1] = Math.max(last[1], end);
      } else {
        ranges.push([start, end]);
      }
    }

    const documentParts: string[] = [
      `[Source: ${document.name}]`,
      `[Detected type: ${document.documentTypeLabel}]`,
    ];
    for (const [start, end] of ranges) {
      documentParts.push(
        `Lines ${start + 1}-${end + 1}:\n${lines.slice(start, end + 1).join("\n")}`,
      );
    }
    results.push(documentParts.join("\n\n"));
  }

  return results.length > 0
    ? results.join("\n\n----------------------------------------\n\n")
    : `No matches found for "${query}".`;
}
