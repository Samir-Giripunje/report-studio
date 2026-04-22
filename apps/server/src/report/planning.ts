import type {
  ReportPlan,
  ReportPlanningMessage,
  ReportPlanningOutline,
  ReportPlanningQuestion,
  ReportPlanningState,
  ReportSourceDocument,
} from "@t3tools/contracts";

import { normalizeReportFileRefs, normalizeReportSourceDocuments } from "@t3tools/shared/report";

import { buildContextualReportTitle } from "./title.ts";

type ReportPlanSection = ReportPlan["sectionTree"][number];

function makePlanningMessage(input: {
  readonly role: ReportPlanningMessage["role"];
  readonly text: string;
  readonly createdAt: string;
}): ReportPlanningMessage {
  return {
    id: `report-planning-message:${crypto.randomUUID()}`,
    role: input.role,
    text: input.text.trim(),
    createdAt: input.createdAt,
  };
}

function makeQuestion(id: number, question: string): ReportPlanningQuestion {
  return {
    id: `report-planning-question:${id}`,
    question: question.trim(),
  };
}

function containsAny(text: string, candidates: ReadonlyArray<string>): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function slugifySectionId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function makeSectionNode(input: {
  readonly title: string;
  readonly purpose: string;
  readonly guidance: ReadonlyArray<string>;
  readonly mustNotDo?: ReadonlyArray<string>;
  readonly minWords: number;
  readonly maxWords: number;
  readonly dependsOn?: ReadonlyArray<string>;
  readonly generationOrder: number | "last";
}): ReportPlanSection {
  return {
    id: slugifySectionId(input.title) || `section-${crypto.randomUUID()}`,
    title: input.title,
    depth: 0,
    purpose: input.purpose,
    contentGuidance: [...input.guidance],
    mustNotDo: [...(input.mustNotDo ?? [])],
    lengthTarget: {
      minWords: input.minWords,
      maxWords: input.maxWords,
    },
    sourceOverride: null,
    dependsOn: [...(input.dependsOn ?? [])],
    generationOrder: input.generationOrder,
    children: [],
  };
}

function detectOutlineKind(brief: string, fileRefs: ReadonlyArray<string>) {
  const haystack = `${brief}\n${fileRefs.join("\n")}`.toLowerCase();
  if (containsAny(haystack, ["competitor", "competitive", "market gap", "differentiator"])) {
    return "competitive-analysis" as const;
  }
  if (containsAny(haystack, ["budget", "spend", "variance", "allocation", "financial"])) {
    return "budget-overview" as const;
  }
  if (containsAny(haystack, ["risk", "mitigation", "failure mode", "exposure"])) {
    return "risk-assessment" as const;
  }
  if (containsAny(haystack, ["executive brief", "leadership", "board", "decision memo"])) {
    return "executive-brief" as const;
  }
  if (containsAny(haystack, ["summary", "findings", "evidence"])) {
    return "summary-of-findings" as const;
  }
  return "generic-analysis" as const;
}

function deriveClarificationQuestions(input: {
  readonly brief: string;
  readonly fileRefs: ReadonlyArray<string>;
}): ReadonlyArray<ReportPlanningQuestion> {
  const brief = input.brief.toLowerCase();
  const questions: ReportPlanningQuestion[] = [];

  if (
    !containsAny(brief, [
      "audience",
      "for leadership",
      "for executives",
      "for the board",
      "for investors",
      "for customers",
      "for the team",
      "executive",
      "board",
      "leadership",
      "stakeholder",
    ])
  ) {
    questions.push(
      makeQuestion(
        1,
        "Who is the primary audience for this report, and what decision should it help them make?",
      ),
    );
  }

  if (
    !containsAny(brief, [
      "q1",
      "q2",
      "q3",
      "q4",
      "202",
      "month",
      "quarter",
      "year",
      "last ",
      "current",
      "historical",
      "forecast",
      "timeline",
      "period",
    ])
  ) {
    questions.push(
      makeQuestion(2, "What timeframe or reporting period should the report focus on?"),
    );
  }

  if (input.fileRefs.length === 0) {
    questions.push(
      makeQuestion(
        3,
        "Which source documents or materials should the report treat as the primary evidence base?",
      ),
    );
  } else if (
    input.fileRefs.length > 1 &&
    !containsAny(brief, ["focus on", "prioritize", "weight", "most important", "primary source"])
  ) {
    questions.push(
      makeQuestion(
        3,
        "You attached multiple documents. Should any of them be prioritized as the primary source of truth?",
      ),
    );
  }

  if (
    !containsAny(brief, [
      "concise",
      "detailed",
      "short",
      "deep dive",
      "executive brief",
      "presentation",
      "section",
      "outline",
      "structure",
      "2 page",
      "5 page",
      "memo",
    ])
  ) {
    questions.push(
      makeQuestion(
        4,
        "How detailed should the final report be, and are there any sections you definitely want included?",
      ),
    );
  }

  return questions.slice(0, 4);
}

