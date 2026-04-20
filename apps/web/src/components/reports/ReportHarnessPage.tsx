import {
  type ReportPlan,
  type ReportRecord,
  type ReportSectionNode,
  type ReportSectionRun,
} from "@t3tools/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlayIcon, RefreshCcwIcon, SaveIcon, ShieldCheckIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useCreateReportDraft } from "~/hooks/useCreateReportDraft";
import { type ReportCreationMode } from "~/lib/reportCreation";
import { readNativeApi } from "~/nativeApi";
import { reportQueryKeys, reportSnapshotQueryOptions } from "~/lib/reportReactQuery";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Textarea } from "../ui/textarea";
import { NewReportDialog } from "./NewReportDialog";
import { ReportGuidedComposer } from "./ReportGuidedComposer";

type ReportSectionLike = ReportSectionNode | ReportSectionRun;

function statusBadgeVariant(status: ReportRecord["status"]) {
  switch (status) {
    case "approved":
      return "info";
    case "running":
      return "warning";
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "draft":
    default:
      return "outline";
  }
}

function sectionStatusBadgeVariant(status: ReportSectionRun["status"]) {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "running":
      return "warning";
    case "ready":
      return "info";
    case "blocked":
    default:
      return "outline";
  }
}

function flattenSectionTree(sectionTree: ReadonlyArray<ReportSectionNode>): ReportSectionNode[] {
  const flattened: ReportSectionNode[] = [];

  const visit = (section: ReportSectionNode) => {
    flattened.push(section);
    for (const child of section.children) {
      visit(child);
    }
  };

  for (const section of sectionTree) {
    visit(section);
  }

  return flattened;
}

function sectionKey(section: ReportSectionLike): string {
  return "sectionId" in section ? section.sectionId : section.id;
}

function sectionTitle(section: ReportSectionLike): string {
  return section.title;
}

function sectionDependsOn(section: ReportSectionLike): ReadonlyArray<string> {
  return section.dependsOn;
}

function isUserGuidedReport(report: ReportRecord): boolean {
  return report.plan.metadata.reportType === "user_guided";
}

