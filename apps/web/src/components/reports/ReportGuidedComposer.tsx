import type {
  ModelSelection,
  ProviderApiKeys,
  ProviderKind,
  ReportAgentSwarmConfig,
  ReportPlanningMessage,
  ReportPlanningStatus,
  ReportRecord,
  ReportSourceDocument,
} from "@t3tools/contracts";
import {
  AlertCircleIcon,
  CheckIcon,
  FileTextIcon,
  LoaderCircleIcon,
  MessageSquareMoreIcon,
  PaperclipIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  SaveIcon,
  SendHorizontalIcon,
  SkipForwardIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { toastManager } from "~/components/ui/toast";
import {
  normalizeReportSourceDocuments,
  readReportSourceDocument,
  reportFileRefsFromDocuments,
} from "~/lib/reportDocuments";
import {
  findMatchingReportPromptTemplate,
  REPORT_GUIDED_PROMPT_TEMPLATES,
} from "~/lib/reportPromptTemplates";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Textarea } from "../ui/textarea";
import { ReportAdvancedSettings } from "./ReportAdvancedSettings";
import { ReportExportMenu } from "./ReportExportMenu";
import { ReportMarkdown } from "./ReportMarkdown";
import { ReportModelControl } from "./ReportModelControl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileRefArraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function reportSourceDocumentsEqual(
  left: ReadonlyArray<ReportSourceDocument>,
  right: ReadonlyArray<ReportSourceDocument>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => {
    const candidate = right[index];
    return (
      candidate?.name === value.name &&
      candidate?.mimeType === value.mimeType &&
      candidate?.textContent === value.textContent
    );
  });
}

function messageRoleLabel(role: ReportPlanningMessage["role"]): string {
  switch (role) {
    case "user":
      return "You";
    case "system":
      return "System";
    case "assistant":
    default:
      return "Planner";
  }
}

// ---------------------------------------------------------------------------
// Step derivation
// ---------------------------------------------------------------------------

/** Maps backend planning status → which step number is "current" */
function derivedStepFromStatus(status: ReportPlanningStatus): 1 | 2 | 3 {
  switch (status) {
    case "clarification-needed":
      return 2;
    case "awaiting-approval":
    case "approved":
      return 3;
    case "idle":
    default:
      return 1;
  }
}

const STEP_DEFS = [
  { number: 1 as const, label: "Brief & Sources" },
  { number: 2 as const, label: "Clarification" },
  { number: 3 as const, label: "Structure Review" },
] as const;

type StepNumber = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// StepIndicator
// ---------------------------------------------------------------------------