function buildOutline(input: {
  readonly title: string;
  readonly brief: string;
  readonly fileRefs: ReadonlyArray<string>;
  readonly documents?: ReadonlyArray<ReportSourceDocument>;
}): {
  readonly outline: ReportPlanningOutline;
  readonly sectionTree: ReadonlyArray<ReportPlanSection>;
} {
  const kind = detectOutlineKind(input.brief, input.fileRefs);
  const sourceCount = input.fileRefs.length;
  const sourceSummary =
    sourceCount === 0
      ? "the provided brief"
      : `${sourceCount} attached source document${sourceCount === 1 ? "" : "s"}`;

  const sections =
    kind === "competitive-analysis"
      ? [
          makeSectionNode({
            title: "Executive Summary",
            purpose:
              "Summarize the main competitive takeaway and the decisions that follow from it.",
            guidance: [
              "State the competitive position clearly",
              "Highlight the biggest market implications",
              "Call out the most urgent recommended actions",
            ],
            minWords: 250,
            maxWords: 400,
            dependsOn: ["competitor-landscape", "strategic-recommendations"],
            generationOrder: "last",
          }),
          makeSectionNode({
            title: "Competitor Landscape",
            purpose: "Frame the relevant competitors, segments, and evaluation criteria.",
            guidance: [
              "Define the comparison set",
              "Summarize market context and assumptions",
              "Explain the dimensions used for comparison",
            ],
            minWords: 500,
            maxWords: 800,
            generationOrder: 1,
          }),
          makeSectionNode({
            title: "Strengths, Weaknesses, and Gaps",
            purpose:
              "Compare the subject against competitors and surface the most meaningful gaps.",
            guidance: [
              "Tie each point to evidence from the source material",
              "Separate strengths from weaknesses",
              "Highlight white-space opportunities",
            ],
            minWords: 900,
            maxWords: 1400,
            dependsOn: ["competitor-landscape"],
            generationOrder: 2,
          }),
          makeSectionNode({
            title: "Strategic Recommendations",
            purpose: "Turn the comparison into specific next steps.",
            guidance: [
              "Recommend actions in priority order",
              "Explain why each action matters now",
              "Call out risks, dependencies, and unknowns",
            ],
            minWords: 500,
            maxWords: 800,
            dependsOn: ["strengths-weaknesses-and-gaps"],
            generationOrder: 3,
          }),
        ]
      : kind === "budget-overview"
        ? [
            makeSectionNode({
              title: "Executive Summary",
              purpose: "Summarize the budget story, notable variances, and immediate decisions.",
              guidance: [
                "State the biggest budget movement",
                "Summarize the financial impact",
                "Highlight the primary action items",
              ],
              minWords: 250,
              maxWords: 400,
              dependsOn: ["budget-baseline", "variance-analysis", "risks-and-actions"],
              generationOrder: "last",
            }),
            makeSectionNode({
              title: "Budget Baseline",
              purpose: "Establish the budget categories, allocations, and assumptions.",
              guidance: [
                "Summarize the baseline plan",
                "Identify major cost centers",
                "Clarify relevant period assumptions",
              ],
              minWords: 500,
              maxWords: 800,
              generationOrder: 1,
            }),
            makeSectionNode({
              title: "Variance Analysis",
              purpose: "Explain where the budget is moving relative to plan.",
              guidance: [
                "Quantify major variances",
                "Separate recurring versus one-off effects",
                "Tie explanations back to the source documents",
              ],
              minWords: 900,
              maxWords: 1300,
              dependsOn: ["budget-baseline"],
              generationOrder: 2,
            }),
            makeSectionNode({
              title: "Risks and Actions",
              purpose: "Identify the main financial risks and propose follow-up actions.",
              guidance: [
                "Call out budget pressure points",
                "Recommend mitigation steps",
                "Note unresolved questions or data gaps",
              ],
              minWords: 500,
              maxWords: 750,
              dependsOn: ["variance-analysis"],
              generationOrder: 3,
            }),
          ]
        : kind === "risk-assessment"
          ? [
              makeSectionNode({
                title: "Executive Summary",
                purpose: "Summarize the most material risks and the highest-priority mitigations.",
                guidance: [
                  "State the biggest risk themes",
                  "Highlight severity and urgency",
                  "Summarize the recommended response",
                ],
                minWords: 250,
                maxWords: 400,
                dependsOn: ["risk-landscape", "mitigation-plan"],
                generationOrder: "last",
              }),
              makeSectionNode({
                title: "Risk Landscape",
                purpose: "Describe the categories of risk present in the source material.",
                guidance: [
                  "Group risks into clear buckets",
                  "Explain the conditions driving each bucket",
                  "Clarify the evidence base",
                ],
                minWords: 600,
                maxWords: 900,
                generationOrder: 1,
              }),
              makeSectionNode({
                title: "Evidence and Impact",
                purpose:
                  "Explain the supporting evidence, likely impact, and confidence level for each major risk.",
                guidance: [
                  "Use evidence from the attached materials",
                  "Differentiate fact from inference",
                  "Note material unknowns",
                ],
                minWords: 900,
                maxWords: 1300,
                dependsOn: ["risk-landscape"],
                generationOrder: 2,
              }),
              makeSectionNode({
                title: "Mitigation Plan",
                purpose: "Translate the findings into actionable mitigations and monitoring steps.",
                guidance: [
                  "Recommend owners or next actions where possible",
                  "Prioritize by urgency",
                  "Call out dependencies",
                ],
                minWords: 500,
                maxWords: 800,
                dependsOn: ["evidence-and-impact"],
                generationOrder: 3,
              }),
            ]
          : kind === "executive-brief"
            ? [
                makeSectionNode({
                  title: "Executive Summary",
                  purpose: "Deliver the central decision-ready takeaway in a compact format.",
                  guidance: [
                    "State the headline conclusion",
                    "Summarize the key evidence",
                    "Point to the decisions leadership should make",
                  ],
                  minWords: 250,
                  maxWords: 400,
                  dependsOn: ["key-context", "findings-and-implications", "recommended-actions"],
                  generationOrder: "last",
                }),
                makeSectionNode({
                  title: "Key Context",
                  purpose: "Provide only the background needed to interpret the decision.",
                  guidance: [
                    "Keep the context focused",
                    "Explain why the topic matters now",
                    "Reference the most relevant source materials",
                  ],
                  minWords: 400,
                  maxWords: 650,
                  generationOrder: 1,
                }),
                makeSectionNode({
                  title: "Findings and Implications",
                  purpose: "Summarize the most important findings and explain what they imply.",
                  guidance: [
                    "Prioritize findings by importance",
                    "Explain business or operational impact",
                    "Avoid repeating raw source text",
                  ],
                  minWords: 900,
                  maxWords: 1300,
                  dependsOn: ["key-context"],
                  generationOrder: 2,
                }),
                makeSectionNode({
                  title: "Recommended Actions",
                  purpose: "Translate the findings into clear executive next steps.",
                  guidance: [
                    "Recommend actions in priority order",
                    "Tie each action to the evidence",
                    "Call out what still needs validation",
                  ],
                  minWords: 450,
                  maxWords: 700,
                  dependsOn: ["findings-and-implications"],
                  generationOrder: 3,
                }),
              ]
            : [
                makeSectionNode({
                  title: "Executive Summary",
                  purpose: "Summarize the main findings, evidence, and recommended next steps.",
                  guidance: [
                    "State the headline takeaway",
                    "Summarize the strongest evidence",
                    "Identify the recommended action",
                  ],
                  minWords: 250,
                  maxWords: 400,
                  dependsOn: [
                    "background-and-scope",
                    "core-findings",
                    "recommendations-and-open-questions",
                  ],
                  generationOrder: "last",
                }),
                makeSectionNode({
                  title: "Background and Scope",
                  purpose: "Establish the context, the source set, and the scope of the report.",
                  guidance: [
                    "Summarize the brief",
                    "Describe the relevant source materials",
                    "Clarify assumptions and boundaries",
                  ],
                  minWords: 450,
                  maxWords: 700,
                  generationOrder: 1,
                }),
                makeSectionNode({
                  title: "Core Findings",
                  purpose: "Present the main analysis and supporting evidence.",
                  guidance: [
                    "Organize findings into coherent themes",
                    "Tie each finding back to the evidence base",
                    "Differentiate facts, interpretation, and uncertainty",
                  ],
                  minWords: 1000,
                  maxWords: 1500,
                  dependsOn: ["background-and-scope"],
                  generationOrder: 2,
                }),
                makeSectionNode({
                  title: "Recommendations and Open Questions",
                  purpose: "Translate the findings into actions, decisions, and remaining gaps.",
                  guidance: [
                    "Recommend concrete next steps",
                    "Identify dependencies and risks",
                    "List the most important unresolved questions",
                  ],
                  minWords: 500,
                  maxWords: 800,
                  dependsOn: ["core-findings"],
                  generationOrder: 3,
                }),
              ];

  const outline: ReportPlanningOutline = {
    title: buildContextualReportTitle({
      fallbackTitle: input.title,
      brief: input.brief,
      fileRefs: input.fileRefs,
      ...(input.documents !== undefined ? { documents: input.documents } : {}),
    }),
    summary: `The report will synthesize ${sourceSummary} into a decision-ready structure aligned with the current brief.`,
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      summary: section.purpose,
      keyPoints: [...section.contentGuidance],
      wordTarget: {
        min: section.lengthTarget.minWords,
        max: section.lengthTarget.maxWords,
      },
    })),
  };

  return {
    outline,
    sectionTree: sections,
  };
}

