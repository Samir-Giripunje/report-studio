import type { ReportPlanningMessage, ReportPlanningStatus, ReportRecord } from "@t3tools/contracts";
import { normalizeReportFileRefs } from "@t3tools/shared/report";
import {
  CheckIcon,
  FileTextIcon,
  MessageSquareMoreIcon,
  PaperclipIcon,
  PlayIcon,
  SendHorizontalIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { toastManager } from "~/components/ui/toast";
import {
  findMatchingReportPromptTemplate,
  REPORT_GUIDED_PROMPT_TEMPLATES,
} from "~/lib/reportPromptTemplates";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Textarea } from "../ui/textarea";

function fileRefArraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function planningStatusMeta(status: ReportPlanningStatus): {
  readonly label: string;
  readonly variant: "outline" | "info" | "success";
  readonly description: string;
} {
  switch (status) {
    case "clarification-needed":
      return {
        label: "Needs Clarification",
        variant: "info",
        description: "The planner found open questions before locking the report structure.",
      };
    case "awaiting-approval":
      return {
        label: "Awaiting Approval",
        variant: "info",
        description:
          "The planner proposed a section structure and is waiting for approval or revisions.",
      };
    case "approved":
      return {
        label: "Structure Approved",
        variant: "success",
        description: "The outline is finalized and ready for report orchestration.",
      };
    case "idle":
    default:
      return {
        label: "Not Started",
        variant: "outline",
        description:
          "Start planning to review the brief, ask questions if needed, and propose the report structure.",
      };
  }
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

export function ReportGuidedComposer(props: {
  report: ReportRecord;
  busy: boolean;
  onStartPlanning: (input: { brief: string; fileRefs: string[] }) => Promise<void>;
  onRespond: (response: string) => Promise<void>;
  onApprove: () => Promise<void>;
  onStartRun: () => Promise<void>;
}) {
  const savedBrief = props.report.plan.metadata.brief;
  const savedFileRefs = useMemo(
    () => normalizeReportFileRefs(props.report.plan.globalSourceConfig.userDocuments.fileRefs),
    [props.report.plan.globalSourceConfig.userDocuments.fileRefs],
  );
  const planning = props.report.plan.planning;
  const statusMeta = planningStatusMeta(planning.status);

  const [briefDraft, setBriefDraft] = useState(savedBrief);
  const [attachedFileRefs, setAttachedFileRefs] = useState<string[]>(savedFileRefs);
  const [responseDraft, setResponseDraft] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousReportIdRef = useRef(props.report.id);

  useEffect(() => {
    if (previousReportIdRef.current === props.report.id) {
      return;
    }
    previousReportIdRef.current = props.report.id;
    setBriefDraft(savedBrief);
    setAttachedFileRefs(savedFileRefs);
    setResponseDraft("");
  }, [props.report.id, savedBrief, savedFileRefs]);

  const normalizedBrief = briefDraft.trim();
  const normalizedAttachedFileRefs = useMemo(
    () => normalizeReportFileRefs(attachedFileRefs),
    [attachedFileRefs],
  );
  const activePromptTemplate = useMemo(
    () => findMatchingReportPromptTemplate(briefDraft),
    [briefDraft],
  );
  const hasUnsavedChanges =
    normalizedBrief !== savedBrief ||
    !fileRefArraysEqual(normalizedAttachedFileRefs, savedFileRefs);
  const canRespond =
    planning.status === "clarification-needed" || planning.status === "awaiting-approval";
  const hasPlanningContent =
    planning.conversation.length > 0 ||
    planning.proposedOutline !== null ||
    canRespond ||
    planning.status === "approved";
  const normalizedResponse = responseDraft.trim();
  const primaryActionLabel =
    planning.conversation.length === 0
      ? "Start planning orchestration"
      : "Re-run planning orchestration";

  const attachFiles = (files: ReadonlyArray<File>) => {
    if (files.length === 0) {
      return;
    }

    setAttachedFileRefs((current) =>
      normalizeReportFileRefs([...current, ...files.map((file) => file.name)]),
    );
  };

  const handleUploadFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    attachFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handleRemoveFile = (fileRef: string) => {
    setAttachedFileRefs((current) =>
      current.filter((currentFileRef) => currentFileRef !== fileRef),
    );
  };

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

  const handleDropZoneDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleDropZoneDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  };

  const handleDropZoneDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }

    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDropZoneDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    attachFiles(Array.from(event.dataTransfer.files));
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Card className="overflow-hidden border-border/70">
        <CardHeader className="space-y-3 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-2xl leading-tight sm:text-3xl">
                User Guided Report Planning
              </CardTitle>
            </div>
            <Button
              className="h-11 px-5"
              disabled={props.busy}
              size="lg"
              onClick={() => void handleStartPlanning()}
            >
              <SendHorizontalIcon className="size-4" />
              {primaryActionLabel}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 p-6 pt-[0.6rem] sm:p-8 sm:pt-[0.6rem]">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,7fr)]">
            <section className="flex flex-col gap-3">
              <div className="space-y-1">
                <h2 className="font-semibold text-lg text-foreground">Upload Documents</h2>
                <p className="text-sm text-muted-foreground">
                  Drag files here or browse from your machine. Attached filenames are used as the
                  current source references for planning.
                </p>
              </div>

              <input
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
                  className="flex min-h-64 w-full flex-col items-center justify-center gap-4 px-6 py-8 text-center"
                  type="button"
                  onClick={openFilePicker}
                >
                  <span className="flex size-16 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground shadow-xs/5">
                    <UploadIcon className="size-7" />
                  </span>
                  <div className="space-y-1">
                    <div className="font-medium text-base text-foreground">
                      Drag and drop files or click to upload
                    </div>
                    <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                      Add PDFs or other source documents that should drive the report plan.
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
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/55 text-muted-foreground">
                        <FileTextIcon className="size-4" />
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

            <section className="flex flex-col gap-3">
              <div className="space-y-1">
                <h2 className="font-semibold text-lg text-foreground">
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
                value={briefDraft}
                onChange={(event) => setBriefDraft(event.target.value)}
              />
            </section>
          </div>

          <div className="border-t border-border/60 pt-4">
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <PaperclipIcon className="size-4" />
                {normalizedAttachedFileRefs.length}{" "}
                {normalizedAttachedFileRefs.length === 1 ? "file" : "files"} attached
              </div>
              <div>
                {hasUnsavedChanges ? "Prompt or sources changed." : "Planner inputs are in sync."}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="rounded-[1.5rem] border border-border/70 bg-muted/16 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-semibold text-base text-foreground">Common Prompt Templates</h2>
            <p className="text-sm text-muted-foreground">
              Click a template to load its predefined prompt into the instructions box.
            </p>
          </div>
          {activePromptTemplate ? (
            <span className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              Selected: {activePromptTemplate.label}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
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
      </section>

      {hasPlanningContent ? (
        <Card className="border-border/70">
          <CardHeader className="pb-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-9 items-center justify-center rounded-xl border border-border/70 bg-muted/25 text-muted-foreground">
                <MessageSquareMoreIcon className="size-4" />
              </span>
              <div>
                <CardTitle>Planning Conversation</CardTitle>
                <CardDescription className="mt-1">{statusMeta.description}</CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
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
                      className="rounded-2xl border border-border/60 bg-muted/12 px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-xs font-semibold text-muted-foreground">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">{section.title}</div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {section.summary}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {canRespond ? (
              <div className="space-y-3 rounded-[1.5rem] border border-border/70 bg-muted/16 p-4">
                <Textarea
                  className="min-h-32 rounded-[1.25rem] border-border/70 bg-background px-4 py-3"
                  placeholder={
                    planning.status === "clarification-needed"
                      ? "Answer the planner's questions in normal free text."
                      : "Describe any changes you want in the section structure."
                  }
                  value={responseDraft}
                  onChange={(event) => setResponseDraft(event.target.value)}
                />

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    {planning.status === "clarification-needed"
                      ? "One reply is enough. The planner will turn it into a proposed structure."
                      : "Approve the structure if it looks right, or send revisions in free text."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {planning.status === "awaiting-approval" ? (
                      <Button
                        disabled={props.busy}
                        variant="secondary"
                        onClick={() => void props.onApprove()}
                      >
                        <CheckIcon className="size-4" />
                        Approve structure
                      </Button>
                    ) : null}
                    <Button disabled={props.busy} onClick={() => void handleRespond()}>
                      <SendHorizontalIcon className="size-4" />
                      {planning.status === "clarification-needed"
                        ? "Send clarification"
                        : "Request changes"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {planning.status === "approved" ? (
              <div className="flex flex-col gap-3 rounded-[1.5rem] border border-emerald-500/30 bg-emerald-500/7 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium text-foreground">Structure approved</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The report plan is finalized. Start report orchestration whenever you want to
                    move into generation.
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
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
