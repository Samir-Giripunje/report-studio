import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ReportId,
  ReportRunId,
  TrimmedString,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { ModelSelection } from "./orchestration";

export const REPORT_WS_METHODS = {
  getSnapshot: "reports.getSnapshot",
  createDraft: "reports.createDraft",
  updateMeta: "reports.updateMeta",
  updatePlan: "reports.updatePlan",
  beginPlanning: "reports.beginPlanning",
  respondToPlanning: "reports.respondToPlanning",
  approve: "reports.approve",
  startRun: "reports.startRun",
  updateArtifact: "reports.updateArtifact",
  delete: "reports.delete",
  chatWithReport: "reports.chatWithReport",
} as const;

export const ReportPlanStatus = Schema.Literals(["draft", "finalized"]);
export type ReportPlanStatus = typeof ReportPlanStatus.Type;

export const ReportStatus = Schema.Literals([
  "draft",
  "approved",
  "running",
  "completed",
  "failed",
]);
export type ReportStatus = typeof ReportStatus.Type;

export const ReportRunStatus = Schema.Literals(["running", "completed", "failed"]);
export type ReportRunStatus = typeof ReportRunStatus.Type;

export const ReportSectionRunStatus = Schema.Literals([
  "blocked",
  "ready",
  "running",
  "completed",
  "failed",
]);
export type ReportSectionRunStatus = typeof ReportSectionRunStatus.Type;

export const ReportOutputFormat = Schema.Literals(["markdown", "html", "pdf", "docx"]);
export type ReportOutputFormat = typeof ReportOutputFormat.Type;

export const ReportCitationStyle = Schema.Literals(["inline", "footnote", "endnote"]);
export type ReportCitationStyle = typeof ReportCitationStyle.Type;

export const ReportCitation = Schema.Struct({
  /** 1-based numeric index used as the in-text marker [N]. */
  index: PositiveInt,
  /** Exact document filename as returned by list_documents. */
  documentName: TrimmedNonEmptyString,
  /** Short excerpt from the source document for hover preview (~250 chars). */
  excerpt: Schema.String.pipe(Schema.withDecodingDefault(() => "")),
});
export type ReportCitation = typeof ReportCitation.Type;

export const ReportTopicCoverageLevel = Schema.Literals(["none", "low", "medium", "high"]);
export type ReportTopicCoverageLevel = typeof ReportTopicCoverageLevel.Type;

export const ReportLengthTarget = Schema.Struct({
  minWords: PositiveInt,
  maxWords: PositiveInt,
});
export type ReportLengthTarget = typeof ReportLengthTarget.Type;

export const ReportMetadata = Schema.Struct({
  title: TrimmedNonEmptyString,
  reportType: TrimmedNonEmptyString,
  audience: TrimmedNonEmptyString,
  tone: TrimmedNonEmptyString,
  brief: TrimmedNonEmptyString,
  targetLength: ReportLengthTarget,
  outputFormats: Schema.Array(ReportOutputFormat),
  language: TrimmedNonEmptyString,
  citationStyle: ReportCitationStyle,
});
export type ReportMetadata = typeof ReportMetadata.Type;

export const ReportWebSearchSourceConfig = Schema.Struct({
  enabled: Schema.Boolean,
  preferredDomains: Schema.Array(TrimmedNonEmptyString),
  recencyFilter: Schema.NullOr(TrimmedNonEmptyString),
  queriesHint: Schema.Array(TrimmedNonEmptyString),
});
export type ReportWebSearchSourceConfig = typeof ReportWebSearchSourceConfig.Type;

export const ReportSourceDocument = Schema.Struct({
  name: TrimmedNonEmptyString,
  mimeType: TrimmedNonEmptyString,
  textContent: TrimmedString,
});
export type ReportSourceDocument = typeof ReportSourceDocument.Type;

export const ReportChatInput = Schema.Struct({
  reportId: ReportId,
  message: TrimmedNonEmptyString,
});
export type ReportChatInput = typeof ReportChatInput.Type;

export const ReportUserDocumentsSourceConfig = Schema.Struct({
  enabled: Schema.Boolean,
  fileRefs: Schema.Array(TrimmedNonEmptyString),
  documents: Schema.Array(ReportSourceDocument),
});
export type ReportUserDocumentsSourceConfig = typeof ReportUserDocumentsSourceConfig.Type;

export const ReportKnowledgeBaseSourceConfig = Schema.Struct({
  enabled: Schema.Boolean,
  collectionId: Schema.NullOr(TrimmedNonEmptyString),
});
export type ReportKnowledgeBaseSourceConfig = typeof ReportKnowledgeBaseSourceConfig.Type;

