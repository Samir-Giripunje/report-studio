import type { ReportRecord, ReportSnapshot } from "@t3tools/contracts";
import type { QueryClient } from "@tanstack/react-query";

import { reportQueryKeys } from "./reportReactQuery";

function updateReportSnapshot(
  queryClient: QueryClient,
  updater: (reports: ReadonlyArray<ReportRecord>) => ReadonlyArray<ReportRecord>,
) {
  queryClient.setQueryData<ReportSnapshot>(reportQueryKeys.snapshot(), (current) => ({
    reports: updater(current?.reports ?? []),
  }));
}

export function upsertReportSnapshotRecord(queryClient: QueryClient, report: ReportRecord) {
  updateReportSnapshot(queryClient, (reports) => {
    const existingIndex = reports.findIndex((candidate) => candidate.id === report.id);
    if (existingIndex === -1) {
      return [...reports, report];
    }

    return reports.map((candidate, index) => (index === existingIndex ? report : candidate));
  });
}

export function removeReportSnapshotRecord(queryClient: QueryClient, reportId: ReportRecord["id"]) {
  updateReportSnapshot(queryClient, (reports) =>
    reports.filter((candidate) => candidate.id !== reportId),
  );
}
