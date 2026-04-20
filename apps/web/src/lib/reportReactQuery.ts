import type { ReportSnapshot } from "@t3tools/contracts";
import { queryOptions } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";

export const reportQueryKeys = {
  all: ["reports"] as const,
  snapshot: () => ["reports", "snapshot"] as const,
};

const EMPTY_REPORT_SNAPSHOT: ReportSnapshot = {
  reports: [],
};

export function reportSnapshotQueryOptions() {
  return queryOptions({
    queryKey: reportQueryKeys.snapshot(),
    queryFn: async () => ensureNativeApi().reports.getSnapshot(),
    placeholderData: (previous) => previous ?? EMPTY_REPORT_SNAPSHOT,
    staleTime: 5_000,
  });
}