export const ReportSourceConfig = Schema.Struct({
  webSearch: ReportWebSearchSourceConfig,
  userDocuments: ReportUserDocumentsSourceConfig,
  knowledgeBase: ReportKnowledgeBaseSourceConfig,
});
export type ReportSourceConfig = typeof ReportSourceConfig.Type;

export const ReportDocumentProfileSection = Schema.Struct({
  title: TrimmedNonEmptyString,
  pages: Schema.Tuple([PositiveInt, PositiveInt]),
});
export type ReportDocumentProfileSection = typeof ReportDocumentProfileSection.Type;

export const ReportDocumentProfile = Schema.Struct({
  docId: TrimmedNonEmptyString,
  docType: TrimmedNonEmptyString,
  entity: Schema.NullOr(TrimmedNonEmptyString),
  period: Schema.NullOr(TrimmedNonEmptyString),
  sectionsDetected: Schema.Array(ReportDocumentProfileSection),
  topicCoverage: Schema.Record(TrimmedNonEmptyString, ReportTopicCoverageLevel),
});
export type ReportDocumentProfile = typeof ReportDocumentProfile.Type;

export interface ReportSectionNode {
  readonly id: string;
  readonly title: string;
  readonly depth: number;
  readonly purpose: string;
  readonly contentGuidance: ReadonlyArray<string>;
  readonly mustNotDo: ReadonlyArray<string>;
  readonly lengthTarget: ReportLengthTarget;
  readonly sourceOverride: ReportSourceConfig | null;
  readonly dependsOn: ReadonlyArray<string>;
  readonly generationOrder: number | "last";
  readonly children: ReadonlyArray<ReportSectionNode>;
}

const ReportSectionNodeRef = Schema.suspend(
  (): Schema.Codec<ReportSectionNode> => ReportSectionNode,
);
export const ReportSectionNode = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  depth: NonNegativeInt,
  purpose: TrimmedNonEmptyString,
  contentGuidance: Schema.Array(TrimmedNonEmptyString),
  mustNotDo: Schema.Array(TrimmedNonEmptyString),
  lengthTarget: ReportLengthTarget,
  sourceOverride: Schema.NullOr(ReportSourceConfig),
  dependsOn: Schema.Array(TrimmedNonEmptyString),
  generationOrder: Schema.Union([PositiveInt, Schema.Literal("last")]),
  children: Schema.Array(ReportSectionNodeRef),
});

export const ReportCrossCuttingInstructions = Schema.Struct({
  dataPresentation: TrimmedNonEmptyString,
  consistencyRules: Schema.Array(TrimmedNonEmptyString),
  excludedTopics: Schema.Array(TrimmedNonEmptyString),
});
export type ReportCrossCuttingInstructions = typeof ReportCrossCuttingInstructions.Type;

export const ReportPlanningStatus = Schema.Literals([
  "idle",
  "clarification-needed",
  "awaiting-approval",
  "approved",
]);
export type ReportPlanningStatus = typeof ReportPlanningStatus.Type;

export const ReportPlanningMessageRole = Schema.Literals(["assistant", "user", "system"]);
export type ReportPlanningMessageRole = typeof ReportPlanningMessageRole.Type;

export const ReportPlanningQuestion = Schema.Struct({
  id: TrimmedNonEmptyString,
  question: TrimmedNonEmptyString,
});
export type ReportPlanningQuestion = typeof ReportPlanningQuestion.Type;

export const ReportPlanningMessage = Schema.Struct({
  id: TrimmedNonEmptyString,
  role: ReportPlanningMessageRole,
  text: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type ReportPlanningMessage = typeof ReportPlanningMessage.Type;

export const ReportPlanningOutlineSectionWordTarget = Schema.Struct({
  min: Schema.Number,
  max: Schema.Number,
});
export type ReportPlanningOutlineSectionWordTarget =
  typeof ReportPlanningOutlineSectionWordTarget.Type;

export const ReportPlanningOutlineSection = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  /** Guidance bullets that will steer the section agent — shown to user before approval. */
  keyPoints: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
  /** Estimated word-count range for this section. Null when unknown. */
  wordTarget: Schema.NullOr(ReportPlanningOutlineSectionWordTarget).pipe(
    Schema.withDecodingDefault(() => null),
  ),
});
export type ReportPlanningOutlineSection = typeof ReportPlanningOutlineSection.Type;

export const ReportPlanningOutline = Schema.Struct({
  title: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  sections: Schema.Array(ReportPlanningOutlineSection).pipe(Schema.withDecodingDefault(() => [])),
});
export type ReportPlanningOutline = typeof ReportPlanningOutline.Type;

function buildDefaultReportPlanningState() {
  return {
    status: "idle" as const satisfies ReportPlanningStatus,
    pendingQuestions: [],
    conversation: [],
    proposedOutline: null,
    lastOrchestratedAt: null,
  };
}

