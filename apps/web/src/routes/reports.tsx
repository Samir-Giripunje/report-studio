import { createFileRoute, useSearch } from "@tanstack/react-router";

import { ReportFolderPage } from "../components/reports/ReportFolderPage";
import { ReportHarnessPage } from "../components/reports/ReportHarnessPage";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { isElectron } from "../env";
import { parseReportsRouteSearch } from "../reportsRouteSearch";

export function ReportsRouteView(props: {
  selectedReportId?: string | null;
  selectedFolder?: string | null;
}) {
  const selectedReportId = props.selectedReportId ?? null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-5">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0" />
              <span className="text-sm font-medium text-foreground">Reports</span>
            </div>
          </header>
        )}

        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <SidebarTrigger className="shrink-0 [-webkit-app-region:no-drag]" />
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Reports
            </span>
          </div>
        )}

        {selectedReportId === null && props.selectedFolder ? (
          <ReportFolderPage folder={props.selectedFolder} />
        ) : (
          <ReportHarnessPage selectedReportId={selectedReportId} />
        )}
      </div>
    </SidebarInset>
  );
}

function ReportsIndexRouteView() {
  const search = useSearch({
    strict: false,
    select: (nextSearch) => parseReportsRouteSearch(nextSearch),
  });

  return <ReportsRouteView selectedFolder={search.folder} />;
}

export const Route = createFileRoute("/reports")({
  component: ReportsIndexRouteView,
});
