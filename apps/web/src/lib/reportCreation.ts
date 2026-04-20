import type { ReportCreateDraftInput } from "@t3tools/contracts";

export type ReportCreationMode = "guided" | "template" | "prebuilt";

export interface ReportCreationOption {
  readonly mode: ReportCreationMode;
  readonly title: string;
  readonly description: string;
}

export const REPORT_CREATION_OPTIONS: ReadonlyArray<ReportCreationOption> = [
  {
    mode: "guided",
    title: "User Guided New Report",
    description: "Start a step-by-step guided report creation process.",
  },
  {
    mode: "template",
    title: "Create New Template",
    description: "Design and save a reusable report template.",
  },
  {
    mode: "prebuilt",
    title: "Create Report from Prebuilt Template",
    description: "Browse and use existing template structures.",
  },
];

function resolveIndexedTitle(baseTitle: string, existingReportCount: number): string {
  return existingReportCount === 0 ? baseTitle : `${baseTitle} ${existingReportCount + 1}`;
}

export function buildReportDraftInput(
  mode: ReportCreationMode,
  existingReportCount: number,
): ReportCreateDraftInput {
  switch (mode) {
    case "template":
      return {
        title: resolveIndexedTitle("OpenReport Template", existingReportCount),
        reportType: "template",
        brief: "Design and save a reusable report template with clear structure and guidance.",
      };
    case "prebuilt":
      return {
        title: resolveIndexedTitle("OpenReport Prebuilt Draft", existingReportCount),
        reportType: "prebuilt_template",
        brief: "Start from a prebuilt template and adapt it to the current report brief.",
      };
    case "guided":
    default:
      return {
        title: resolveIndexedTitle("OpenReport Draft", existingReportCount),
        reportType: "user_guided",
        brief:
          "Summarize the core findings, evidence, and recommendations for the requested report.",
      };
  }
}