const DEFAULT_REPORT_PLANNING_STATE = buildDefaultReportPlanningState();

export const ReportPlanningState = Schema.Struct({
  status: ReportPlanningStatus.pipe(
    Schema.withDecodingDefault(() => DEFAULT_REPORT_PLANNING_STATE.status),
  ),
  pendingQuestions: Schema.Array(ReportPlanningQuestion).pipe(Schema.withDecodingDefault(() => [])),
  conversation: Schema.Array(ReportPlanningMessage).pipe(Schema.withDecodingDefault(() => [])),
  proposedOutline: Schema.NullOr(ReportPlanningOutline).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  lastOrchestratedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
}).pipe(Schema.withDecodingDefault(buildDefaultReportPlanningState));
export type ReportPlanningState = typeof ReportPlanningState.Type;

// ---------------------------------------------------------------------------
// Agent swarm config — per-report advanced settings
// ---------------------------------------------------------------------------

export const REPORT_TOOL_NAMES = [
  "list_documents",
  "search_documents",
  "read_document",
  "list_tables",
  "read_table",
  "web_search",
] as const;
export type ReportToolName = (typeof REPORT_TOOL_NAMES)[number];
const ReportToolNameSchema = Schema.Literals(REPORT_TOOL_NAMES);

function buildDefaultAgentSwarmConfig() {
  return {
    orchestratorModel: null as ModelSelection | null,
    sectionAgentModel: null as ModelSelection | null,
    enabledTools: [
      "list_documents",
      "search_documents",
      "read_document",
      "list_tables",
      "read_table",
    ] as ReportToolName[],
    maxToolCallsPerSection: 15 as number,
    maxSectionRetries: 3 as number,
  };
}

export const ReportAgentSwarmConfig = Schema.Struct({
  /** Model used by the main orchestrator (planning + coordination). Null = use plan.orchestration.modelSelection. */
  orchestratorModel: Schema.NullOr(ModelSelection).pipe(Schema.withDecodingDefault(() => null)),
  /** Model used by each section sub-agent. Null = inherit from orchestratorModel. */
  sectionAgentModel: Schema.NullOr(ModelSelection).pipe(Schema.withDecodingDefault(() => null)),
  /** Which tools section sub-agents are allowed to call. */
  enabledTools: Schema.Array(ReportToolNameSchema).pipe(
    Schema.withDecodingDefault(
      () =>
        [
          "list_documents",
          "search_documents",
          "read_document",
          "list_tables",
          "read_table",
        ] as ReportToolName[],
    ),
  ),
  /** Hard cap on tool calls per section agent turn (1–20). */
  maxToolCallsPerSection: PositiveInt.pipe(Schema.withDecodingDefault(() => 15)),
  /** Max revision attempts per section before accepting best-effort draft (0 = no retries). */
  maxSectionRetries: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 3)),
}).pipe(Schema.withDecodingDefault(buildDefaultAgentSwarmConfig));
export type ReportAgentSwarmConfig = typeof ReportAgentSwarmConfig.Type;

function buildDefaultReportOrchestrationConfig() {
  return {
    modelSelection: null as ModelSelection | null,
    agentSwarm: buildDefaultAgentSwarmConfig(),
  };
}

const DEFAULT_REPORT_ORCHESTRATION_CONFIG = buildDefaultReportOrchestrationConfig();

export const ReportOrchestrationConfig = Schema.Struct({
  modelSelection: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefault(() => DEFAULT_REPORT_ORCHESTRATION_CONFIG.modelSelection),
  ),
  agentSwarm: ReportAgentSwarmConfig,
}).pipe(Schema.withDecodingDefault(buildDefaultReportOrchestrationConfig));
export type ReportOrchestrationConfig = typeof ReportOrchestrationConfig.Type;

export const ReportPlan = Schema.Struct({
  version: TrimmedNonEmptyString,
  status: ReportPlanStatus,
  metadata: ReportMetadata,
  globalSourceConfig: ReportSourceConfig,
  documentProfiles: Schema.Array(ReportDocumentProfile),
  sectionTree: Schema.Array(ReportSectionNode),
  crossCuttingInstructions: ReportCrossCuttingInstructions,
  orchestration: ReportOrchestrationConfig,
  planning: ReportPlanningState,
});
export type ReportPlan = typeof ReportPlan.Type;

export const ReportSectionRun = Schema.Struct({
  sectionId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  depth: NonNegativeInt,
  dependsOn: Schema.Array(TrimmedNonEmptyString),
  order: PositiveInt,
  status: ReportSectionRunStatus,
  retryCount: NonNegativeInt,
  lastError: Schema.NullOr(TrimmedNonEmptyString),
});
export type ReportSectionRun = typeof ReportSectionRun.Type;

