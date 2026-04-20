import { describe, expect, it } from "vitest";

import {
  findMatchingReportPromptTemplate,
  REPORT_GUIDED_PROMPT_TEMPLATES,
} from "./reportPromptTemplates";

describe("findMatchingReportPromptTemplate", () => {
  const summaryTemplate = REPORT_GUIDED_PROMPT_TEMPLATES.find(
    (template) => template.id === "summary-of-findings",
  );
  const competitiveTemplate = REPORT_GUIDED_PROMPT_TEMPLATES.find(
    (template) => template.id === "competitive-analysis",
  );

  it("returns null for empty prompts", () => {
    expect(findMatchingReportPromptTemplate("   ")).toBeNull();
  });

  it("matches a predefined template prompt", () => {
    expect(summaryTemplate).toBeDefined();
    expect(findMatchingReportPromptTemplate(summaryTemplate?.prompt ?? "")).toEqual(
      summaryTemplate,
    );
  });

  it("matches prompts after trimming whitespace", () => {
    expect(competitiveTemplate).toBeDefined();
    expect(findMatchingReportPromptTemplate(`  ${competitiveTemplate?.prompt ?? ""}  `)).toEqual(
      competitiveTemplate,
    );
  });

  it("returns null for custom prompts", () => {
    expect(findMatchingReportPromptTemplate("Write a custom report prompt")).toBeNull();
  });
});
