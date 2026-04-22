import { describe, expect, it } from "vitest";

import { parseReportsRouteSearch, resolveReportsRouteSelection } from "./reportsRouteSearch";

describe("reports route selection", () => {
  it("keeps folder selection on the reports index route", () => {
    const search = parseReportsRouteSearch({ folder: "Software One" });

    expect(resolveReportsRouteSelection({ params: {}, search })).toEqual({
      selectedReportId: null,
      selectedFolder: "Software One",
    });
  });

  it("uses report detail params ahead of folder search", () => {
    const search = parseReportsRouteSearch({ folder: "Software One" });

    expect(
      resolveReportsRouteSelection({
        params: { reportId: "report:123" },
        search,
      }),
    ).toEqual({
      selectedReportId: "report:123",
      selectedFolder: null,
    });
  });
});
