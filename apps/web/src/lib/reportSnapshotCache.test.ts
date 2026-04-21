import type { ReportPlan, ReportRecord, ReportSnapshot } from "@t3tools/contracts";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { removeReportSnapshotRecord, upsertReportSnapshotRecord } from "./reportSnapshotCache";
import { reportQueryKeys } from "./reportReactQuery";

function toReportId(value: string): ReportRecord["id"] {
  return value as ReportRecord["id"];
}

function createReport(
  overrides: Partial<ReportRecord> & Pick<ReportRecord, "id" | "title">,
): ReportRecord {
  const { id, title, ...rest } = overrides;
  const plan = {
    version: "1",
    status: "draft",
    metadata: {
      title,
      reportType: "brief",
      audience: "team",
      tone: "neutral",
      brief: "summary",
      targetLength: {
        minWords: 100,
        maxWords: 200,
      },
      outputFormats: ["markdown"],
      language: "en",
      citationStyle: "inline",
    },
    globalSourceConfig: {
      webSearch: {
        enabled: false,
        preferredDomains: [],
        recencyFilter: null,
        queriesHint: [],
      },
      userDocuments: {
        enabled: false,
        fileRefs: [],
        documents: [],
      },
      knowledgeBase: {
        enabled: false,
        collectionId: null,
      },
    },
    documentProfiles: [],
    sectionTree: [],
    crossCuttingInstructions: {
      dataPresentation: "plain",
      consistencyRules: [],
      excludedTopics: [],
    },
    orchestration: {
      modelSelection: null,
    },
    planning: {
      status: "idle",
      pendingQuestions: [],
      conversation: [],
      proposedOutline: null,
      lastOrchestratedAt: null,
    },
  } satisfies ReportPlan;

  return {
    id,
    title,
    folder: null,
    status: "draft",
    plan,
    latestRun: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...rest,
  };
}

function getSnapshot(queryClient: QueryClient): ReportSnapshot {
  return queryClient.getQueryData<ReportSnapshot>(reportQueryKeys.snapshot()) ?? { reports: [] };
}

describe("reportSnapshotCache", () => {
  it("replaces an existing report record in the cached snapshot", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<ReportSnapshot>(reportQueryKeys.snapshot(), {
      reports: [
        createReport({ id: toReportId("report-1"), title: "Original", folder: "Folder A" }),
      ],
    });

    upsertReportSnapshotRecord(
      queryClient,
      createReport({ id: toReportId("report-1"), title: "Renamed", folder: null }),
    );

    expect(getSnapshot(queryClient).reports).toEqual([
      createReport({ id: toReportId("report-1"), title: "Renamed", folder: null }),
    ]);
  });

  it("removes a report record from the cached snapshot", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<ReportSnapshot>(reportQueryKeys.snapshot(), {
      reports: [
        createReport({ id: toReportId("report-1"), title: "First" }),
        createReport({ id: toReportId("report-2"), title: "Second" }),
      ],
    });

    removeReportSnapshotRecord(queryClient, toReportId("report-1"));

    expect(getSnapshot(queryClient).reports).toEqual([
      createReport({ id: toReportId("report-2"), title: "Second" }),
    ]);
  });
});
