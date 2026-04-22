import {
  ReportApproveInput,
  ReportBeginPlanningInput,
  ReportChatInput,
  ReportCreateDraftInput,
  ReportDeleteInput,
  type ReportDeleteResult,
  type ReportMutationResult,
  ReportRespondToPlanningInput,
  ReportSnapshot,
  ReportStartRunInput,
  ReportUpdateArtifactInput,
  ReportUpdateMetaInput,
  ReportUpdatePlanInput,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ReportServiceError } from "@t3tools/contracts";

export interface ReportServiceShape {
  readonly getSnapshot: () => Effect.Effect<ReportSnapshot, ReportServiceError>;
  readonly createDraft: (
    input: ReportCreateDraftInput,
  ) => Effect.Effect<ReportMutationResult, ReportServiceError>;
  readonly updateMeta: (
    input: ReportUpdateMetaInput,
  ) => Effect.Effect<ReportMutationResult, ReportServiceError>;
  readonly updatePlan: (
    input: ReportUpdatePlanInput,
  ) => Effect.Effect<ReportMutationResult, ReportServiceError>;
  readonly beginPlanning: (
    input: ReportBeginPlanningInput,
  ) => Effect.Effect<ReportMutationResult, ReportServiceError>;
  readonly respondToPlanning: (
    input: ReportRespondToPlanningInput,
  ) => Effect.Effect<ReportMutationResult, ReportServiceError>;
  readonly approve: (
    input: ReportApproveInput,
  ) => Effect.Effect<ReportMutationResult, ReportServiceError>;
  readonly startRun: (
    input: ReportStartRunInput,
    onProgress?: (event: {
      at: string;
      kind: string;
      message: string;
      payload: unknown;
    }) => Promise<void>,
  ) => Effect.Effect<ReportMutationResult, ReportServiceError>;
  readonly updateArtifact: (
    input: ReportUpdateArtifactInput,
  ) => Effect.Effect<ReportMutationResult, ReportServiceError>;
  readonly delete: (
    input: ReportDeleteInput,
  ) => Effect.Effect<ReportDeleteResult, ReportServiceError>;
  readonly chatWithReport: (
    input: ReportChatInput,
  ) => Effect.Effect<ReportMutationResult, ReportServiceError>;
}

export class ReportService extends ServiceMap.Service<ReportService, ReportServiceShape>()(
  "t3/report/Services/ReportService",
) {}
