import { describe, expect, it } from "vitest";

import type { ReportPlan } from "@t3tools/contracts";

import { approveReportPlanning, beginReportPlanning, respondToReportPlanning } from "./planning.ts";

function makePlan(overrides?: Partial<ReportPlan>): ReportPlan {
  return {
    version: "1.0",
    status: "draft",
    metadata: {
      title: "OpenReport Draft",
      reportType: "user_guided",
      audience: "general",
      tone: "clear, analytical",
      brief: "Summarize the attached documents.",
      targetLength: {
        minWords: 2500,
        maxWords: 4000,
      },
      outputFormats: ["markdown"],
      language: "en",
      citationStyle: "inline",
    },
    globalSourceConfig: {
      webSearch: {
        enabled: true,
        preferredDomains: [],
        recencyFilter: null,
        queriesHint: [],
      },
      userDocuments: {
        enabled: true,
        fileRefs: [],
      },
      knowledgeBase: {
        enabled: false,
        collectionId: null,
      },
    },
    documentProfiles: [],
    sectionTree: [],
    crossCuttingInstructions: {
      dataPresentation: "Use tables when helpful.",
      consistencyRules: ["Keep terminology consistent."],
      excludedTopics: [],
    },
    planning: {
      status: "idle",
      pendingQuestions: [],
      conversation: [],
      proposedOutline: null,
      lastOrchestratedAt: null,
    },
    ...overrides,
  };
}

describe("report planning orchestration", () => {
  it("asks clarification questions when the brief is underspecified", () => {
    const plan = beginReportPlanning({
      plan: makePlan(),
      brief: "Summarize these documents for me.",
      fileRefs: ["q1.pdf", "q2.pdf"],
      createdAt: "2026-04-20T10:00:00.000Z",
    });

    expect(plan.planning.status).toBe("clarification-needed");
    expect(plan.planning.pendingQuestions.length).toBeGreaterThan(0);
    expect(plan.planning.proposedOutline).toBeNull();
    expect(plan.planning.conversation.at(-1)?.text).toContain("Before I lock the report structure");
  });

  it("proposes a structure immediately when the brief already has enough context", () => {
    const plan = beginReportPlanning({
      plan: makePlan(),
      brief:
        "Create an executive brief for leadership covering Q1 2026 budget variance, the main financial risks, and the recommended actions.",
      fileRefs: ["budget-q1-2026.pdf"],
      createdAt: "2026-04-20T10:00:00.000Z",
    });

    expect(plan.planning.status).toBe("awaiting-approval");
    expect(plan.planning.pendingQuestions).toHaveLength(0);
    expect(plan.planning.proposedOutline?.sections.length).toBeGreaterThan(0);
    expect(plan.sectionTree.length).toBeGreaterThan(0);
  });

  it("turns a clarification reply into a proposed outline and final approval state", () => {
    const started = beginReportPlanning({
      plan: makePlan(),
      brief: "Summarize these documents for me.",
      fileRefs: ["source-a.pdf", "source-b.pdf"],
      createdAt: "2026-04-20T10:00:00.000Z",
    });

    const responded = respondToReportPlanning({
      plan: started,
      response:
        "This is for the leadership team. Focus on Q1 2026 and treat source-a.pdf as the primary source. Keep it concise with findings, risks, and recommendations.",
      createdAt: "2026-04-20T10:05:00.000Z",
    });

    const approved = approveReportPlanning({
      plan: responded,
      createdAt: "2026-04-20T10:06:00.000Z",
    });

    expect(responded.planning.status).toBe("awaiting-approval");
    expect(responded.planning.proposedOutline).not.toBeNull();
    expect(responded.metadata.brief).toContain("User clarification:");
    expect(approved.status).toBe("finalized");
    expect(approved.planning.status).toBe("approved");
    expect(approved.planning.conversation.at(-1)?.text).toContain("approved");
  });
});
