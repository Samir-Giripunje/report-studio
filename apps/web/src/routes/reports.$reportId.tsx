import { createFileRoute } from "@tanstack/react-router";

import { ReportsRouteView } from "./reports";

function ReportDetailRouteView() {
  const { reportId } = Route.useParams();

  return <ReportsRouteView selectedReportId={reportId} selectedFolder={null} />;
}

export const Route = createFileRoute("/reports/$reportId")({
  component: ReportDetailRouteView,
});
