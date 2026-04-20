import {
  ReportCreateDraftInput,
  type ReportDeleteResult,
  type ReportExecutionState,
  ReportId,
  ReportPlan,
  ReportMutationResult,
  ReportServiceError,
  type ReportSnapshot,
  type ReportRecord,
  ReportRecord as ReportRecordSchema,
  ReportExecutionState as ReportExecutionStateSchema,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { buildInitialExecutionState, ReportPlanGraphError } from "../planGraph.ts";
import {
  approveReportPlanning,
  beginReportPlanning,
  respondToReportPlanning,
} from "../planning.ts";
import { ReportService, type ReportServiceShape } from "../Services/ReportService.ts";
import { toPersistenceSqlError } from "../../persistence/Errors.ts";

const ReportRecordDbRow = ReportRecordSchema.mapFields(
  Struct.assign({
    plan: Schema.fromJsonString(ReportPlan),
    latestRun: Schema.NullOr(Schema.fromJsonString(ReportExecutionStateSchema)),
  }),
);
type ReportRecordDbRow = typeof ReportRecordDbRow.Type;

function nowIso(): string {
  return new Date().toISOString();
}

function toReportServiceError(message: string, cause?: unknown): ReportServiceError {
  return new ReportServiceError({
    message,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function buildDefaultPlan(input: ReportCreateDraftInput): ReportPlan {
  return {
    version: "1.0",
    status: "draft",
    metadata: {
      title: input.title,
      reportType: input.reportType,
      audience: "general",
      tone: "clear, analytical",
      brief: input.brief,
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
    sectionTree: [
      {
        id: "sec_1",
        title: "Executive Summary",
        depth: 0,
        purpose: "Summarize the report's key findings and decisions.",
        contentGuidance: [
          "State the headline finding",
          "Summarize the most important evidence",
          "Outline the recommended action",
        ],
        mustNotDo: ["Introduce findings that are not covered elsewhere"],
        lengthTarget: { minWords: 300, maxWords: 500 },
        sourceOverride: null,
        dependsOn: ["sec_2", "sec_3"],
        generationOrder: "last",
        children: [],
      },
      {
        id: "sec_2",
        title: "Analysis",
        depth: 0,
        purpose: "Present the primary analysis needed to answer the report brief.",
        contentGuidance: [
          "Summarize the relevant context",
          "Present supporting evidence",
          "Explain the implications of the evidence",
        ],
        mustNotDo: ["Use uncited claims"],
        lengthTarget: { minWords: 1200, maxWords: 1800 },
        sourceOverride: null,
        dependsOn: [],
        generationOrder: 1,
        children: [],
      },
      {
        id: "sec_3",
        title: "Recommendations",
        depth: 0,
        purpose: "Translate the analysis into specific next steps.",
        contentGuidance: [
          "Recommend the most important actions",
          "Tie each action to evidence from the analysis",
          "Call out the main risks or dependencies",
        ],
        mustNotDo: ["Repeat the analysis section verbatim"],
        lengthTarget: { minWords: 500, maxWords: 800 },
        sourceOverride: null,
        dependsOn: ["sec_2"],
        generationOrder: 2,
        children: [],
      },
    ],
    crossCuttingInstructions: {
      dataPresentation: "Use tables or bullet summaries when that improves clarity.",
      consistencyRules: ["Keep terminology consistent across all sections."],
      excludedTopics: [],
    },
    planning: {
      status: "idle",
      pendingQuestions: [],
      conversation: [],
      proposedOutline: null,
      lastOrchestratedAt: null,
    },
  };
}

const makeReportService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listReportRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ReportRecordDbRow,
    execute: () =>
      sql`
        SELECT
          report_id AS "id",
          title,
          folder,
          status,
          plan_json AS "plan",
          latest_run_json AS "latestRun",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM reports
        ORDER BY updated_at DESC, report_id ASC
      `,
  });

  const getReportRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ reportId: ReportId }),
    Result: ReportRecordDbRow,
    execute: ({ reportId }) =>
      sql`
        SELECT
          report_id AS "id",
          title,
          folder,
          status,
          plan_json AS "plan",
          latest_run_json AS "latestRun",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM reports
        WHERE report_id = ${reportId}
      `,
  });

  const upsertReportRow = SqlSchema.void({
    Request: ReportRecordSchema,
    execute: (row) =>
      sql`
        INSERT INTO reports (
          report_id,
          title,
          folder,
          status,
          plan_json,
          latest_run_json,
          created_at,
          updated_at
        ) VALUES (
          ${row.id},
          ${row.title},
          ${row.folder},
          ${row.status},
          ${JSON.stringify(row.plan)},
          ${row.latestRun !== null ? JSON.stringify(row.latestRun) : null},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (report_id)
        DO UPDATE SET
          title = excluded.title,
          folder = excluded.folder,
          status = excluded.status,
          plan_json = excluded.plan_json,
          latest_run_json = excluded.latest_run_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const listReports = () =>
    listReportRows().pipe(
      Effect.mapError((cause) =>
        toReportServiceError(
          "Failed to load reports snapshot.",
          toPersistenceSqlError("ReportService.listReports")(cause),
        ),
      ),
    );

  const loadReport = Effect.fn("loadReport")(function* (reportId: ReportId) {
    const report = yield* getReportRow({ reportId }).pipe(
      Effect.mapError((cause) =>
        toReportServiceError(
          `Failed to load report '${reportId}'.`,
          toPersistenceSqlError("ReportService.loadReport")(cause),
        ),
      ),
    );
    if (Option.isNone(report)) {
      return yield* toReportServiceError(`Report '${reportId}' was not found.`);
    }
    return report.value;
  });

  const saveReport = (report: ReportRecord) =>
    upsertReportRow(report).pipe(
      Effect.mapError((cause) =>
        toReportServiceError(
          `Failed to persist report '${report.id}'.`,
          toPersistenceSqlError("ReportService.saveReport")(cause),
        ),
      ),
      Effect.as({ report } satisfies ReportMutationResult),
    );

  const deleteReportRow = SqlSchema.void({
    Request: Schema.Struct({ reportId: ReportId }),
    execute: ({ reportId }) =>
      sql`
        DELETE FROM reports
        WHERE report_id = ${reportId}
      `,
  });

  const getSnapshot: ReportServiceShape["getSnapshot"] = () =>
    listReports().pipe(Effect.map((reports) => ({ reports }) satisfies ReportSnapshot));

  const createDraft: ReportServiceShape["createDraft"] = (input) =>
    Effect.gen(function* () {
      const createdAt = nowIso();
      const report: ReportRecord = {
        id: `report:${crypto.randomUUID()}` as ReportRecord["id"],
        title: input.title,
        folder: null,
        status: "draft",
        plan: buildDefaultPlan(input),
        latestRun: null,
        createdAt,
        updatedAt: createdAt,
      };
      return yield* saveReport(report);
    }).pipe(
      Effect.mapError((cause) =>
        Schema.is(ReportServiceError)(cause)
          ? cause
          : toReportServiceError("Failed to create report draft.", cause),
      ),
    );

  const updateMeta: ReportServiceShape["updateMeta"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* loadReport(input.reportId);
      const title = input.title ?? existing.title;
      const folder = input.folder !== undefined ? input.folder : existing.folder;
      const report: ReportRecord = {
        ...existing,
        title,
        folder,
        plan: {
          ...existing.plan,
          metadata: {
            ...existing.plan.metadata,
            title,
          },
        },
        updatedAt: nowIso(),
      };
      return yield* saveReport(report);
    }).pipe(
      Effect.mapError((cause) =>
        Schema.is(ReportServiceError)(cause)
          ? cause
          : toReportServiceError(`Failed to update report '${input.reportId}'.`, cause),
      ),
    );

  const updatePlan: ReportServiceShape["updatePlan"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* loadReport(input.reportId);
      if (existing.status === "running") {
        return yield* toReportServiceError(
          `Report '${input.reportId}' is running and its plan cannot be edited.`,
        );
      }

      const updatedPlan: ReportPlan = {
        ...input.plan,
        metadata: {
          ...input.plan.metadata,
          title: input.plan.metadata.title,
        },
      };

      const report: ReportRecord = {
        ...existing,
        title: updatedPlan.metadata.title,
        status: updatedPlan.status === "finalized" ? "approved" : "draft",
        plan: updatedPlan,
        latestRun: null,
        updatedAt: nowIso(),
      };
      return yield* saveReport(report);
    }).pipe(
      Effect.mapError((cause) =>
        Schema.is(ReportServiceError)(cause)
          ? cause
          : toReportServiceError(`Failed to update report '${input.reportId}'.`, cause),
      ),
    );

  const beginPlanning: ReportServiceShape["beginPlanning"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* loadReport(input.reportId);
      if (existing.status === "running") {
        return yield* toReportServiceError(
          `Report '${input.reportId}' is running and cannot re-enter planning.`,
        );
      }

      const createdAt = nowIso();

      const plan = beginReportPlanning({
        plan: existing.plan,
        brief: input.brief,
        fileRefs: input.fileRefs,
        createdAt,
      });

      const report: ReportRecord = {
        ...existing,
        status: "draft",
        plan,
        latestRun: null,
        updatedAt: createdAt,
      };

      return yield* saveReport(report);
    }).pipe(
      Effect.mapError((cause) =>
        Schema.is(ReportServiceError)(cause)
          ? cause
          : toReportServiceError(`Failed to begin planning for report '${input.reportId}'.`, cause),
      ),
    );

  const respondToPlanning: ReportServiceShape["respondToPlanning"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* loadReport(input.reportId);
      if (existing.status === "running") {
        return yield* toReportServiceError(
          `Report '${input.reportId}' is running and cannot accept planning feedback.`,
        );
      }

      if (
        existing.plan.planning.status !== "clarification-needed" &&
        existing.plan.planning.status !== "awaiting-approval"
      ) {
        return yield* toReportServiceError(
          `Report '${input.reportId}' is not waiting for planning input.`,
        );
      }

      const createdAt = nowIso();

      const plan = respondToReportPlanning({
        plan: existing.plan,
        response: input.response,
        createdAt,
      });

      const report: ReportRecord = {
        ...existing,
        status: "draft",
        plan,
        latestRun: null,
        updatedAt: createdAt,
      };

      return yield* saveReport(report);
    }).pipe(
      Effect.mapError((cause) =>
        Schema.is(ReportServiceError)(cause)
          ? cause
          : toReportServiceError(
              `Failed to apply planning response for report '${input.reportId}'.`,
              cause,
            ),
      ),
    );

  const approve: ReportServiceShape["approve"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* loadReport(input.reportId);
      const createdAt = nowIso();
      const nextPlan: ReportPlan | null =
        existing.plan.metadata.reportType === "user_guided"
          ? (() => {
              if (existing.plan.planning.status !== "awaiting-approval") {
                return null;
              }
              return approveReportPlanning({
                plan: existing.plan,
                createdAt,
              });
            })()
          : {
              ...existing.plan,
              status: "finalized" satisfies ReportPlan["status"],
            };

      if (!nextPlan) {
        return yield* toReportServiceError(
          `Report '${input.reportId}' must have a proposed structure before it can be approved.`,
        );
      }

      const report: ReportRecord = {
        ...existing,
        status: "approved",
        plan: nextPlan,
        updatedAt: createdAt,
      };
      return yield* saveReport(report);
    }).pipe(
      Effect.mapError((cause) =>
        Schema.is(ReportServiceError)(cause)
          ? cause
          : toReportServiceError(`Failed to approve report '${input.reportId}'.`, cause),
      ),
    );

  const startRun: ReportServiceShape["startRun"] = (input) =>
    Effect.gen(function* () {
      const existing = yield* loadReport(input.reportId);
      if (existing.plan.status !== "finalized") {
        return yield* toReportServiceError(
          `Report '${input.reportId}' must be approved before orchestration can start.`,
        );
      }

      const startedAt = nowIso();
      const latestRun = yield* Effect.try({
        try: () =>
          buildInitialExecutionState({
            runId: `report-run:${crypto.randomUUID()}` as ReportExecutionState["runId"],
            plan: existing.plan,
            startedAt,
          }),
        catch: (error) =>
          toReportServiceError(
            error instanceof ReportPlanGraphError
              ? error.message
              : `Failed to prepare report orchestration for '${input.reportId}'.`,
            error,
          ),
      });

      const report: ReportRecord = {
        ...existing,
        status: "running",
        latestRun,
        updatedAt: startedAt,
      };
      return yield* saveReport(report);
    }).pipe(
      Effect.mapError((cause) =>
        Schema.is(ReportServiceError)(cause)
          ? cause
          : toReportServiceError(`Failed to start report run '${input.reportId}'.`, cause),
      ),
    );

  const deleteReport: ReportServiceShape["delete"] = (input) =>
    Effect.gen(function* () {
      yield* loadReport(input.reportId);
      yield* deleteReportRow({ reportId: input.reportId }).pipe(
        Effect.mapError((cause) =>
          toReportServiceError(
            `Failed to delete report '${input.reportId}'.`,
            toPersistenceSqlError("ReportService.delete")(cause),
          ),
        ),
      );
      return {
        reportId: input.reportId,
      } satisfies ReportDeleteResult;
    }).pipe(
      Effect.mapError((cause) =>
        Schema.is(ReportServiceError)(cause)
          ? cause
          : toReportServiceError(`Failed to delete report '${input.reportId}'.`, cause),
      ),
    );

  return {
    getSnapshot,
    createDraft,
    updateMeta,
    updatePlan,
    beginPlanning,
    respondToPlanning,
    approve,
    startRun,
    delete: deleteReport,
  } satisfies ReportServiceShape;
});

export const ReportServiceLive = Layer.effect(ReportService, makeReportService);
