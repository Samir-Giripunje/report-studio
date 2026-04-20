export interface ReportPromptTemplate {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
}

export const REPORT_GUIDED_PROMPT_TEMPLATES: ReadonlyArray<ReportPromptTemplate> = [
  {
    id: "summary-of-findings",
    label: "Summary of Findings",
    prompt:
      "Review the attached materials and produce a concise summary of the key findings, supporting evidence, major risks, and recommended next steps.",
  },
  {
    id: "competitive-analysis",
    label: "Competitive Analysis",
    prompt:
      "Analyze the attached materials against relevant competitors. Highlight strengths, weaknesses, differentiators, market gaps, and strategic recommendations.",
  },
  {
    id: "budget-overview",
    label: "Budget Overview",
    prompt:
      "Review the attached budget documents and provide an overview of allocations, major spending drivers, notable variances, financial risks, and suggested follow-up actions.",
  },
  {
    id: "executive-brief",
    label: "Executive Brief",
    prompt:
      "Create an executive-ready brief from the attached materials. Focus on the main takeaways, decision points, business impact, open questions, and the actions leadership should consider next.",
  },
  {
    id: "risk-assessment",
    label: "Risk Assessment",
    prompt:
      "Assess the attached materials for operational, technical, financial, and delivery risks. Summarize each risk, explain the supporting evidence, and recommend mitigation steps.",
  },
  {
    id: "templated-analysis",
    label: "Templated Analysis",
    prompt:
      "Produce a structured report with sections for background, current state, findings, supporting evidence, risks, recommendations, and a short action plan based on the attached materials.",
  },
];

export function findMatchingReportPromptTemplate(prompt: string): ReportPromptTemplate | null {
  const normalizedPrompt = prompt.trim();

  if (normalizedPrompt.length === 0) {
    return null;
  }

  return (
    REPORT_GUIDED_PROMPT_TEMPLATES.find(
      (template) => template.prompt.trim() === normalizedPrompt,
    ) ?? null
  );
}
