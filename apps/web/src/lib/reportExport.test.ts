import { describe, expect, it } from "vitest";

import { buildReportDocxBlob, buildReportExportFilename } from "./reportExport";

describe("report export helpers", () => {
  it("builds stable report export filenames", () => {
    expect(buildReportExportFilename("Q4 Tata Motors Ltd. Earnings Release", "docx")).toBe(
      "q4-tata-motors-ltd-earnings-release.docx",
    );
    expect(buildReportExportFilename("", "pdf")).toBe("report.pdf");
  });

  it("builds a docx zip containing the report document", async () => {
    const blob = buildReportDocxBlob({
      title: "Quarterly Summary",
      markdown: "# Quarterly Summary\n\n- Revenue increased\n- Margin expanded",
      createdAt: new Date("2026-04-23T00:00:00.000Z"),
    });

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const zipText = new TextDecoder().decode(bytes);

    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(zipText).toContain("word/document.xml");
    expect(zipText).toContain("Quarterly Summary");
    expect(zipText).toContain("Revenue increased");
  });

  it("preserves markdown heading depth as docx heading styles and outline levels", async () => {
    const blob = buildReportDocxBlob({
      title: "Heading Test",
      markdown: "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6",
      createdAt: new Date("2026-04-23T00:00:00.000Z"),
    });

    const zipText = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));

    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(zipText).toContain(`<w:pStyle w:val="Heading${level}"/>`);
      expect(zipText).toContain(`<w:outlineLvl w:val="${level - 1}"/>`);
    }
  });
});
