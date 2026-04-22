export interface ReportsRouteSearch {
  folder: string | null;
}

export interface ReportsRouteSelection {
  selectedReportId: string | null;
  selectedFolder: string | null;
}

function normalizeSearchString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function parseReportsRouteSearch(search: Record<string, unknown>): ReportsRouteSearch {
  return {
    folder: normalizeSearchString(search.folder),
  };
}

export function resolveReportsRouteSelection(input: {
  params: Record<string, unknown>;
  search: ReportsRouteSearch;
}): ReportsRouteSelection {
  const selectedReportId = normalizeSearchString(input.params.reportId);

  return {
    selectedReportId,
    selectedFolder: selectedReportId === null ? input.search.folder : null,
  };
}