export const ReportExecutionLogEntry = Schema.Struct({
  at: IsoDateTime,
  kind: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  payload: Schema.Unknown,
});
export type ReportExecutionLogEntry = typeof ReportExecutionLogEntry.Type;

export const ReportArtifact = Schema.Struct({
  format: ReportOutputFormat,
  content: Schema.String,
  /** Citation map produced at generation time — index → source document name.
   *  Preserved through manual edits so badges can be rendered for any [N] that
   *  remains in the user-edited content. */
  citations: Schema.Array(ReportCitation).pipe(Schema.withDecodingDefault(() => [])),
});
export type ReportArtifact = typeof ReportArtifact.Type;

export const ReportExecutionState = Schema.Struct({
  runId: ReportRunId,
  status: ReportRunStatus,
  sectionRuns: Schema.Array(ReportSectionRun),
  executionLog: Schema.Array(ReportExecutionLogEntry),
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  finalArtifact: Schema.NullOr(ReportArtifact),
});
export type ReportExecutionState = typeof ReportExecutionState.Type;

export const ReportRecord = Schema.Struct({
  id: ReportId,
  title: TrimmedNonEmptyString,
  folder: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  status: ReportStatus,
  plan: ReportPlan,
  latestRun: Schema.NullOr(ReportExecutionState),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ReportRecord = typeof ReportRecord.Type;

export const ReportSnapshot = Schema.Struct({
  reports: Schema.Array(ReportRecord),
});
export type ReportSnapshot = typeof ReportSnapshot.Type;

export const ReportCreateDraftInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  reportType: TrimmedNonEmptyString,
  brief: TrimmedNonEmptyString,
});
export type ReportCreateDraftInput = typeof ReportCreateDraftInput.Type;

export const ReportUpdatePlanInput = Schema.Struct({
  reportId: ReportId,
  plan: ReportPlan,
});
export type ReportUpdatePlanInput = typeof ReportUpdatePlanInput.Type;

export const ReportBeginPlanningInput = Schema.Struct({
  reportId: ReportId,
  brief: TrimmedNonEmptyString,
  fileRefs: Schema.Array(TrimmedNonEmptyString),
  documents: Schema.Array(ReportSourceDocument),
});
export type ReportBeginPlanningInput = typeof ReportBeginPlanningInput.Type;

export const ReportRespondToPlanningInput = Schema.Struct({
  reportId: ReportId,
  response: TrimmedNonEmptyString,
});
export type ReportRespondToPlanningInput = typeof ReportRespondToPlanningInput.Type;

export const ReportUpdateMetaInput = Schema.Struct({
  reportId: ReportId,
  title: Schema.optionalKey(TrimmedNonEmptyString),
  folder: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  modelSelection: Schema.optionalKey(Schema.NullOr(ModelSelection)),
  agentSwarm: Schema.optionalKey(ReportAgentSwarmConfig),
});
export type ReportUpdateMetaInput = typeof ReportUpdateMetaInput.Type;

export const ReportApproveInput = Schema.Struct({
  reportId: ReportId,
});
export type ReportApproveInput = typeof ReportApproveInput.Type;

export const ReportStartRunInput = Schema.Struct({
  reportId: ReportId,
});
export type ReportStartRunInput = typeof ReportStartRunInput.Type;

export const ReportUpdateArtifactInput = Schema.Struct({
  reportId: ReportId,
  content: Schema.String,
});
export type ReportUpdateArtifactInput = typeof ReportUpdateArtifactInput.Type;

export const ReportMutationResult = Schema.Struct({
  report: ReportRecord,
});
export type ReportMutationResult = typeof ReportMutationResult.Type;

// ---------------------------------------------------------------------------
// Report run progress streaming types
// ---------------------------------------------------------------------------

/** A single progress step emitted during report execution. */
export const ReportRunProgressStep = Schema.Struct({
  at: IsoDateTime,
  kind: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  payload: Schema.Unknown,
});
export type ReportRunProgressStep = typeof ReportRunProgressStep.Type;

/** Discriminated union streamed to clients during a startRun call. */
export const ReportRunProgressEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("run.progress"),
    at: IsoDateTime,
    eventKind: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
    payload: Schema.Unknown,
  }),
  Schema.Struct({
    kind: Schema.Literal("run.finished"),
    result: ReportMutationResult,
  }),
]);
export type ReportRunProgressEvent = typeof ReportRunProgressEvent.Type;

export const ReportDeleteInput = Schema.Struct({
  reportId: ReportId,
});
export type ReportDeleteInput = typeof ReportDeleteInput.Type;

export const ReportDeleteResult = Schema.Struct({
  reportId: ReportId,
});
export type ReportDeleteResult = typeof ReportDeleteResult.Type;

export class ReportServiceError extends Schema.TaggedErrorClass<ReportServiceError>()(
  "ReportServiceError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
