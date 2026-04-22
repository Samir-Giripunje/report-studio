import { describe, expect, it } from "vitest";

import {
  canReadReportDocumentTypeAsText,
  detectReportDocumentType,
  listReportDocumentsForLlm,
  listReportTablesForLlm,
  prepareReportDocumentsForLlm,
  readReportDocumentForLlm,
  readReportTableForLlm,
  searchReportDocumentsForLlm,
} from "./report";

describe("report document LLM helpers", () => {
  it("detects common source document types from mime type and file name", () => {
    expect(detectReportDocumentType({ name: "brief.pdf", mimeType: "" })).toBe("pdf");
    expect(detectReportDocumentType({ name: "notes.md", mimeType: "text/plain" })).toBe("markdown");
    expect(detectReportDocumentType({ name: "budget", mimeType: "application/json" })).toBe("json");
    expect(detectReportDocumentType({ name: "table.tsv", mimeType: "" })).toBe("csv");
    expect(detectReportDocumentType({ name: "sheet.xlsx", mimeType: "" })).toBe("spreadsheet");
    expect(canReadReportDocumentTypeAsText("markdown")).toBe(true);
    expect(canReadReportDocumentTypeAsText("spreadsheet")).toBe(false);
  });

  it("prepares source documents with explicit LLM availability metadata", () => {
    const documents = prepareReportDocumentsForLlm([
      {
        name: "source.md",
        mimeType: "text/markdown",
        textContent: "# Source\n\nRevenue increased in Q1.",
      },
      {
        name: "raw.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        textContent: "",
      },
    ]);

    expect(documents[0]).toMatchObject({
      documentType: "markdown",
      availableToLlm: true,
      estimatedWords: 6,
    });
    expect(documents[0]?.llmContent).toContain("Revenue increased in Q1.");
    expect(documents[1]).toMatchObject({
      documentType: "spreadsheet",
      availableToLlm: false,
    });
    expect(documents[1]?.llmContent).toContain("Text extraction is not available");
  });

  it("searches prepared document text with surrounding context", () => {
    const result = searchReportDocumentsForLlm({
      documents: [
        {
          name: "evidence.txt",
          mimeType: "text/plain",
          textContent: ["Alpha context", "Beta target", "Gamma context"].join("\n"),
        },
      ],
      query: "target",
      contextLines: 1,
    });

    expect(result).toContain("[Source: evidence.txt]");
    expect(result).toContain("Lines 1-3");
    expect(result).toContain("Beta target");
  });

  it("lists and reads extracted source documents by name or index", () => {
    const documents = [
      {
        name: "evidence.txt",
        mimeType: "text/plain",
        textContent: ["Line one", "Line two", "Line three"].join("\n"),
      },
    ];

    expect(listReportDocumentsForLlm(documents)).toContain("1. evidence.txt");
    expect(
      readReportDocumentForLlm({
        documents,
        documentName: "1",
        startLine: 2,
        endLine: 2,
      }),
    ).toContain("Line two");
  });

  it("lists and reads CSV source documents as table-like sources", () => {
    const documents = [
      {
        name: "financials.csv",
        mimeType: "text/csv",
        textContent: ["metric,value", "revenue,100", "margin,20"].join("\n"),
      },
    ];

    expect(listReportTablesForLlm(documents)).toContain("financials.csv");
    const table = readReportTableForLlm({
      documents,
      documentName: "financials.csv",
      maxRows: 2,
    });
    expect(table).toContain("[Rows returned: 2, truncated]");
    expect(table).toContain("revenue,100");
  });
});