function buildQuestionsMessage(input: {
  readonly brief: string;
  readonly fileRefs: ReadonlyArray<string>;
  readonly questions: ReadonlyArray<ReportPlanningQuestion>;
  readonly createdAt: string;
}): ReportPlanningMessage {
  const sourceSummary =
    input.fileRefs.length === 0
      ? "the brief"
      : `${input.fileRefs.length} attached source document${input.fileRefs.length === 1 ? "" : "s"}`;
  const questionList = input.questions.map(
    (question, index) => `${index + 1}. ${question.question}`,
  );
  return makePlanningMessage({
    role: "assistant",
    createdAt: input.createdAt,
    text: [
      `I reviewed ${sourceSummary} and the current report prompt.`,
      "Before I lock the report structure, I need a few clarifications:",
      "",
      ...questionList,
      "",
      "Reply in free text and I will turn that into a proposed section structure for approval.",
    ].join("\n"),
  });
}

function buildOutlineMessage(input: {
  readonly outline: ReportPlanningOutline;
  readonly createdAt: string;
  readonly prefix: string;
}): ReportPlanningMessage {
  const sectionLines = input.outline.sections.map(
    (section, index) => `${index + 1}. ${section.title}: ${section.summary}`,
  );
  return makePlanningMessage({
    role: "assistant",
    createdAt: input.createdAt,
    text: [
      input.prefix,
      "",
      `Proposed structure: ${input.outline.title}`,
      "",
      ...sectionLines,
      "",
      "Approve this structure to finalize the report plan, or reply with changes and I will revise it.",
    ].join("\n"),
  });
}