export function ReportHarnessPage(props: { selectedReportId?: string | null }) {
  const api = readNativeApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery(reportSnapshotQueryOptions());
  const [planDraft, setPlanDraft] = useState("");
  const [isNewReportDialogOpen, setIsNewReportDialogOpen] = useState(false);
  const [creatingReportMode, setCreatingReportMode] = useState<ReportCreationMode | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const snapshot = snapshotQuery.data;
  const selectedReportId = props.selectedReportId ?? null;
  const createReportDraft = useCreateReportDraft(snapshot?.reports.length ?? 0);

  const refreshSnapshot = useCallback(
    async () => queryClient.invalidateQueries({ queryKey: reportQueryKeys.all }),
    [queryClient],
  );

  useEffect(() => {
    if (snapshotQuery.error) {
      setError(
        snapshotQuery.error instanceof Error
          ? snapshotQuery.error.message
          : "Failed to load reports.",
      );
      return;
    }
    setError(null);
  }, [snapshotQuery.error]);

  const selectedReport = useMemo(
    () =>
      (selectedReportId
        ? snapshot?.reports.find((report) => report.id === selectedReportId)
        : null) ??
      snapshot?.reports[0] ??
      null,
    [selectedReportId, snapshot?.reports],
  );

  useEffect(() => {
    if (!selectedReportId) {
      return;
    }
    if (snapshotQuery.isLoading || snapshotQuery.isFetching) {
      return;
    }
    if (snapshot?.reports.some((report) => report.id === selectedReportId)) {
      return;
    }

    const fallbackReportId = snapshot?.reports[0]?.id ?? null;
    void navigate(
      fallbackReportId
        ? {
            to: "/reports/$reportId",
            params: { reportId: fallbackReportId },
            replace: true,
          }
        : {
            to: "/reports",
            replace: true,
          },
    );
  }, [
    navigate,
    selectedReportId,
    snapshot?.reports,
    snapshotQuery.isFetching,
    snapshotQuery.isLoading,
  ]);

  const displayedSections = useMemo(
    () =>
      selectedReport?.latestRun?.sectionRuns ??
      (selectedReport ? flattenSectionTree(selectedReport.plan.sectionTree) : []),
    [selectedReport],
  );

  useEffect(() => {
    if (!selectedReport) {
      setPlanDraft("");
      return;
    }
    setPlanDraft(JSON.stringify(selectedReport.plan, null, 2));
  }, [selectedReport]);

  const runAction = useCallback(
    async (tag: string, work: () => Promise<void>) => {
      setBusyAction(tag);
      setError(null);
      try {
        await work();
        await refreshSnapshot();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The report action failed.");
      } finally {
        setBusyAction(null);
      }
    },
    [refreshSnapshot],
  );

  const handleCreateReportSelection = useCallback(
    async (mode: ReportCreationMode) => {
      setCreatingReportMode(mode);
      const created = await createReportDraft({ mode });
      if (created) {
        setIsNewReportDialogOpen(false);
      }
      setCreatingReportMode(null);
    },
    [createReportDraft],
  );

  const handleSavePlan = async () => {
    if (!api || !selectedReport) {
      return;
    }
    await runAction("save", async () => {
      const parsedPlan = JSON.parse(planDraft) as ReportPlan;
      await api.reports.updatePlan({
        reportId: selectedReport.id,
        plan: parsedPlan,
      });
    });
  };

  const handleApprove = async () => {
    if (!api || !selectedReport) {
      return;
    }
    await runAction("approve", async () => {
      await api.reports.approve(selectedReport.id);
    });
  };

  const handleStartRun = async () => {
    if (!api || !selectedReport) {
      return;
    }
    await runAction("start-run", async () => {
      await api.reports.startRun({ reportId: selectedReport.id });
    });
  };

  const handleBeginGuidedPlanning = useCallback(
    async (input: { brief: string; fileRefs: string[] }) => {
      if (!api || !selectedReport) {
        return;
      }

      await runAction("begin-guided-planning", async () => {
        await api.reports.beginPlanning({
          reportId: selectedReport.id,
          brief: input.brief,
          fileRefs: input.fileRefs,
        });
      });
    },
    [api, runAction, selectedReport],
  );

  const handleRespondToGuidedPlanning = useCallback(
    async (response: string) => {
      if (!api || !selectedReport) {
        return;
      }

      await runAction("respond-guided-planning", async () => {
        await api.reports.respondToPlanning({
          reportId: selectedReport.id,
          response,
        });
      });
    },
    [api, runAction, selectedReport],
  );

  return (
    <>
      <NewReportDialog
        open={isNewReportDialogOpen}
        busyMode={creatingReportMode}
        onOpenChange={(open) => {
          setIsNewReportDialogOpen(open);
          if (!open) {
            setCreatingReportMode(null);
          }
        }}
        onSelect={handleCreateReportSelection}
      />

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto min-h-full max-w-6xl">
          {selectedReport ? (
            <div className="space-y-4">
              {isUserGuidedReport(selectedReport) ? (
                <ReportGuidedComposer
                  busy={busyAction !== null}
                  report={selectedReport}
                  onApprove={handleApprove}
                  onRespond={handleRespondToGuidedPlanning}
                  onStartRun={handleStartRun}
                  onStartPlanning={handleBeginGuidedPlanning}
                />
              ) : (
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle>{selectedReport.title}</CardTitle>
                        <CardDescription>{selectedReport.plan.metadata.brief}</CardDescription>
                      </div>
                      <Badge variant={statusBadgeVariant(selectedReport.status)}>
                        {selectedReport.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    <Button
                      disabled={busyAction !== null}
                      variant="outline"
                      onClick={() => void refreshSnapshot()}
                    >
                      <RefreshCcwIcon className="size-3.5" />
                      Refresh
                    </Button>
                    <Button
                      disabled={busyAction !== null}
                      variant="outline"
                      onClick={() => void handleSavePlan()}
                    >
                      <SaveIcon className="size-3.5" />
                      Save plan JSON
                    </Button>
                    <Button
                      disabled={busyAction !== null || selectedReport.status === "running"}
                      variant="outline"
                      onClick={() => void handleApprove()}
                    >
                      <ShieldCheckIcon className="size-3.5" />
                      Approve plan
                    </Button>
                    <Button
                      disabled={busyAction !== null || selectedReport.plan.status !== "finalized"}
                      onClick={() => void handleStartRun()}
                    >
                      <PlayIcon className="size-3.5" />
                      Start orchestration
                    </Button>
                  </CardContent>
                </Card>
              )}

              {error ? (
                <Card className="border-destructive/40">
                  <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
                </Card>
              ) : null}

              {!isUserGuidedReport(selectedReport) ? (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
                  <Card className="min-h-[28rem]">
                    <CardHeader>
                      <CardTitle>Plan JSON</CardTitle>
                      <CardDescription>
                        Edit the typed report plan directly for now. A richer planner UI can layer
                        on top of the same contract.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        className="min-h-[24rem]"
                        value={planDraft}
                        onChange={(event) => setPlanDraft(event.target.value)}
                      />
                    </CardContent>
                  </Card>

                  <div className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle>Sections</CardTitle>
                        <CardDescription>
                          {selectedReport.latestRun
                            ? "Initial orchestration graph and readiness."
                            : "Section topology from the current plan."}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {displayedSections.map((section) => (
                          <div
                            key={sectionKey(section)}
                            className="rounded-xl border border-border/70 bg-background px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">
                                  {sectionTitle(section)}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {sectionDependsOn(section).length > 0
                                    ? `Depends on ${sectionDependsOn(section).join(", ")}`
                                    : "No dependencies"}
                                </div>
                              </div>
                              {"status" in section ? (
                                <Badge
                                  size="sm"
                                  variant={sectionStatusBadgeVariant(section.status)}
                                >
                                  {section.status}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>

                    {selectedReport.latestRun ? (
                      <Card>
                        <CardHeader>
                          <CardTitle>Execution log</CardTitle>
                          <CardDescription>
                            Current run state for the report harness.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {selectedReport.latestRun.executionLog.map((entry) => (
                            <div
                              key={`${entry.at}-${entry.kind}-${entry.message}`}
                              className="rounded-xl border border-border/70 bg-background px-3 py-2"
                            >
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {entry.kind}
                              </div>
                              <div className="mt-1 text-sm text-foreground">{entry.message}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{entry.at}</div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <Card className="mx-auto flex min-h-[60vh] max-w-3xl">
              <CardContent className="flex h-full flex-1 flex-col items-center justify-center gap-4 text-sm text-muted-foreground">
                <p>Create a report to get started.</p>
                <Button
                  disabled={creatingReportMode !== null}
                  onClick={() => setIsNewReportDialogOpen(true)}
                >
                  Create report
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
