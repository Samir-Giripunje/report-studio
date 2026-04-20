import type { ReportRecord } from "@t3tools/contracts";
import type { SidebarReportSortOrder } from "@t3tools/contracts/settings";

export interface ReportFolderGroup {
  readonly key: string;
  readonly label: string;
  readonly reports: ReadonlyArray<ReportRecord>;
}

export function sortReportsForSidebar(
  reports: readonly ReportRecord[],
  sortOrder: SidebarReportSortOrder,
): ReportRecord[] {
  return [...reports].toSorted((left, right) => {
    const leftAt = Date.parse(sortOrder === "created_at" ? left.createdAt : left.updatedAt);
    const rightAt = Date.parse(sortOrder === "created_at" ? right.createdAt : right.updatedAt);
    if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) {
      return rightAt - leftAt;
    }
    return left.title.localeCompare(right.title);
  });
}

export function groupReportsForSidebar(reports: readonly ReportRecord[]): {
  readonly ungroupedReports: ReadonlyArray<ReportRecord>;
  readonly folderGroups: ReadonlyArray<ReportFolderGroup>;
} {
  const grouped = new Map<string, ReportRecord[]>();
  const ungroupedReports: ReportRecord[] = [];

  for (const report of reports) {
    if (!report.folder) {
      ungroupedReports.push(report);
      continue;
    }
    const folderReports = grouped.get(report.folder) ?? [];
    folderReports.push(report);
    grouped.set(report.folder, folderReports);
  }

  const folderGroups = [...grouped.entries()]
    .map(([label, folderReports]) => ({
      key: label,
      label,
      reports: folderReports,
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label));

  return {
    ungroupedReports,
    folderGroups,
  };
}

export function reportMatchesSidebarQuery(report: ReportRecord, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }

  return [report.title, report.folder ?? "", report.status, report.plan.metadata.brief].some(
    (value) => value.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function formatReportListDate(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(isoDate));
}
