import type { ReportRecord } from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { EllipsisIcon, FolderIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCreateReportDraft } from "~/hooks/useCreateReportDraft";
import { type ReportCreationMode } from "~/lib/reportCreation";
import {
  formatReportListDate,
  groupReportsForSidebar,
  sortReportsForSidebar,
} from "~/lib/reportList";
import { removeReportSnapshotRecord, upsertReportSnapshotRecord } from "~/lib/reportSnapshotCache";
import { readNativeApi } from "~/nativeApi";
import { reportQueryKeys, reportSnapshotQueryOptions } from "~/lib/reportReactQuery";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { ReportCreationOptionsGrid } from "./ReportCreationOptionsGrid";

const EMPTY_REPORTS: ReadonlyArray<ReportRecord> = [];

function toReportActionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "An error occurred.";
}

export function ReportFolderPage(props: { folder: string }) {
  const api = readNativeApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery(reportSnapshotQueryOptions());
  const reports = snapshotQuery.data?.reports ?? EMPTY_REPORTS;
  const sortedReports = useMemo(() => sortReportsForSidebar(reports, "updated_at"), [reports]);
  const groupedReports = useMemo(() => groupReportsForSidebar(sortedReports), [sortedReports]);
  const folderReports = useMemo(
    () => sortedReports.filter((report) => report.folder === props.folder),
    [props.folder, sortedReports],
  );
  const existingFolderOptions = useMemo(
    () => groupedReports.folderGroups.map((group) => group.label),
    [groupedReports.folderGroups],
  );
  const createReportDraft = useCreateReportDraft(reports.length);
  const [creatingReportMode, setCreatingReportMode] = useState<ReportCreationMode | null>(null);
  const [renamingReportId, setRenamingReportId] = useState<string | null>(null);
  const [renamingReportTitle, setRenamingReportTitle] = useState("");
  const [selectingReportFolderId, setSelectingReportFolderId] = useState<string | null>(null);
  const [selectingReportFolderValue, setSelectingReportFolderValue] = useState("");
  const renamingInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (snapshotQuery.isLoading || snapshotQuery.isFetching) {
      return;
    }

    if (reports.some((report) => report.folder === props.folder)) {
      return;
    }

    void navigate({
      to: "/reports",
      search: () => ({}) as never,
      replace: true,
    });
  }, [navigate, props.folder, reports, snapshotQuery.isFetching, snapshotQuery.isLoading]);

  const handleCreateReportSelection = useCallback(
    async (mode: ReportCreationMode) => {
      setCreatingReportMode(mode);
      await createReportDraft({
        mode,
        folder: props.folder,
      });
      setCreatingReportMode(null);
    },
    [createReportDraft, props.folder],
  );

  const finishReportRename = useCallback(() => {
    setRenamingReportId(null);
    setRenamingReportTitle("");
    renamingInputRef.current = null;
  }, []);

  const finishFolderSelection = useCallback(() => {
    setSelectingReportFolderId(null);
    setSelectingReportFolderValue("");
  }, []);

  const commitReportRename = useCallback(
    async (reportId: ReportRecord["id"], newTitle: string, originalTitle: string) => {
      const trimmedTitle = newTitle.trim();
      if (trimmedTitle.length === 0 || trimmedTitle === originalTitle) {
        finishReportRename();
        return;
      }
      if (!api) {
        finishReportRename();
        return;
      }

      try {
        const result = await api.reports.updateMeta({
          reportId,
          title: trimmedTitle,
        });
        upsertReportSnapshotRecord(queryClient, result.report);
        void queryClient.invalidateQueries({ queryKey: reportQueryKeys.all });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename report",
          description: toReportActionErrorMessage(error),
        });
      }

      finishReportRename();
    },
    [api, finishReportRename, queryClient],
  );

  const commitReportFolder = useCallback(
    async (report: ReportRecord, nextFolder: string | null) => {
      if (!api) {
        finishFolderSelection();
        return;
      }

      try {
        const result = await api.reports.updateMeta({
          reportId: report.id,
          folder: nextFolder,
        });
        upsertReportSnapshotRecord(queryClient, result.report);
        void queryClient.invalidateQueries({ queryKey: reportQueryKeys.all });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to update folder",
          description: toReportActionErrorMessage(error),
        });
      }

      finishFolderSelection();
    },
    [api, finishFolderSelection, queryClient],
  );

  const deleteReport = useCallback(
    async (report: ReportRecord) => {
      if (!api) {
        return;
      }

      try {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete report "${report.title}"?`,
            "This removes the report plan, run state, and generated metadata.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }

        await api.reports.delete(report.id);
        removeReportSnapshotRecord(queryClient, report.id);
        void queryClient.invalidateQueries({ queryKey: reportQueryKeys.all });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to delete report",
          description: toReportActionErrorMessage(error),
        });
      }
    },
    [api, queryClient],
  );

  const handleReportMenu = useCallback(
    async (report: ReportRecord, position: { x: number; y: number }) => {
      if (!api) {
        return;
      }

      const destinationFolders = existingFolderOptions.filter((folder) => folder !== props.folder);
      const clicked = await api.contextMenu.show(
        [
          { id: "rename", label: "Rename" },
          {
            id: "move",
            label: "Move to folder",
            disabled: destinationFolders.length === 0,
          },
          { id: "remove", label: `Remove from ${props.folder}` },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "rename") {
        finishFolderSelection();
        setRenamingReportId(report.id);
        setRenamingReportTitle(report.title);
        return;
      }

      if (clicked === "move") {
        finishReportRename();
        setSelectingReportFolderId(report.id);
        setSelectingReportFolderValue("");
        return;
      }

      if (clicked === "remove") {
        await commitReportFolder(report, null);
        return;
      }

      if (clicked === "delete") {
        await deleteReport(report);
      }
    },
    [
      api,
      commitReportFolder,
      deleteReport,
      existingFolderOptions,
      finishFolderSelection,
      finishReportRename,
      props.folder,
    ],
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-12 px-6 py-6 sm:px-8 sm:py-8">
        <div className="flex items-center gap-3">
          <FolderIcon className="size-7 text-foreground/85" />
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">{props.folder}</h1>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-medium tracking-wide text-muted-foreground">Reports</h2>
          <ReportCreationOptionsGrid
            compact
            busyMode={creatingReportMode}
            onSelect={handleCreateReportSelection}
          />
        </div>

        <div className="mx-auto w-[70%] space-y-2">
          {folderReports.map((report) => {
            const destinationFolders = existingFolderOptions.filter(
              (folder) => folder !== props.folder,
            );
            const showRenameInput = renamingReportId === report.id;
            const showMoveSelector = selectingReportFolderId === report.id;

            return (
              <div
                key={report.id}
                className="group/report-row flex items-start gap-3 rounded-md border-border/60 border-b px-3 py-2.5 transition-colors hover:bg-accent/50"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() =>
                    void navigate({
                      to: "/reports/$reportId",
                      params: { reportId: report.id },
                    })
                  }
                >
                  {showRenameInput ? (
                    <input
                      ref={(element) => {
                        if (element && renamingInputRef.current !== element) {
                          renamingInputRef.current = element;
                          element.focus();
                          element.select();
                        }
                      }}
                      value={renamingReportTitle}
                      className="w-full rounded-md border border-ring bg-transparent px-2 py-0.5 text-sm font-medium text-foreground outline-none"
                      onChange={(event) => setRenamingReportTitle(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void commitReportRename(report.id, renamingReportTitle, report.title);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          finishReportRename();
                        }
                      }}
                      onBlur={() =>
                        void commitReportRename(report.id, renamingReportTitle, report.title)
                      }
                    />
                  ) : (
                    <div className="truncate text-sm font-medium text-foreground">
                      {report.title}
                    </div>
                  )}

                  {showMoveSelector ? (
                    <div
                      className="mt-2 flex items-center gap-2"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Select
                        value={selectingReportFolderValue}
                        onValueChange={(value) => {
                          if (value === null) {
                            return;
                          }
                          setSelectingReportFolderValue(value);
                          void commitReportFolder(report, value);
                        }}
                      >
                        <SelectTrigger
                          className="h-8 min-w-52 rounded-xl border-border bg-background text-sm"
                          aria-label={`Move ${report.title} to another folder`}
                        >
                          <SelectValue placeholder="Select folder" />
                        </SelectTrigger>
                        <SelectPopup align="start" side="bottom" alignItemWithTrigger={false}>
                          {destinationFolders.map((folder) => (
                            <SelectItem hideIndicator key={folder} value={folder}>
                              {folder}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                      <Button size="xs" variant="ghost" onClick={finishFolderSelection}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {report.plan.metadata.brief}
                    </div>
                  )}
                </button>

                <div className="relative mt-1 w-16 shrink-0">
                  <div className="text-right text-sm text-muted-foreground transition-opacity group-hover/report-row:opacity-0">
                    {formatReportListDate(report.updatedAt)}
                  </div>
                  <button
                    type="button"
                    aria-label={`Manage ${report.title}`}
                    className="absolute top-0 right-0 inline-flex size-8 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/report-row:opacity-100"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      void handleReportMenu(report, {
                        x: rect.left,
                        y: rect.bottom,
                      });
                    }}
                  >
                    <EllipsisIcon className="size-5" />
                  </button>
                </div>
              </div>
            );
          })}

          {folderReports.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-10 text-center text-muted-foreground">
              No reports in this folder yet.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
