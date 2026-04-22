import { describe, expect, it } from "vitest";

import type { ProviderApiKeys, ReportPlan } from "@t3tools/contracts";

import { applyPlanningDecision, generateReportExecution } from "./agent.ts";

function makePlan(overrides?: Partial<ReportPlan>): ReportPlan {
  return {
    version: "1.0",
    status: "draft",
    metadata: {
      title: "Q1 Report",
      reportType: "user_guided",
      audience: "general",
      tone: "clear, analytical",
      brief: "Summarize the uploaded documents.",
      targetLength: {
        minWords: 1200,
        maxWords: 1800,
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
        documents: [],
      },
      knowledgeBase: {
        enabled: false,
        collectionId: null,
      },
    },
    documentProfiles: [],
    sectionTree: [
      {
        id: "background",
        title: "Background",
        depth: 0,
        purpose: "Explain the source context.",
        contentGuidance: ["Summarize the relevant context."],
        mustNotDo: [],
        lengthTarget: { minWords: 300, maxWords: 450 },
        sourceOverride: null,
        dependsOn: [],
        generationOrder: 1,
        children: [],
      },
      {
        id: "summary",
        title: "Executive Summary",
        depth: 0,
        purpose: "Summarize the main takeaways.",
        contentGuidance: ["Synthesize the findings."],
        mustNotDo: [],
        lengthTarget: { minWords: 200, maxWords: 300 },
        sourceOverride: null,
        dependsOn: ["background"],
        generationOrder: "last",
        children: [],
      },
    ],
    crossCuttingInstructions: {
      dataPresentation: "Use bullets when helpful.",
      consistencyRules: [],
      excludedTopics: [],
    },
    orchestration: {
      modelSelection: null,
      agentSwarm: {
        orchestratorModel: null,
        sectionAgentModel: null,
        enabledTools: ["search_documents"],
        maxToolCallsPerSection: 8,
        maxSectionRetries: 3,
      },
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

describe("report agent helpers", () => {
  it("applies clarification decisions and persists uploaded documents", () => {
    const plan = applyPlanningDecision({
      plan: makePlan(),
      brief: "Summarize these files.",
      fileRefs: ["evidence.md"],
      documents: [
        {
          name: "evidence.md",
          mimeType: "text/markdown",
          textContent: "# Evidence",
        },
      ],
      createdAt: "2026-04-20T10:00:00.000Z",
      response: null,
      decision: {
        status: "clarification-needed",
        assistantMessage: "I need two clarifications before I lock the structure.",
        questions: [
          "Who is the primary audience for this report?",
          "What reporting period should this cover?",
        ],
        audience: "leadership",
        tone: "concise",
        outline: null,
      },
    });

    expect(plan.planning.status).toBe("clarification-needed");
    expect(plan.planning.pendingQuestions).toHaveLength(2);
    expect(plan.globalSourceConfig.userDocuments.documents[0]?.name).toBe("evidence.md");
    expect(plan.metadata.audience).toBe("leadership");
    expect(plan.metadata.tone).toBe("concise");
  });

  it("generates a completed fallback execution artifact without API keys", async () => {
    const apiKeys: ProviderApiKeys = {
      openai: "",
      claude: "",
      gemini: "",
    };

    const result = await generateReportExecution({
      apiKeys,
      plan: makePlan(),
      runId: "report-run:test" as never,
      startedAt: "2026-04-20T10:00:00.000Z",
    });

    expect(result.reportStatus).toBe("completed");
    expect(result.latestRun.status).toBe("completed");
    expect(result.latestRun.finalArtifact?.content).toContain("# Q1 Report");
    expect(
      result.latestRun.sectionRuns.every((sectionRun) => sectionRun.status === "completed"),
    ).toBe(true);
  });

  it("assembles the final artifact in approved section order instead of dependency order", async () => {
    const apiKeys: ProviderApiKeys = {
      openai: "",
      claude: "",
      gemini: "",
    };
    const plan = makePlan({
      sectionTree: [
        {
          id: "summary",
          title: "Executive Summary",
          depth: 0,
          purpose: "Summarize the main takeaways.",
          contentGuidance: ["Synthesize the findings."],
          mustNotDo: [],
          lengthTarget: { minWords: 200, maxWords: 300 },
          sourceOverride: null,
          dependsOn: ["background"],
          generationOrder: "last",
          children: [],
        },
        {
          id: "background",
          title: "Background",
          depth: 0,
          purpose: "Explain the source context.",
          contentGuidance: ["Summarize the relevant context."],
          mustNotDo: [],
          lengthTarget: { minWords: 300, maxWords: 450 },
          sourceOverride: null,
          dependsOn: [],
          generationOrder: 1,
          children: [],
        },
      ],
    });

    const result = await generateReportExecution({
      apiKeys,
      plan,
      runId: "report-run:presentation-order" as never,
      startedAt: "2026-04-20T10:00:00.000Z",
    });

    const content = result.latestRun.finalArtifact?.content ?? "";
    expect(content.indexOf("## Executive Summary")).toBeGreaterThan(-1);
    expect(content.indexOf("## Background")).toBeGreaterThan(-1);
    expect(content.indexOf("## Executive Summary")).toBeLessThan(content.indexOf("## Background"));
  });
});