export function beginReportPlanning(input: {
  readonly plan: ReportPlan;
  readonly brief: string;
  readonly fileRefs: ReadonlyArray<string>;
  readonly documents?: ReadonlyArray<ReportSourceDocument>;
  readonly createdAt: string;
}): ReportPlan {
  const brief = input.brief.trim();
  const fileRefs = normalizeReportFileRefs(input.fileRefs);
  const questions = deriveClarificationQuestions({ brief, fileRefs });

  if (questions.length > 0) {
    const planning: ReportPlanningState = {
      status: "clarification-needed",
      pendingQuestions: [...questions],
      proposedOutline: null,
      lastOrchestratedAt: input.createdAt,
      conversation: [
        buildQuestionsMessage({
          brief,
          fileRefs,
          questions,
          createdAt: input.createdAt,
        }),
      ],
    };

    return {
      ...input.plan,
      status: "draft",
      metadata: {
        ...input.plan.metadata,
        brief,
      },
      globalSourceConfig: {
        ...input.plan.globalSourceConfig,
        userDocuments: {
          ...input.plan.globalSourceConfig.userDocuments,
          fileRefs,
          documents: input.documents
            ? normalizeReportSourceDocuments(input.documents)
            : input.plan.globalSourceConfig.userDocuments.documents,
        },
      },
      planning,
    };
  }

  const { outline, sectionTree } = buildOutline({
    title: input.plan.metadata.title,
    brief,
    fileRefs,
    ...(input.documents !== undefined ? { documents: input.documents } : {}),
  });

  return {
    ...input.plan,
    status: "draft",
    metadata: {
      ...input.plan.metadata,
      brief,
    },
    globalSourceConfig: {
      ...input.plan.globalSourceConfig,
      userDocuments: {
        ...input.plan.globalSourceConfig.userDocuments,
        fileRefs,
        documents: input.documents
          ? normalizeReportSourceDocuments(input.documents)
          : input.plan.globalSourceConfig.userDocuments.documents,
      },
    },
    sectionTree: [...sectionTree],
    planning: {
      status: "awaiting-approval",
      pendingQuestions: [],
      proposedOutline: outline,
      lastOrchestratedAt: input.createdAt,
      conversation: [
        buildOutlineMessage({
          outline,
          createdAt: input.createdAt,
          prefix: "I have enough context to draft the report structure.",
        }),
      ],
    },
  };
}

