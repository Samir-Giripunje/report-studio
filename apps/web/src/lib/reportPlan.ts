import type { ReportPlan, ReportRecord, ReportSourceDocument } from "@t3tools/contracts";
import { normalizeReportFileRefs } from "@t3tools/shared/report";

export function buildGuidedReportPlan(
  report: ReportRecord,
  input: {
    brief: string;
    fileRefs: ReadonlyArray<string>;
    documents?: ReadonlyArray<ReportSourceDocument>;
  },
): ReportPlan {
  return {
    ...report.plan,
    metadata: {
      ...report.plan.metadata,
      brief: input.brief.trim(),
    },
    globalSourceConfig: {
      ...report.plan.globalSourceConfig,
      userDocuments: {
        ...report.plan.globalSourceConfig.userDocuments,
        fileRefs: normalizeReportFileRefs(input.fileRefs),
        documents: input.documents
          ? [...input.documents]
          : report.plan.globalSourceConfig.userDocuments.documents,
      },
    },
  };
}
