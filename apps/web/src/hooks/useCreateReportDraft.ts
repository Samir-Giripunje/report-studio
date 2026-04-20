import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { toastManager } from "~/components/ui/toast";
import { type ReportCreationMode, buildReportDraftInput } from "~/lib/reportCreation";
import { reportQueryKeys } from "~/lib/reportReactQuery";
import { readNativeApi } from "~/nativeApi";

export function useCreateReportDraft(existingReportCount: number) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useCallback(
    async (options: { mode: ReportCreationMode; folder?: string | null }): Promise<boolean> => {
      const api = readNativeApi();
      if (!api) {
        return false;
      }

      try {
        const result = await api.reports.createDraft(
          buildReportDraftInput(options.mode, existingReportCount),
        );
        const normalizedFolder = options.folder?.trim() ?? null;
        if (normalizedFolder) {
          await api.reports.updateMeta({
            reportId: result.report.id,
            folder: normalizedFolder,
          });
        }
        await queryClient.invalidateQueries({ queryKey: reportQueryKeys.all });
        await navigate({
          to: "/reports/$reportId",
          params: { reportId: result.report.id },
        });
        return true;
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to create report",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
        return false;
      }
    },
    [existingReportCount, navigate, queryClient],
  );
}