function appendClarificationToBrief(brief: string, response: string): string {
  return `${brief.trim()}\n\nUser clarification:\n${response.trim()}`;
}

export function respondToReportPlanning(input: {
  readonly plan: ReportPlan;
  readonly response: string;
  readonly createdAt: string;
}): ReportPlan {
  const response = input.response.trim();
  const conversation = [
    ...input.plan.planning.conversation,
    makePlanningMessage({
      role: "user",
      text: response,
      createdAt: input.createdAt,
    }),
  ];

  const nextBrief = appendClarificationToBrief(input.plan.metadata.brief, response);
  const fileRefs = normalizeReportFileRefs(input.plan.globalSourceConfig.userDocuments.fileRefs);
  const { outline, sectionTree } = buildOutline({
    title: input.plan.metadata.title,
    brief: nextBrief,
    fileRefs,
    documents: input.plan.globalSourceConfig.userDocuments.documents,
  });

  const assistantPrefix =
    input.plan.planning.status === "clarification-needed"
      ? "Thanks. I have enough context now and drafted the report structure below."
      : "I revised the report structure using your latest guidance.";

  return {
    ...input.plan,
    status: "draft",
    metadata: {
      ...input.plan.metadata,
      brief: nextBrief,
    },
    sectionTree: [...sectionTree],
    planning: {
      status: "awaiting-approval",
      pendingQuestions: [],
      proposedOutline: outline,
      lastOrchestratedAt: input.createdAt,
      conversation: [
        ...conversation,
        buildOutlineMessage({
          outline,
          createdAt: input.createdAt,
          prefix: assistantPrefix,
        }),
      ],
    },
  };
}

export function approveReportPlanning(input: {
  readonly plan: ReportPlan;
  readonly createdAt: string;
}): ReportPlan {
  return {
    ...input.plan,
    status: "finalized",
    planning: {
      ...input.plan.planning,
      status: "approved",
      pendingQuestions: [],
      lastOrchestratedAt: input.createdAt,
      conversation: [
        ...input.plan.planning.conversation,
        makePlanningMessage({
          role: "assistant",
          text: "The section structure is approved. The report plan is finalized and ready for report orchestration.",
          createdAt: input.createdAt,
        }),
      ],
    },
  };
}