function StepIndicator(props: {
  activeStep: StepNumber;
  computedStep: StepNumber;
  step2Skipped: boolean;
  busy: boolean;
  onNavigate: (step: StepNumber) => void;
}) {
  const { activeStep, computedStep, step2Skipped, busy } = props;

  function isCompleted(step: StepNumber): boolean {
    if (step === activeStep) return false;
    if (step === 1) return computedStep > 1;
    if (step === 2) return computedStep >= 3;
    if (step === 3) return false; // step 3 never shows "completed" badge in the indicator
    return false;
  }

  function isReachable(step: StepNumber): boolean {
    // Only steps that have been reached or are the current computed step
    return step <= computedStep;
  }

  function segmentDone(segmentAfterStep: StepNumber): boolean {
    // Segment between step N and step N+1 is "done" when computedStep > N and both steps visited
    return computedStep > segmentAfterStep;
  }

  return (
    <div className="flex items-center">
      {STEP_DEFS.map((stepDef, idx) => {
        const isActive = activeStep === stepDef.number;
        const completed = isCompleted(stepDef.number);
        const reachable = isReachable(stepDef.number);
        const isSkipped = stepDef.number === 2 && step2Skipped && computedStep >= 3;
        const clickable = reachable && !busy && !isActive;

        return (
          <div key={stepDef.number} className="flex flex-1 items-center">
            {/* Step circle + label */}
            <button
              type="button"
              disabled={!clickable}
              className={cn(
                "group flex flex-col items-center gap-1.5 focus-visible:outline-none",
                clickable ? "cursor-pointer" : "cursor-default",
              )}
              onClick={() => {
                if (clickable) props.onNavigate(stepDef.number);
              }}
            >
              {/* Circle */}
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full border-2 transition-colors text-sm font-semibold shrink-0",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : completed
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : isSkipped
                        ? "border-border/70 bg-muted/30 text-muted-foreground"
                        : reachable
                          ? "border-primary/50 bg-background text-primary"
                          : "border-border/50 bg-muted/18 text-muted-foreground/50",
                )}
              >
                {completed ? (
                  <CheckIcon className="size-4" />
                ) : isSkipped ? (
                  <span className="text-xs font-bold leading-none">—</span>
                ) : (
                  stepDef.number
                )}
              </span>

              {/* Label */}
              <span
                className={cn(
                  "hidden text-xs font-medium sm:block text-center leading-tight",
                  isActive
                    ? "text-foreground"
                    : completed || (reachable && !isSkipped)
                      ? "text-muted-foreground group-hover:text-foreground transition-colors"
                      : "text-muted-foreground/50",
                )}
              >
                {stepDef.label}
                {isSkipped ? (
                  <span className="block text-[10px] font-normal text-muted-foreground/60">
                    (skipped)
                  </span>
                ) : null}
              </span>
            </button>

            {/* Connector line between steps */}
            {idx < STEP_DEFS.length - 1 ? (
              <div
                className={cn(
                  "mx-2 mb-5 h-0.5 flex-1 rounded-full transition-colors",
                  segmentDone(stepDef.number as StepNumber) ? "bg-emerald-500" : "bg-border/50",
                )}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChangeSummary
// ---------------------------------------------------------------------------

function ChangeSummary(props: {
  savedBrief: string;
  currentBrief: string;
  savedFileRefs: ReadonlyArray<string>;
  currentFileRefs: ReadonlyArray<string>;
}) {
  const { savedBrief, currentBrief, savedFileRefs, currentFileRefs } = props;

  const briefChanged = currentBrief.trim() !== savedBrief.trim();
  const addedFiles = currentFileRefs.filter((f) => !savedFileRefs.includes(f));
  const removedFiles = savedFileRefs.filter((f) => !currentFileRefs.includes(f));
  const docsChanged = addedFiles.length > 0 || removedFiles.length > 0;

  if (!briefChanged && !docsChanged) {
    return null;
  }

  return (
    <div className="rounded-[1.5rem] border border-amber-500/35 bg-amber-500/7 px-4 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <AlertCircleIcon className="size-4 shrink-0 text-amber-500" />
        <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
          Changes since last run — Re-run to apply these to the plan
        </p>
      </div>

      {briefChanged ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-border/60 bg-muted/18 px-3 py-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Previous
            </div>
            <p className="line-clamp-4 text-xs text-muted-foreground leading-5 whitespace-pre-wrap">
              {savedBrief.trim() || <em>empty</em>}
            </p>
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/6 px-3 py-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Updated
            </div>
            <p className="line-clamp-4 text-xs text-foreground leading-5 whitespace-pre-wrap">
              {currentBrief.trim() || <em>empty</em>}
            </p>
          </div>
        </div>
      ) : null}

      {docsChanged ? (
        <div className="flex flex-wrap gap-1.5">
          {addedFiles.map((f) => (
            <span
              key={`add-${f}`}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
            >
              + {f}
            </span>
          ))}
          {removedFiles.map((f) => (
            <span
              key={`rm-${f}`}
              className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/7 px-2.5 py-0.5 text-xs font-medium text-destructive line-through"
            >
              {f}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ReportGuidedComposer(props: {
  report: ReportRecord;
  busy: boolean;
  modelSelection: ModelSelection;
  providerApiKeys: ProviderApiKeys;
  onStartPlanning: (input: {
    brief: string;
    fileRefs: string[];
    documents: ReportSourceDocument[];
  }) => Promise<void>;
  onRespond: (response: string) => Promise<void>;
  onApprove: () => Promise<void>;
  onStartRun: () => Promise<void>;
  onSaveAgentSwarm: (agentSwarm: ReportAgentSwarmConfig) => Promise<void>;
  onUpdateArtifact: (content: string) => Promise<boolean | undefined>;
  onModelSelectionChange: (provider: ProviderKind, model: string) => void;
}) {
  const savedBrief = props.report.plan.metadata.brief;
  const savedDocuments = useMemo(
    () =>
      normalizeReportSourceDocuments(
        props.report.plan.globalSourceConfig.userDocuments.documents.length > 0
          ? props.report.plan.globalSourceConfig.userDocuments.documents
          : props.report.plan.globalSourceConfig.userDocuments.fileRefs.map((fileRef) => ({
              name: fileRef,
              mimeType: "application/octet-stream",
              textContent: "",
            })),
      ),
    [
      props.report.plan.globalSourceConfig.userDocuments.documents,
      props.report.plan.globalSourceConfig.userDocuments.fileRefs,
    ],
  );
  const savedFileRefs = useMemo(
    () => reportFileRefsFromDocuments(savedDocuments),
    [savedDocuments],
  );
  const planning = props.report.plan.planning;

  // ---------------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------------

  const [briefDraft, setBriefDraft] = useState(savedBrief);
  const [attachedDocuments, setAttachedDocuments] =
    useState<ReportSourceDocument[]>(savedDocuments);
  const [responseDraft, setResponseDraft] = useState("");
  const [isEditingArtifact, setIsEditingArtifact] = useState(false);
  const [artifactDraft, setArtifactDraft] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeStep, setActiveStep] = useState<StepNumber>(() =>
    derivedStepFromStatus(planning.status),
  );

  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousReportIdRef = useRef(props.report.id);
  const prevPlanningStatusRef = useRef<ReportPlanningStatus>(planning.status);

  // ---------------------------------------------------------------------------
  // Sync on report change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (previousReportIdRef.current === props.report.id) {
      return;
    }
    previousReportIdRef.current = props.report.id;
    setBriefDraft(savedBrief);
    setAttachedDocuments(savedDocuments);
    setResponseDraft("");
    setIsEditingArtifact(false);
    setArtifactDraft("");
    setActiveStep(derivedStepFromStatus(planning.status));
  }, [props.report.id, savedBrief, savedDocuments, planning.status]);

  // ---------------------------------------------------------------------------
  // Auto-advance on planning status change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (prevPlanningStatusRef.current === planning.status) {
      return;
    }
    prevPlanningStatusRef.current = planning.status;
    setActiveStep(derivedStepFromStatus(planning.status));
  }, [planning.status]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const normalizedBrief = briefDraft.trim();
  const normalizedAttachedDocuments = useMemo(
    () => normalizeReportSourceDocuments(attachedDocuments),
    [attachedDocuments],
  );
  const normalizedAttachedFileRefs = useMemo(
    () => reportFileRefsFromDocuments(normalizedAttachedDocuments),
    [normalizedAttachedDocuments],
  );
  const activePromptTemplate = useMemo(
    () => findMatchingReportPromptTemplate(briefDraft),
    [briefDraft],
  );
  const hasUnsavedChanges =
    normalizedBrief !== savedBrief ||
    !fileRefArraysEqual(normalizedAttachedFileRefs, savedFileRefs) ||
    !reportSourceDocumentsEqual(normalizedAttachedDocuments, savedDocuments);
  const normalizedResponse = responseDraft.trim();
  const hasResponseDraft = normalizedResponse.length > 0;
  const computedStep = derivedStepFromStatus(planning.status);
  const step2Skipped =
    planning.status !== "idle" &&
    planning.status !== "clarification-needed" &&
    planning.conversation.length === 0;

  // ---------------------------------------------------------------------------
  // File handling
  // ---------------------------------------------------------------------------

  const attachFiles = async (files: ReadonlyArray<File>) => {
    if (files.length === 0) {
      return;
    }
    try {
      const nextDocuments = await Promise.all(files.map((file) => readReportSourceDocument(file)));
      setAttachedDocuments((current) =>
        normalizeReportSourceDocuments([...current, ...nextDocuments]),
      );
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Upload failed",
        description:
          cause instanceof Error
            ? cause.message
            : "The selected files could not be prepared for report planning.",
      });
    }
  };

  const handleUploadFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    void attachFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handleRemoveFile = (fileRef: string) => {
    setAttachedDocuments((current) =>
      current.filter((currentDocument) => currentDocument.name !== fileRef),
    );
  };

  // ---------------------------------------------------------------------------
  // Planning actions
  // ---------------------------------------------------------------------------

  const handleStartPlanning = async () => {
    if (normalizedBrief.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Report prompt is required",
        description: "Add the report instructions before starting planning orchestration.",
      });
      return;
    }
    await props.onStartPlanning({
      brief: normalizedBrief,
      fileRefs: normalizedAttachedFileRefs,
      documents: normalizedAttachedDocuments,
    });
  };

  const handleRespond = async () => {
    if (normalizedResponse.length === 0) {
      toastManager.add({
        type: "warning",
        title:
          planning.status === "clarification-needed"
            ? "Answer required"
            : "Revision request required",
        description:
          planning.status === "clarification-needed"
            ? "Write your clarification before sending it to the planner."
            : "Describe the changes you want before sending the revision request.",
      });
      return;
    }
    await props.onRespond(normalizedResponse);
    setResponseDraft("");
  };

  // ---------------------------------------------------------------------------
  // Drag-drop handlers
  // ---------------------------------------------------------------------------

  const handleDropZoneDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleDropZoneDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  };

  const handleDropZoneDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragOver(false);
  };

  const handleDropZoneDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    void attachFiles(Array.from(event.dataTransfer.files));
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  /** Footer action for Step 1 */
  function renderStep1Footer() {
    if (props.busy) {
      return (
        <Button className="h-11 px-5" disabled size="lg">
          <LoaderCircleIcon className="size-4 animate-spin" />
          Planning…
        </Button>
      );
    }

    // First time — no planning has happened yet
    if (planning.status === "idle") {
      return (
        <Button
          className="h-11 px-5"
          disabled={props.busy}
          size="lg"
          onClick={() => void handleStartPlanning()}
        >
          <SendHorizontalIcon className="size-4" />
          Plan Report
        </Button>
      );
    }

    // User navigated back to step 1 with actual changes → offer Re-run
    if (hasUnsavedChanges) {
      return (
        <Button
          className="h-11 px-5"
          disabled={props.busy}
          size="lg"
          onClick={() => void handleStartPlanning()}
        >
          <RotateCcwIcon className="size-4" />
          Re-run with changes
        </Button>
      );
    }

    // User navigated back but nothing changed → let them continue
    return (
      <Button
        className="h-11 px-5"
        size="lg"
        variant="secondary"
        onClick={() => setActiveStep(computedStep)}
      >
        Continue →
      </Button>
    );
  }

  // ---------------------------------------------------------------------------
  // Step content panels
  // ---------------------------------------------------------------------------

  function renderStep1() {
    return (
      <div className="space-y-5">
        {/* Change summary — only when there have been prior runs */}
        {computedStep > 1 ? (
          <ChangeSummary
            savedBrief={savedBrief}
            currentBrief={normalizedBrief}
            savedFileRefs={savedFileRefs}
            currentFileRefs={normalizedAttachedFileRefs}
          />
        ) : null}

        {/* Brief + Documents side-by-side */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,7fr)]">
          {/* Doc upload */}
          <section className="flex flex-col gap-3">
            <div className="space-y-1">
              <h2 className="font-semibold text-base text-foreground">Upload Documents</h2>
              <p className="text-sm text-muted-foreground">
                Drag files here or browse. Attached filenames are used as source references for
                planning.
              </p>
            </div>

            <input
              accept=".pdf,.md,.markdown,.txt,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm"
              aria-label="Upload files"
              className="sr-only"
              multiple
              ref={fileInputRef}
              type="file"
              onChange={handleUploadFiles}
            />

            <div
              className={cn(
                "rounded-[1.5rem] border border-dashed bg-muted/18 transition-colors",
                isDragOver
                  ? "border-primary/55 bg-primary/6"
                  : "border-border/70 hover:border-primary/30 hover:bg-muted/28",
              )}
              onDragEnter={handleDropZoneDragEnter}
              onDragLeave={handleDropZoneDragLeave}
              onDragOver={handleDropZoneDragOver}
              onDrop={handleDropZoneDrop}
            >
              <button
                className="flex min-h-52 w-full flex-col items-center justify-center gap-4 px-6 py-8 text-center"
                type="button"
                onClick={openFilePicker}
              >
                <span className="flex size-14 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground shadow-xs/5">
                  <UploadIcon className="size-6" />
                </span>
                <div className="space-y-1">
                  <div className="font-medium text-sm text-foreground">
                    Drag and drop files or click to upload
                  </div>
                  <p className="mx-auto max-w-xs text-xs text-muted-foreground">
                    Supported formats: PDF, Markdown, plain text, CSV/TSV, JSON, YAML, XML, and
                    HTML.
                  </p>
                </div>
              </button>
            </div>

            <div className="space-y-2">
              {normalizedAttachedFileRefs.length > 0 ? (
                normalizedAttachedFileRefs.map((fileRef) => (
                  <div
                    key={fileRef}
                    className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background px-4 py-3"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/55 text-muted-foreground">
                      <FileTextIcon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {fileRef}
                    </span>
                    <Button
                      aria-label={`Remove ${fileRef}`}
                      disabled={props.busy}
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => handleRemoveFile(fileRef)}
                    >
                      <XIcon className="size-4" />
                    </Button>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-border/60 bg-muted/12 px-4 py-3 text-sm text-muted-foreground">
                  No documents attached yet.
                </div>
              )}
            </div>
          </section>

          {/* Brief textarea + template pills */}
          <section className="flex flex-col gap-3">
            <div className="space-y-1">
              <h2 className="font-semibold text-base text-foreground">
                Report Prompt / Instructions
              </h2>
              <p className="text-sm text-muted-foreground">
                Describe the report you want. The planner will ask for clarification only when it
                still has important gaps.
              </p>
            </div>

            <Textarea
              className="flex-1 min-h-0 rounded-[1.5rem] border-border/70 bg-background px-4 py-3"
              placeholder="Example: Review the uploaded documents, summarize the key findings, highlight the supporting evidence, and recommend the next steps."
              rows={8}
              value={briefDraft}
              onChange={(event) => setBriefDraft(event.target.value)}
            />

            {/* Template quick-picks */}
            <div className="rounded-2xl border border-border/60 bg-muted/12 px-4 py-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Quick-pick template
                </span>
                {activePromptTemplate ? (
                  <span className="rounded-full border border-border/70 bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Selected: {activePromptTemplate.label}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {REPORT_GUIDED_PROMPT_TEMPLATES.map((template) => {
                  const isSelected = activePromptTemplate?.id === template.id;
                  return (
                    <Button
                      key={template.id}
                      size="sm"
                      variant={isSelected ? "secondary" : "outline"}
                      onClick={() => setBriefDraft(template.prompt)}
                    >
                      {template.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          </section>
        </div>

        {/* Status bar + primary action */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <PaperclipIcon className="size-4" />
              {normalizedAttachedFileRefs.length}{" "}
              {normalizedAttachedFileRefs.length === 1 ? "file" : "files"} attached
            </div>
            <div>
              {hasUnsavedChanges ? "Prompt or sources changed." : "Planner inputs are in sync."}
            </div>
          </div>
          {renderStep1Footer()}
        </div>
      </div>
    );
  }

  function renderStep2() {
    // Step was auto-skipped (no clarification conversation)
    if (step2Skipped) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-full border border-border/60 bg-muted/25 text-muted-foreground">
            <SkipForwardIcon className="size-6" />
          </span>
          <div>
            <p className="font-semibold text-foreground">No clarification needed</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The planner had enough context to go straight to a proposed structure.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setActiveStep(3)}>
            View structure →
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 items-center justify-center rounded-xl border border-border/70 bg-muted/25 text-muted-foreground shrink-0">
            <MessageSquareMoreIcon className="size-4" />
          </span>
          <div>
            <h2 className="font-semibold text-base text-foreground">Planning Conversation</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The planner found open questions before locking the report structure.
            </p>
          </div>
        </div>

        {planning.conversation.length > 0 ? (
          <div className="space-y-3">
            {planning.conversation.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "max-w-4xl rounded-3xl border px-4 py-3 sm:px-5",
                  message.role === "user"
                    ? "ml-auto border-primary/30 bg-primary/7"
                    : "mr-auto border-border/70 bg-muted/18",
                )}
              >
                <div className="mb-1 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  {messageRoleLabel(message.role)}
                </div>
                <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {message.text}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {planning.status === "clarification-needed" ? (
          <div className="space-y-3 rounded-[1.5rem] border border-border/70 bg-muted/16 p-4">
            <Textarea
              className="min-h-32 rounded-[1.25rem] border-border/70 bg-background px-4 py-3"
              placeholder="Answer the planner's questions in normal free text."
              value={responseDraft}
              onChange={(event) => setResponseDraft(event.target.value)}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                One reply is enough. The planner will turn it into a proposed structure.
              </p>
              <Button disabled={props.busy} onClick={() => void handleRespond()}>
                <SendHorizontalIcon className="size-4" />
                Send clarification
              </Button>
            </div>
          </div>
        ) : null}

        {/* Clarification done, can proceed */}
        {planning.status !== "clarification-needed" && planning.conversation.length > 0 ? (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setActiveStep(3)}>
              View structure →
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderStep3() {
    return (
      <div className="space-y-5">
        {/* Proposed outline */}
        {planning.proposedOutline ? (
          <div className="rounded-[1.5rem] border border-border/70 bg-background px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-base text-foreground">
                  {planning.proposedOutline.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {planning.proposedOutline.summary}
                </p>
              </div>
              {planning.status === "approved" ? (
                <Badge variant="success">Approved</Badge>
              ) : (
                <Badge variant="outline">Draft Structure</Badge>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {planning.proposedOutline.sections.map((section, index) => (
                <div
                  key={section.id}
                  className="rounded-2xl border border-border/60 bg-muted/12 px-4 py-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-xs font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium text-foreground">{section.title}</div>
                        {section.wordTarget ? (
                          <span className="shrink-0 rounded-full border border-border/50 bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                            ~{section.wordTarget.min.toLocaleString()}–
                            {section.wordTarget.max.toLocaleString()} words
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm leading-5 text-muted-foreground">
                        {section.summary}
                      </div>
                      {section.keyPoints.length > 0 ? (
                        <ul className="mt-2.5 space-y-1">
                          {section.keyPoints.map((point) => (
                            <li
                              key={point}
                              className="flex items-start gap-2 text-[13px] text-muted-foreground/80"
                            >
                              <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                              {point}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-[1.5rem] border border-border/60 bg-muted/12 px-5 py-8 text-center text-sm text-muted-foreground">
            The planner has not yet proposed a structure.
          </div>
        )}

        {/* Awaiting approval — revision textarea + action buttons */}
        {planning.status === "awaiting-approval" ? (
          <div className="space-y-3 rounded-[1.5rem] border border-border/70 bg-muted/16 p-4">
            <Textarea
              className="min-h-28 rounded-[1.25rem] border-border/70 bg-background px-4 py-3"
              placeholder="Describe any changes you want in the section structure."
              value={responseDraft}
              onChange={(event) => setResponseDraft(event.target.value)}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Approve the structure if it looks right, or send revisions in free text.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="border-emerald-600 bg-emerald-600 text-white shadow-emerald-600/24 hover:bg-emerald-600/90"
                  disabled={props.busy}
                  onClick={() => void props.onApprove()}
                >
                  <CheckIcon className="size-4" />
                  Approve structure
                </Button>
                <Button
                  disabled={props.busy || !hasResponseDraft}
                  title={
                    hasResponseDraft
                      ? "Send the requested structure changes"
                      : "Describe changes before requesting revisions"
                  }
                  variant={hasResponseDraft ? "default" : "outline"}
                  onClick={() => void handleRespond()}
                >
                  <SendHorizontalIcon className="size-4" />
                  Request changes
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Approved banner + start orchestration */}
        {planning.status === "approved" ? (
          <div className="flex flex-col gap-3 rounded-[1.5rem] border border-emerald-500/30 bg-emerald-500/7 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium text-foreground">Structure approved</div>
              <p className="mt-1 text-sm text-muted-foreground">
                The report plan is finalized. Start report orchestration whenever you want to move
                into generation.
              </p>
            </div>
            <Button
              disabled={props.busy || props.report.status === "running"}
              onClick={() => void props.onStartRun()}
            >
              <PlayIcon className="size-4" />
              Start report orchestration
            </Button>
          </div>
        ) : null}

        {/* Advanced settings — only once planning has started */}
        {planning.status !== "idle" ? (
          <ReportAdvancedSettings
            agentSwarm={props.report.plan.orchestration.agentSwarm}
            disabled={props.busy}
            providerApiKeys={props.providerApiKeys}
            onSave={props.onSaveAgentSwarm}
          />
        ) : null}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Page header: title + model control */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <h1 className="font-semibold text-2xl text-foreground leading-tight sm:text-3xl">
            User Guided Report Planning
          </h1>
        </div>
        <ReportModelControl
          disabled={props.busy}
          modelSelection={props.modelSelection}
          providerApiKeys={props.providerApiKeys}
          onModelSelectionChange={props.onModelSelectionChange}
        />
      </div>

      {/* Wizard card */}
      <Card className="overflow-hidden border-border/70">
        {/* Step indicator */}
        <div className="border-b border-border/60 px-6 py-5 sm:px-8">
          <StepIndicator
            activeStep={activeStep}
            computedStep={computedStep}
            step2Skipped={step2Skipped}
            busy={props.busy}
            onNavigate={setActiveStep}
          />
        </div>

        {/* Step content */}
        <CardContent className="p-6 sm:p-8">
          {activeStep === 1 ? renderStep1() : null}
          {activeStep === 2 ? renderStep2() : null}
          {activeStep === 3 ? renderStep3() : null}
        </CardContent>
      </Card>

      {/* Generation progress — below wizard, always */}
      {props.busy && planning.status === "approved" ? (
        <Card className="border-border/70">
          <CardContent className="flex items-center gap-3 py-5 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin shrink-0" />
            Generating report — this may take a minute…
          </CardContent>
        </Card>
      ) : null}

      {/* Generated report card */}
      {!props.busy && props.report.latestRun?.finalArtifact ? (
        <Card className="border-border/70">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Generated Report</CardTitle>
                <CardDescription>
                  Report generated on {new Date(props.report.latestRun.updatedAt).toLocaleString()}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <ReportExportMenu
                  content={props.report.latestRun?.finalArtifact?.content ?? ""}
                  citations={props.report.latestRun?.finalArtifact?.citations ?? []}
                  disabled={props.busy}
                  title={props.report.title}
                />
                {isEditingArtifact ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setIsEditingArtifact(false);
                        setArtifactDraft("");
                      }}
                    >
                      <XIcon className="size-4" />
                      Cancel
                    </Button>
                    <Button
                      disabled={props.busy}
                      size="sm"
                      onClick={async () => {
                        const ok = await props.onUpdateArtifact(artifactDraft);
                        if (ok !== false) {
                          setIsEditingArtifact(false);
                          setArtifactDraft("");
                        }
                      }}
                    >
                      <SaveIcon className="size-4" />
                      Save
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={props.busy}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setArtifactDraft(props.report.latestRun?.finalArtifact?.content ?? "");
                      setIsEditingArtifact(true);
                    }}
                  >
                    <PencilIcon className="size-4" />
                    Edit
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isEditingArtifact ? (
              <Textarea
                className="min-h-[32rem] font-mono text-xs"
                value={artifactDraft}
                onChange={(e) => setArtifactDraft(e.target.value)}
              />
            ) : (
              <ReportMarkdown
                content={props.report.latestRun.finalArtifact.content}
                citations={props.report.latestRun.finalArtifact.citations ?? []}
              />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
