import type { ReportCitation } from "@t3tools/contracts";

type ReportExportExtension = "pdf" | "docx";

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const ZIP_UTF8_FLAG = 0x0800;

interface ZipEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

type DocxParagraphStyle =
  | "Title"
  | "Heading1"
  | "Heading2"
  | "Heading3"
  | "Heading4"
  | "Heading5"
  | "Heading6";

interface DocxParagraph {
  readonly text: string;
  readonly style?: DocxParagraphStyle;
}

function sanitizeReportFileSegment(input: string): string {
  const sanitized = input
    .toLowerCase()
    .replace(/[`'".,!?()[\]{}]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 ? sanitized : "report";
}

export function buildReportExportFilename(title: string, extension: ReportExportExtension): string {
  return `${sanitizeReportFileSegment(title)}.${extension}`;
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(input: string): string {
  return escapeXml(input);
}

function stripInlineMarkdown(input: string): string {
  return input
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .trim();
}

function markdownToPlainParagraphs(markdown: string, title: string): DocxParagraph[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const paragraphs: DocxParagraph[] = [];
  const bufferedLines: string[] = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    const text = stripInlineMarkdown(bufferedLines.join(" "));
    bufferedLines.length = 0;
    if (text.length > 0) {
      paragraphs.push({ text });
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      if (line.length > 0) {
        paragraphs.push({ text: line });
      }
      continue;
    }

    if (trimmed.length === 0) {
      flushParagraph();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const depth = heading[1]?.length ?? 1;
      const text = stripInlineMarkdown(heading[2] ?? "");
      const headingStyle = `Heading${Math.min(Math.max(depth, 1), 6)}` as DocxParagraphStyle;
      paragraphs.push({ text, style: headingStyle });
      continue;
    }

    const unorderedListItem = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unorderedListItem) {
      flushParagraph();
      paragraphs.push({ text: `- ${stripInlineMarkdown(unorderedListItem[1] ?? "")}` });
      continue;
    }

    const orderedListItem = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (orderedListItem) {
      flushParagraph();
      paragraphs.push({
        text: `${orderedListItem[1] ?? "1"}. ${stripInlineMarkdown(orderedListItem[2] ?? "")}`,
      });
      continue;
    }

    const blockquote = trimmed.match(/^>\s?(.+)$/);
    if (blockquote) {
      flushParagraph();
      paragraphs.push({ text: `> ${stripInlineMarkdown(blockquote[1] ?? "")}` });
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushParagraph();
      paragraphs.push({ text: "----" });
      continue;
    }

    bufferedLines.push(trimmed);
  }

  flushParagraph();

  if (paragraphs.length === 0 && title.trim().length > 0) {
    return [{ text: title.trim(), style: "Title" }];
  }

  const first = paragraphs[0];
  if (
    first &&
    !first.style &&
    title.trim().length > 0 &&
    first.text.toLowerCase() !== title.trim().toLowerCase()
  ) {
    return [{ text: title.trim(), style: "Title" }, ...paragraphs];
  }

  return paragraphs;
}

// ---------------------------------------------------------------------------
// Citation helpers
// ---------------------------------------------------------------------------

/**
 * Appends a "References" section to markdown for text-based exports (DOCX).
 * Only includes citation indices that are still present in the markdown content
 * so deleted citations don't create ghost references.
 */
function appendReferencesToMarkdown(
  markdown: string,
  citations: ReadonlyArray<ReportCitation>,
): string {
  if (citations.length === 0) return markdown;

  // Determine which indices appear in the content
  const re = /(?<!!)\[(\d+)\](?![(:[\]])/g;
  const visible = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    visible.add(parseInt(m[1]!, 10));
  }
  const listed = citations.filter((c) => visible.has(c.index));
  if (listed.length === 0) return markdown;

  const refLines = [
    "\n\n---\n\n## References\n",
    ...listed.map((c) => `[${c.index}] ${c.documentName}`),
  ];
  return markdown + refLines.join("\n");
}

function paragraphXml(paragraph: DocxParagraph): string {
  const style =
    paragraph.style != null ? `<w:pPr><w:pStyle w:val="${paragraph.style}"/></w:pPr>` : "";
  return `<w:p>${style}<w:r><w:t>${escapeXml(paragraph.text)}</w:t></w:r></w:p>`;
}

function buildDocumentXml(input: {
  title: string;
  markdown: string;
  citations?: ReadonlyArray<ReportCitation>;
}): string {
  const markdown = appendReferencesToMarkdown(input.markdown, input.citations ?? []);
  const paragraphs = markdownToPlainParagraphs(markdown, input.title);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.map(paragraphXml).join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="160"/></w:pPr>
    <w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="240"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="320" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading4">
    <w:name w:val="heading 4"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="180" w:after="80"/><w:outlineLvl w:val="3"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading5">
    <w:name w:val="heading 5"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="4"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading6">
    <w:name w:val="heading 6"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="140" w:after="80"/><w:outlineLvl w:val="5"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
  </w:style>
</w:styles>`;
}

function buildContentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function buildRootRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildDocumentRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;
}

function buildCorePropertiesXml(input: { title: string; createdAt: Date }): string {
  const timestamp = input.createdAt.toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(input.title)}</dc:title>
  <dc:creator>T3 Code</dc:creator>
  <cp:lastModifiedBy>T3 Code</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`;
}

function buildAppPropertiesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>T3 Code</Application>
</Properties>`;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function writeUint16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function dosDateTime(date: Date): { readonly date: number; readonly time: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function concatUint8Arrays(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function createStoredZip(entries: ReadonlyArray<ZipEntry>, modifiedAt: Date): Uint8Array {
  const encoder = new TextEncoder();
  const { date, time } = dosDateTime(modifiedAt);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const checksum = crc32(entry.bytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20);
    writeUint16(localHeader, 6, ZIP_UTF8_FLAG);
    writeUint16(localHeader, 8, 0);
    writeUint16(localHeader, 10, time);
    writeUint16(localHeader, 12, date);
    writeUint32(localHeader, 14, checksum);
    writeUint32(localHeader, 18, entry.bytes.length);
    writeUint32(localHeader, 22, entry.bytes.length);
    writeUint16(localHeader, 26, nameBytes.length);
    writeUint16(localHeader, 28, 0);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, entry.bytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 8, ZIP_UTF8_FLAG);
    writeUint16(centralHeader, 10, 0);
    writeUint16(centralHeader, 12, time);
    writeUint16(centralHeader, 14, date);
    writeUint32(centralHeader, 16, checksum);
    writeUint32(centralHeader, 20, entry.bytes.length);
    writeUint32(centralHeader, 24, entry.bytes.length);
    writeUint16(centralHeader, 28, nameBytes.length);
    writeUint16(centralHeader, 30, 0);
    writeUint16(centralHeader, 32, 0);
    writeUint16(centralHeader, 34, 0);
    writeUint16(centralHeader, 36, 0);
    writeUint32(centralHeader, 38, 0);
    writeUint32(centralHeader, 42, localOffset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + entry.bytes.length;
  }

  const centralDirectory = concatUint8Arrays(centralParts);
  const endRecord = new Uint8Array(22);
  writeUint32(endRecord, 0, 0x06054b50);
  writeUint16(endRecord, 4, 0);
  writeUint16(endRecord, 6, 0);
  writeUint16(endRecord, 8, entries.length);
  writeUint16(endRecord, 10, entries.length);
  writeUint32(endRecord, 12, centralDirectory.length);
  writeUint32(endRecord, 16, localOffset);
  writeUint16(endRecord, 20, 0);

  return concatUint8Arrays([...localParts, centralDirectory, endRecord]);
}

export function buildReportDocxBlob(input: {
  readonly title: string;
  readonly markdown: string;
  readonly citations?: ReadonlyArray<ReportCitation>;
  readonly createdAt?: Date;
}): Blob {
  const encoder = new TextEncoder();
  const createdAt = input.createdAt ?? new Date();
  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", bytes: encoder.encode(buildContentTypesXml()) },
    { path: "_rels/.rels", bytes: encoder.encode(buildRootRelationshipsXml()) },
    {
      path: "docProps/core.xml",
      bytes: encoder.encode(buildCorePropertiesXml({ title: input.title, createdAt })),
    },
    { path: "docProps/app.xml", bytes: encoder.encode(buildAppPropertiesXml()) },
    { path: "word/document.xml", bytes: encoder.encode(buildDocumentXml(input)) },
    { path: "word/styles.xml", bytes: encoder.encode(buildStylesXml()) },
    {
      path: "word/_rels/document.xml.rels",
      bytes: encoder.encode(buildDocumentRelationshipsXml()),
    },
  ];

  const zipBytes = createStoredZip(entries, createdAt);
  const zipBuffer = new Uint8Array(zipBytes.byteLength);
  zipBuffer.set(zipBytes);
  return new Blob([zipBuffer.buffer], { type: DOCX_MIME_TYPE });
}

function markdownToBasicHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (text.length > 0) {
      html.push(`<p>${escapeHtml(stripInlineMarkdown(text))}</p>`);
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const depth = Math.min(heading[1]?.length ?? 1, 6);
      html.push(`<h${depth}>${escapeHtml(stripInlineMarkdown(heading[2] ?? ""))}</h${depth}>`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return html.join("\n");
}

function resolveRenderedReportHtml(input: {
  readonly markdown: string;
  readonly renderedElement?: HTMLElement | null;
}): string {
  const reportMarkdown = input.renderedElement?.querySelector(".report-markdown");
  if (reportMarkdown instanceof HTMLElement && reportMarkdown.innerHTML.trim().length > 0) {
    return reportMarkdown.innerHTML;
  }
  return markdownToBasicHtml(input.markdown);
}

function buildPrintableReportHtml(input: {
  readonly title: string;
  readonly markdown: string;
  readonly renderedElement?: HTMLElement | null;
}): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      @page { margin: 0.75in; }
      html, body { background: #fff; color: #171717; font-family: Arial, sans-serif; }
      body { margin: 0; }
      .report-export { font-size: 11pt; line-height: 1.55; }
      .report-export > :first-child { margin-top: 0; }
      .report-export h1, .report-export h2, .report-export h3,
      .report-export h4, .report-export h5, .report-export h6 {
        break-after: avoid;
        color: #111827;
        font-weight: 700;
        line-height: 1.25;
        margin: 1.1rem 0 0.45rem;
      }
      .report-export h1 { font-size: 20pt; }
      .report-export h2 { font-size: 16pt; }
      .report-export h3 { font-size: 13pt; }
      .report-export p, .report-export ul, .report-export ol,
      .report-export blockquote, .report-export pre, .report-export table {
        margin: 0.55rem 0;
      }
      .report-export ul, .report-export ol { padding-left: 1.35rem; }
      .report-export blockquote {
        border-left: 3px solid #d4d4d4;
        color: #525252;
        padding-left: 0.8rem;
      }
      .report-export table { border-collapse: collapse; width: 100%; }
      .report-export th, .report-export td {
        border: 1px solid #d4d4d4;
        padding: 0.35rem 0.45rem;
        text-align: left;
      }
      .report-export pre {
        border: 1px solid #d4d4d4;
        border-radius: 6px;
        overflow-wrap: anywhere;
        padding: 0.65rem;
        white-space: pre-wrap;
      }
      .report-export code { font-family: Consolas, Menlo, monospace; }
      /* Citation badges — rendered as <sup> by CitationBadge */
      .report-export sup.citation-badge {
        font-size: 8pt;
        font-weight: 600;
        color: #1d4ed8;
        vertical-align: super;
        line-height: 0;
        margin: 0 1px;
      }
      /* Tooltip wrappers have no visual output in print */
      .report-export [data-slot="tooltip-trigger"] { display: contents; }
      /* Sources list */
      .report-export .sources-list { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #d4d4d4; }
      .report-export .sources-list p { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #737373; margin-bottom: 0.5rem; }
      .report-export .sources-list ol { list-style: none; padding: 0; margin: 0; }
      .report-export .sources-list li { display: flex; align-items: center; gap: 0.5rem; font-size: 9pt; margin-bottom: 0.35rem; }
      @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
    </style>
  </head>
  <body>
    <main class="report-export">${resolveRenderedReportHtml(input)}</main>
  </body>
</html>`;
}

export function exportReportAsPdf(input: {
  readonly title: string;
  readonly markdown: string;
  readonly citations?: ReadonlyArray<ReportCitation>;
  readonly renderedElement?: HTMLElement | null;
}): void {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);

  const frameDocument = frame.contentDocument;
  const frameWindow = frame.contentWindow;
  if (!frameDocument || !frameWindow) {
    frame.remove();
    throw new Error("Could not prepare the PDF export view.");
  }

  frameDocument.open();
  frameDocument.write(buildPrintableReportHtml(input));
  frameDocument.close();

  const cleanup = () => {
    frame.remove();
  };
  frameWindow.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(cleanup, 60_000);
  window.setTimeout(() => {
    frameWindow.focus();
    frameWindow.print();
  }, 50);
}

export function exportReportAsDocx(input: {
  readonly title: string;
  readonly markdown: string;
  readonly citations?: ReadonlyArray<ReportCitation>;
}): void {
  downloadBlob(
    buildReportExportFilename(input.title, "docx"),
    buildReportDocxBlob({
      title: input.title,
      markdown: input.markdown,
      citations: input.citations ?? [],
    }),
  );
}
