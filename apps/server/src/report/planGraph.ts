import type {
  ReportExecutionState,
  ReportPlan,
  ReportRunId,
  ReportSectionNode,
  ReportSectionRun,
} from "@t3tools/contracts";

export interface FlatReportSection {
  readonly id: string;
  readonly title: string;
  readonly depth: number;
  readonly dependsOn: ReadonlyArray<string>;
  readonly generationOrder: number | "last";
}

export class ReportPlanGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportPlanGraphError";
  }
}

function compareSections(left: FlatReportSection, right: FlatReportSection) {
  const leftOrder =
    left.generationOrder === "last" ? Number.MAX_SAFE_INTEGER : left.generationOrder;
  const rightOrder =
    right.generationOrder === "last" ? Number.MAX_SAFE_INTEGER : right.generationOrder;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (left.depth !== right.depth) {
    return left.depth - right.depth;
  }
  return left.id.localeCompare(right.id);
}

export function flattenReportSections(
  sectionTree: ReadonlyArray<ReportSectionNode>,
): ReadonlyArray<FlatReportSection> {
  const sections: Array<FlatReportSection> = [];

  const visit = (section: ReportSectionNode) => {
    sections.push({
      id: section.id,
      title: section.title,
      depth: section.depth,
      dependsOn: [...section.dependsOn],
      generationOrder: section.generationOrder,
    });
    for (const child of section.children) {
      visit(child);
    }
  };

  for (const section of sectionTree) {
    visit(section);
  }

  return sections;
}

export function sortReportSectionsForExecution(
  sectionTree: ReadonlyArray<ReportSectionNode>,
): ReadonlyArray<FlatReportSection> {
  const sections = flattenReportSections(sectionTree);
  const byId = new Map(sections.map((section) => [section.id, section]));
  const inDegree = new Map(sections.map((section) => [section.id, 0]));
  const outgoing = new Map<string, Array<string>>();

  for (const section of sections) {
    for (const dependencyId of section.dependsOn) {
      if (!byId.has(dependencyId)) {
        throw new ReportPlanGraphError(
          `Section '${section.id}' depends on unknown section '${dependencyId}'.`,
        );
      }
      inDegree.set(section.id, (inDegree.get(section.id) ?? 0) + 1);
      const dependencyChildren = outgoing.get(dependencyId) ?? [];
      dependencyChildren.push(section.id);
      outgoing.set(dependencyId, dependencyChildren);
    }
  }

  const ready = sections
    .filter((section) => (inDegree.get(section.id) ?? 0) === 0)
    .toSorted(compareSections);
  const ordered: Array<FlatReportSection> = [];

  while (ready.length > 0) {
    const next = ready.shift();
    if (!next) {
      break;
    }
    ordered.push(next);
    const dependents = outgoing.get(next.id) ?? [];
    for (const dependentId of dependents) {
      const nextInDegree = (inDegree.get(dependentId) ?? 0) - 1;
      inDegree.set(dependentId, nextInDegree);
      if (nextInDegree === 0) {
        const dependent = byId.get(dependentId);
        if (dependent) {
          ready.push(dependent);
          ready.sort(compareSections);
        }
      }
    }
  }

  if (ordered.length !== sections.length) {
    const remaining = sections
      .filter((section) => !ordered.some((candidate) => candidate.id === section.id))
      .map((section) => section.id)
      .toSorted();
    throw new ReportPlanGraphError(
      `Report plan contains a dependency cycle involving: ${remaining.join(", ")}.`,
    );
  }

  return ordered;
}

export function buildInitialExecutionState(input: {
  readonly runId: ReportRunId;
  readonly plan: ReportPlan;
  readonly startedAt: string;
}): ReportExecutionState {
  const orderedSections = sortReportSectionsForExecution(input.plan.sectionTree);
  const sectionRuns: ReportSectionRun[] = orderedSections.map((section, index) => ({
    sectionId: section.id,
    title: section.title,
    depth: section.depth,
    dependsOn: [...section.dependsOn],
    order: index + 1,
    status: section.dependsOn.length === 0 ? "ready" : "blocked",
    retryCount: 0,
    lastError: null,
  }));

  return {
    runId: input.runId,
    status: "running",
    sectionRuns,
    executionLog: [
      {
        at: input.startedAt,
        kind: "run.started",
        message: `Initialized report orchestration for ${sectionRuns.length} sections.`,
        payload: {
          reportTitle: input.plan.metadata.title,
          readySectionIds: sectionRuns
            .filter((section) => section.status === "ready")
            .map((section) => section.sectionId),
        },
      },
    ],
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    completedAt: null,
    finalArtifact: null,
  };
}
