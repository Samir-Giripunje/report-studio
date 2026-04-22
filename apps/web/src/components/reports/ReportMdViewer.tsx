import { type ReportPlanningMessage, type ReportRecord } from "@t3tools/contracts";
import {
  FileTextIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  SendHorizontalIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Checkbox } from "~/components/ui/checkbox";
import { toastManager } from "~/components/ui/toast";
import { useDragResize } from "~/hooks/useDragResize";
import { useTextSelection } from "~/hooks/useTextSelection";
import { normalizeReportSourceDocuments, readReportSourceDocument } from "~/lib/reportDocuments";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";
import { ReportExportMenu } from "./ReportExportMenu";
import { ReportMarkdown } from "./ReportMarkdown";
import { SelectionToolbar } from "./SelectionToolbar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function messageRoleLabel(role: ReportPlanningMessage["role"]): string {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "AI Agent";
    default:
      return "System";
  }
}

// ---------------------------------------------------------------------------
// Panel divider – draggable resize handle rendered between panels
// ---------------------------------------------------------------------------

function PanelDivider({
  isDragging,
  onMouseDown,
}: {
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      aria-label="Resize panels"
      className={cn(
        "group relative flex w-[5px] shrink-0 cursor-col-resize select-none items-stretch",
        isDragging && "z-20",
      )}
      role="separator"
      onMouseDown={onMouseDown}
    >
      {/* Visual 1px line centred in the 5px hit area */}
      <div
        className={cn(
          "mx-auto w-px transition-colors duration-150",
          isDragging ? "bg-primary/70" : "bg-border group-hover:bg-primary/50",
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReportMdViewer(props: {
  report: ReportRecord;
  busy: boolean;
  onUpdateArtifact: (content: string) => Promise<boolean | undefined>;
  onRespond: (message: string) => Promise<void>;
}) {
  const { report, busy } = props;
  const content = report.latestRun?.finalArtifact?.content ?? "";
  const planning = report.plan.planning;

  // Only show messages added after the planning phase was finalized —
  // planning-phase messages (outline proposals, approvals) are irrelevant here.
  const revisionMessages = planning.lastOrchestratedAt
    ? planning.conversation.filter((m) => m.createdAt > planning.lastOrchestratedAt!)
    : [];

  // Derive source documents from the report plan (prefer documents with text content over bare file refs)
  const documents = normalizeReportSourceDocuments(
    report.plan.globalSourceConfig.userDocuments.documents.length > 0
      ? report.plan.globalSourceConfig.userDocuments.documents
      : report.plan.globalSourceConfig.userDocuments.fileRefs.map((fileRef) => ({
          name: fileRef,
          mimeType: "application/octet-stream",
          textContent: "",
        })),
  );

  // ── Panel resize ───────────────────────────────────────────────────────────

  const leftPanel = useDragResize({
    initialWidth: 240,
    minWidth: 160,
    maxWidth: 400,
    direction: "right",
    storageKey: "report-panel:left-width",
  });

  const rightPanel = useDragResize({
    initialWidth: 320,
    minWidth: 240,
    maxWidth: 520,
    direction: "left",
    storageKey: "report-panel:right-width",
  });

  // ── Left panel ─────────────────────────────────────────────────────────────

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(
    () => new Set(documents.map((d) => d.name)),
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Middle panel ───────────────────────────────────────────────────────────

  const [isEditing, setIsEditing] = useState(false);
  const [artifactDraft, setArtifactDraft] = useState("");

  // Ref scoped to the rendered markdown so text-selection only activates there
  const reportContentRef = useRef<HTMLDivElement | null>(null);
  const {
    text: selectedText,
    rect: selectionRect,
    clearSelection,
  } = useTextSelection(reportContentRef);

  // ── Right panel ────────────────────────────────────────────────────────────

  const [promptDraft, setPromptDraft] = useState("");
  const [threadStartedAt, setThreadStartedAt] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Messages shown in the panel: either the full post-planning history or only
  // messages since the user started a new thread.
  const displayMessages = threadStartedAt
    ? revisionMessages.filter((m) => m.createdAt >= threadStartedAt)
    : revisionMessages;

  // Reset selection when the active report changes
  useEffect(() => {
    setSelectedFiles(new Set(documents.map((d) => d.name)));
    setIsEditing(false);
    setArtifactDraft("");
    setPromptDraft("");
    setThreadStartedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id]);

  // Auto-scroll to newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages.length]);

  // ── File handlers ──────────────────────────────────────────────────────────

  const toggleFile = (name: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    try {
      await Promise.all(files.map(readReportSourceDocument));
      toastManager.add({
        type: "info",
        title: "Files read",
        description: "Re-run planning to include new files as source context.",
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Upload failed",
        description: cause instanceof Error ? cause.message : "Could not read file.",
      });
    }
  };

  // ── Middle panel handlers ──────────────────────────────────────────────────

  const handleStartEdit = () => {
    setArtifactDraft(content);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setArtifactDraft("");
  };

  const handleSave = async () => {
    const ok = await props.onUpdateArtifact(artifactDraft);
    if (ok !== false) {
      setIsEditing(false);
      setArtifactDraft("");
    }
  };

  // ── Right panel handlers ───────────────────────────────────────────────────

  const handleSend = async () => {
    const text = promptDraft.trim();
    if (!text || busy) return;
    setPromptDraft("");
    await props.onRespond(text);
  };

  const handleAskAboutSelection = useCallback(() => {
    if (!selectedText) return;
    const quote = selectedText
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    setPromptDraft(`${quote}\n\n`);
    clearSelection();
    requestAnimationFrame(() => {
      const ta = promptTextareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }, [selectedText, clearSelection]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ──────────────────────── LEFT: File Viewer ──────────────────────── */}
      <aside
        className="flex shrink-0 flex-col overflow-hidden bg-sidebar"
        style={{ width: leftPanel.width }}
      >
        {/* Panel header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Source Files
          </span>
          <Button
            aria-label="Upload additional files"
            disabled={busy}
            size="icon-xs"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            <PlusIcon className="size-3.5" />
          </Button>
        </div>

        {/* Hidden file input */}
        <input
          accept=".pdf,.md,.markdown,.txt,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.htm"
          aria-label="Upload additional source files"
          className="sr-only"
          multiple
          ref={fileInputRef}
          type="file"
          onChange={(e) => void handleUploadFiles(e)}
        />

        {/* File list */}
        <ScrollArea className="flex-1">
          <div className="space-y-0.5 p-2">
            {documents.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs leading-5 text-muted-foreground">
                No source files attached.
                <br />
                Click <strong>+</strong> above to add files.
              </p>
            ) : (
              documents.map((doc) => {
                const isSelected = selectedFiles.has(doc.name);
                return (
                  <button
                    key={doc.name}
                    type="button"
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                      isSelected
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                    )}
                    onClick={() => toggleFile(doc.name)}
                  >
                    <Checkbox
                      checked={isSelected}
                      className="pointer-events-none shrink-0"
                      onCheckedChange={() => toggleFile(doc.name)}
                    />
                    <FileTextIcon className="size-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{doc.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>

        {/* Context summary */}
        <div className="shrink-0 border-t border-border/60 px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">
            {selectedFiles.size} / {documents.length} file
            {documents.length === 1 ? "" : "s"} in context
          </p>
        </div>
      </aside>

      {/* Left ↔ Middle resize handle */}
      <PanelDivider isDragging={leftPanel.isDragging} onMouseDown={leftPanel.handleMouseDown} />

      {/* ─────────────────────── MIDDLE: Report Viewer ───────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-background px-5 py-3">
          <h2 className="truncate text-sm font-semibold text-foreground">{report.title}</h2>
          <div className="flex shrink-0 items-center gap-2">
            {isEditing ? (
              <>
                <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                  <XIcon className="size-3.5" />
                  Cancel
                </Button>
                <Button disabled={busy} size="sm" onClick={() => void handleSave()}>
                  <SaveIcon className="size-3.5" />
                  Save
                </Button>
              </>
            ) : (
              <>
                <ReportExportMenu
                  content={content}
                  citations={report.latestRun?.finalArtifact?.citations ?? []}
                  disabled={busy}
                  renderedContentRef={reportContentRef}
                  title={report.title}
                />
                <Button disabled={busy} size="sm" variant="outline" onClick={handleStartEdit}>
                  <PencilIcon className="size-3.5" />
                  Edit
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 bg-background">
          <div className="px-8 py-6">
            {isEditing ? (
              <Textarea
                className="min-h-[70vh] w-full rounded-2xl font-mono text-xs"
                value={artifactDraft}
                onChange={(e) => setArtifactDraft(e.target.value)}
              />
            ) : content ? (
              // ref is scoped here so the selection toolbar only activates
              // for text inside the rendered report, not the edit textarea
              <div ref={reportContentRef}>
                <ReportMarkdown
                  content={content}
                  citations={report.latestRun?.finalArtifact?.citations ?? []}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-28 text-center text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-6 animate-spin opacity-40" />
                <p>Generating report…</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Floating selection toolbar — only shown when text is highlighted in the report */}
        {selectedText && selectionRect && (
          <SelectionToolbar rect={selectionRect} onAsk={handleAskAboutSelection} />
        )}
      </main>

      {/* Middle ↔ Right resize handle */}
      <PanelDivider isDragging={rightPanel.isDragging} onMouseDown={rightPanel.handleMouseDown} />

      {/* ─────────────────────── RIGHT: AI Prompt ────────────────────────── */}
      <aside
        className="flex shrink-0 flex-col overflow-hidden bg-sidebar"
        style={{ width: rightPanel.width }}
      >
        {/* Panel header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {threadStartedAt ? "New Thread" : "AI Assistant"}
          </span>
          <div className="flex items-center gap-1">
            {threadStartedAt && (
              <Button
                aria-label="Show full chat history"
                size="icon-xs"
                title="Show full history"
                variant="ghost"
                onClick={() => setThreadStartedAt(null)}
              >
                <HistoryIcon className="size-3.5" />
              </Button>
            )}
            {revisionMessages.length > 0 && !threadStartedAt && (
              <Button
                aria-label="Start a new thread"
                disabled={busy}
                size="icon-xs"
                title="New thread"
                variant="ghost"
                onClick={() => {
                  setThreadStartedAt(new Date().toISOString());
                  setPromptDraft("");
                }}
              >
                <SquarePenIcon className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1">
          <div className="space-y-3 px-3 py-3">
            {displayMessages.length === 0 ? (
              <div className="px-2 py-10 text-center text-xs leading-5 text-muted-foreground">
                {threadStartedAt ? (
                  <>
                    <p className="font-medium text-foreground/60">New thread started</p>
                    <p className="mt-1">Ask anything about the report.</p>
                    <button
                      className="mt-3 text-[11px] text-primary/70 underline-offset-2 hover:underline"
                      type="button"
                      onClick={() => setThreadStartedAt(null)}
                    >
                      View previous conversation
                    </button>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-foreground/60">No messages yet</p>
                    <p className="mt-1">Ask the AI to revise, summarise, or improve the report.</p>
                  </>
                )}
              </div>
            ) : (
              displayMessages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "rounded-2xl border px-3.5 py-2.5 text-xs leading-5",
                    message.role === "user"
                      ? "ml-5 border-primary/30 bg-primary/7"
                      : message.role === "system"
                        ? "border-border/50 bg-muted/20 text-muted-foreground"
                        : "mr-5 border-border/70 bg-muted/20",
                  )}
                >
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {messageRoleLabel(message.role)}
                  </div>
                  <p className="whitespace-pre-wrap text-foreground">{message.text}</p>
                </div>
              ))
            )}

            {busy && (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                <LoaderCircleIcon className="size-3.5 animate-spin shrink-0" />
                AI is responding…
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input area */}
        <div className="flex shrink-0 flex-col gap-2 border-t border-border/60 p-3">
          {/* Context file chips — show up to 3 then "+N more" */}
          {selectedFiles.size > 0 && (
            <div className="flex flex-wrap gap-1">
              {Array.from(selectedFiles)
                .slice(0, 3)
                .map((name) => (
                  <span
                    key={name}
                    className="inline-flex max-w-[9rem] items-center gap-1 truncate rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    <FileTextIcon className="size-2.5 shrink-0" />
                    <span className="truncate">{name}</span>
                  </span>
                ))}
              {selectedFiles.size > 3 && (
                <span className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  +{selectedFiles.size - 3} more
                </span>
              )}
            </div>
          )}

          <Textarea
            ref={promptTextareaRef}
            className="max-h-36 min-h-[4.5rem] resize-none rounded-2xl border-border/70 bg-background px-3 py-2.5 text-sm"
            disabled={busy}
            placeholder="Ask AI to revise or improve the report… (⌘↵ to send)"
            rows={3}
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />

          <div className="flex justify-end">
            <Button
              disabled={busy || !promptDraft.trim()}
              size="sm"
              onClick={() => void handleSend()}
            >
              <SendHorizontalIcon className="size-3.5" />
              Send
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
