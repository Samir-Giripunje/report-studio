import { Debouncer } from "@tanstack/react-pacer";
import { type ProjectId, type ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

const PERSISTED_STATE_KEY = "t3code:ui-state:v1";
const LEGACY_PERSISTED_STATE_KEYS = [
  "t3code:renderer-state:v8",
  "t3code:renderer-state:v7",
  "t3code:renderer-state:v6",
  "t3code:renderer-state:v5",
  "t3code:renderer-state:v4",
  "t3code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

interface PersistedUiState {
  expandedProjectCwds?: string[];
  projectOrderCwds?: string[];
  reportFolderLatestUpdatedAtByLabel?: Record<string, string>;
  reportFolderOrderLabels?: string[];
}

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectOrder: ProjectId[];
  reportFolderLatestUpdatedAtByLabel: Record<string, string>;
  reportFolderOrder: string[];
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
}

export interface UiState extends UiProjectState, UiThreadState {}

export interface SyncProjectInput {
  id: ProjectId;
  cwd: string;
}

export interface SyncReportFolderInput {
  label: string;
  latestUpdatedAt: string;
}

export interface SyncThreadInput {
  id: ThreadId;
  seedVisitedAt?: string | undefined;
}

const initialState: UiState = {
  projectExpandedById: {},
  projectOrder: [],
  reportFolderLatestUpdatedAtByLabel: {},
  reportFolderOrder: [],
  threadLastVisitedAtById: {},
};

const persistedExpandedProjectCwds = new Set<string>();
const persistedProjectOrderCwds: string[] = [];
const persistedReportFolderOrderLabels: string[] = [];
const persistedReportFolderLatestUpdatedAtByLabel: Record<string, string> = {};
const currentProjectCwdById = new Map<ProjectId, string>();
let legacyKeysCleanedUp = false;

function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        const legacyRaw = window.localStorage.getItem(legacyKey);
        if (!legacyRaw) {
          continue;
        }
        hydratePersistedProjectState(JSON.parse(legacyRaw) as PersistedUiState);
        return hydratedInitialState();
      }
      return initialState;
    }
    hydratePersistedProjectState(JSON.parse(raw) as PersistedUiState);
    return hydratedInitialState();
  } catch {
    return initialState;
  }
}

function hydratedInitialState(): UiState {
  return {
    ...initialState,
    reportFolderLatestUpdatedAtByLabel: {
      ...persistedReportFolderLatestUpdatedAtByLabel,
    },
    reportFolderOrder: [...persistedReportFolderOrderLabels],
  };
}

function hydratePersistedProjectState(parsed: PersistedUiState): void {
  persistedExpandedProjectCwds.clear();
  persistedProjectOrderCwds.length = 0;
  persistedReportFolderOrderLabels.length = 0;
  for (const label of Object.keys(persistedReportFolderLatestUpdatedAtByLabel)) {
    delete persistedReportFolderLatestUpdatedAtByLabel[label];
  }
  for (const cwd of parsed.expandedProjectCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0) {
      persistedExpandedProjectCwds.add(cwd);
    }
  }
  for (const cwd of parsed.projectOrderCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0 && !persistedProjectOrderCwds.includes(cwd)) {
      persistedProjectOrderCwds.push(cwd);
    }
  }
  for (const label of parsed.reportFolderOrderLabels ?? []) {
    if (
      typeof label === "string" &&
      label.trim().length > 0 &&
      !persistedReportFolderOrderLabels.includes(label)
    ) {
      persistedReportFolderOrderLabels.push(label);
    }
  }
  for (const [label, latestUpdatedAt] of Object.entries(
    parsed.reportFolderLatestUpdatedAtByLabel ?? {},
  )) {
    if (
      typeof label === "string" &&
      label.trim().length > 0 &&
      typeof latestUpdatedAt === "string" &&
      latestUpdatedAt.length > 0
    ) {
      persistedReportFolderLatestUpdatedAtByLabel[label] = latestUpdatedAt;
    }
  }
}

function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const expandedProjectCwds = Object.entries(state.projectExpandedById)
      .filter(([, expanded]) => expanded)
      .flatMap(([projectId]) => {
        const cwd = currentProjectCwdById.get(projectId as ProjectId);
        return cwd ? [cwd] : [];
      });
    const projectOrderCwds = state.projectOrder.flatMap((projectId) => {
      const cwd = currentProjectCwdById.get(projectId);
      return cwd ? [cwd] : [];
    });
    const reportFolderOrderLabels = dedupeStrings(state.reportFolderOrder);
    const retainedReportFolderLabels = new Set(reportFolderOrderLabels);
    const reportFolderLatestUpdatedAtByLabel = Object.fromEntries(
      Object.entries(state.reportFolderLatestUpdatedAtByLabel).filter(
        ([label, latestUpdatedAt]) =>
          retainedReportFolderLabels.has(label) && latestUpdatedAt.length > 0,
      ),
    );
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        expandedProjectCwds,
        projectOrderCwds,
        reportFolderLatestUpdatedAtByLabel,
        reportFolderOrderLabels,
      } satisfies PersistedUiState),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

function recordsEqual<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false;
    }
  }
  return true;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}

function projectOrdersEqual(left: readonly ProjectId[], right: readonly ProjectId[]): boolean {
  return (
    left.length === right.length && left.every((projectId, index) => projectId === right[index])
  );
}

function stringOrdersEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function syncProjects(state: UiState, projects: readonly SyncProjectInput[]): UiState {
  const previousProjectCwdById = new Map(currentProjectCwdById);
  const previousProjectIdByCwd = new Map(
    [...previousProjectCwdById.entries()].map(([projectId, cwd]) => [cwd, projectId] as const),
  );
  currentProjectCwdById.clear();
  for (const project of projects) {
    currentProjectCwdById.set(project.id, project.cwd);
  }
  const cwdMappingChanged =
    previousProjectCwdById.size !== currentProjectCwdById.size ||
    projects.some((project) => previousProjectCwdById.get(project.id) !== project.cwd);

  const nextExpandedById: Record<string, boolean> = {};
  const previousExpandedById = state.projectExpandedById;
  const persistedOrderByCwd = new Map(
    persistedProjectOrderCwds.map((cwd, index) => [cwd, index] as const),
  );
  const mappedProjects = projects.map((project, index) => {
    const previousProjectIdForCwd = previousProjectIdByCwd.get(project.cwd);
    const expanded =
      previousExpandedById[project.id] ??
      (previousProjectIdForCwd ? previousExpandedById[previousProjectIdForCwd] : undefined) ??
      (persistedExpandedProjectCwds.size > 0
        ? persistedExpandedProjectCwds.has(project.cwd)
        : true);
    nextExpandedById[project.id] = expanded;
    return {
      id: project.id,
      cwd: project.cwd,
      incomingIndex: index,
    };
  });

  const nextProjectOrder =
    state.projectOrder.length > 0
      ? (() => {
          const nextProjectIdByCwd = new Map(
            mappedProjects.map((project) => [project.cwd, project.id] as const),
          );
          const usedProjectIds = new Set<ProjectId>();
          const orderedProjectIds: ProjectId[] = [];

          for (const projectId of state.projectOrder) {
            const matchedProjectId =
              (projectId in nextExpandedById ? projectId : undefined) ??
              (() => {
                const previousCwd = previousProjectCwdById.get(projectId);
                return previousCwd ? nextProjectIdByCwd.get(previousCwd) : undefined;
              })();
            if (!matchedProjectId || usedProjectIds.has(matchedProjectId)) {
              continue;
            }
            usedProjectIds.add(matchedProjectId);
            orderedProjectIds.push(matchedProjectId);
          }

          for (const project of mappedProjects) {
            if (usedProjectIds.has(project.id)) {
              continue;
            }
            orderedProjectIds.push(project.id);
          }

          return orderedProjectIds;
        })()
      : mappedProjects
          .map((project) => ({
            id: project.id,
            incomingIndex: project.incomingIndex,
            orderIndex:
              persistedOrderByCwd.get(project.cwd) ??
              persistedProjectOrderCwds.length + project.incomingIndex,
          }))
          .toSorted((left, right) => {
            const byOrder = left.orderIndex - right.orderIndex;
            if (byOrder !== 0) {
              return byOrder;
            }
            return left.incomingIndex - right.incomingIndex;
          })
          .map((project) => project.id);

  if (
    recordsEqual(state.projectExpandedById, nextExpandedById) &&
    projectOrdersEqual(state.projectOrder, nextProjectOrder) &&
    !cwdMappingChanged
  ) {
    return state;
  }

  return {
    ...state,
    projectExpandedById: nextExpandedById,
    projectOrder: nextProjectOrder,
  };
}

export function syncReportFolders(
  state: UiState,
  folders: readonly SyncReportFolderInput[],
): UiState {
  const latestUpdatedAtByLabel = new Map<string, string>();

  for (const folder of folders) {
    const label = folder.label.trim();
    if (label.length === 0 || folder.latestUpdatedAt.length === 0) {
      continue;
    }
    const currentLatest = latestUpdatedAtByLabel.get(label);
    if (
      currentLatest === undefined ||
      timestampMs(folder.latestUpdatedAt) > timestampMs(currentLatest)
    ) {
      latestUpdatedAtByLabel.set(label, folder.latestUpdatedAt);
    }
  }

  const incomingLabels = [...latestUpdatedAtByLabel.keys()].toSorted((left, right) => {
    const byUpdatedAt =
      timestampMs(latestUpdatedAtByLabel.get(right) ?? "") -
      timestampMs(latestUpdatedAtByLabel.get(left) ?? "");
    if (byUpdatedAt !== 0) {
      return byUpdatedAt;
    }
    return left.localeCompare(right);
  });
  const incomingLabelSet = new Set(incomingLabels);
  const existingOrder = dedupeStrings(state.reportFolderOrder).filter((label) =>
    incomingLabelSet.has(label),
  );
  const existingOrderSet = new Set(existingOrder);
  const hasPreviousFolderState =
    state.reportFolderOrder.length > 0 ||
    Object.keys(state.reportFolderLatestUpdatedAtByLabel).length > 0;

  const nextLatestUpdatedAtByLabel = Object.fromEntries(latestUpdatedAtByLabel);
  const nextReportFolderOrder = hasPreviousFolderState
    ? (() => {
        const baseOrder = [
          ...existingOrder,
          ...incomingLabels.filter((label) => !existingOrderSet.has(label)),
        ];
        const promotedLabelSet = new Set<string>();
        for (const label of incomingLabels) {
          if (!existingOrderSet.has(label)) {
            promotedLabelSet.add(label);
            continue;
          }
          const previousLatest = state.reportFolderLatestUpdatedAtByLabel[label];
          const nextLatest = latestUpdatedAtByLabel.get(label);
          if (
            previousLatest !== undefined &&
            nextLatest !== undefined &&
            timestampMs(nextLatest) > timestampMs(previousLatest)
          ) {
            promotedLabelSet.add(label);
          }
        }
        const promotedLabels = incomingLabels.filter((label) => promotedLabelSet.has(label));
        return [...promotedLabels, ...baseOrder.filter((label) => !promotedLabelSet.has(label))];
      })()
    : incomingLabels;

  if (
    stringOrdersEqual(state.reportFolderOrder, nextReportFolderOrder) &&
    recordsEqual(state.reportFolderLatestUpdatedAtByLabel, nextLatestUpdatedAtByLabel)
  ) {
    return state;
  }

  return {
    ...state,
    reportFolderLatestUpdatedAtByLabel: nextLatestUpdatedAtByLabel,
    reportFolderOrder: nextReportFolderOrder,
  };
}

export function syncThreads(state: UiState, threads: readonly SyncThreadInput[]): UiState {
  const retainedThreadIds = new Set(threads.map((thread) => thread.id));
  const nextThreadLastVisitedAtById = Object.fromEntries(
    Object.entries(state.threadLastVisitedAtById).filter(([threadId]) =>
      retainedThreadIds.has(threadId as ThreadId),
    ),
  );
  for (const thread of threads) {
    if (
      nextThreadLastVisitedAtById[thread.id] === undefined &&
      thread.seedVisitedAt !== undefined &&
      thread.seedVisitedAt.length > 0
    ) {
      nextThreadLastVisitedAtById[thread.id] = thread.seedVisitedAt;
    }
  }
  if (recordsEqual(state.threadLastVisitedAtById, nextThreadLastVisitedAtById)) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
  };
}

export function markThreadVisited(state: UiState, threadId: ThreadId, visitedAt?: string): UiState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const previousVisitedAt = state.threadLastVisitedAtById[threadId];
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: at,
    },
  };
}

export function markThreadUnread(
  state: UiState,
  threadId: ThreadId,
  latestTurnCompletedAt: string | null | undefined,
): UiState {
  if (!latestTurnCompletedAt) {
    return state;
  }
  const latestTurnCompletedAtMs = Date.parse(latestTurnCompletedAt);
  if (Number.isNaN(latestTurnCompletedAtMs)) {
    return state;
  }
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  };
}

export function clearThreadUi(state: UiState, threadId: ThreadId): UiState {
  if (!(threadId in state.threadLastVisitedAtById)) {
    return state;
  }
  const nextThreadLastVisitedAtById = { ...state.threadLastVisitedAtById };
  delete nextThreadLastVisitedAtById[threadId];
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
  };
}

export function toggleProject(state: UiState, projectId: ProjectId): UiState {
  const expanded = state.projectExpandedById[projectId] ?? true;
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: !expanded,
    },
  };
}

export function setProjectExpanded(
  state: UiState,
  projectId: ProjectId,
  expanded: boolean,
): UiState {
  if ((state.projectExpandedById[projectId] ?? true) === expanded) {
    return state;
  }
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: expanded,
    },
  };
}

export function reorderProjects(
  state: UiState,
  draggedProjectId: ProjectId,
  targetProjectId: ProjectId,
): UiState {
  if (draggedProjectId === targetProjectId) {
    return state;
  }
  const draggedIndex = state.projectOrder.findIndex((projectId) => projectId === draggedProjectId);
  const targetIndex = state.projectOrder.findIndex((projectId) => projectId === targetProjectId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return state;
  }
  const projectOrder = [...state.projectOrder];
  const [draggedProject] = projectOrder.splice(draggedIndex, 1);
  if (!draggedProject) {
    return state;
  }
  projectOrder.splice(targetIndex, 0, draggedProject);
  return {
    ...state,
    projectOrder,
  };
}

export function reorderReportFolders(
  state: UiState,
  draggedFolderLabel: string,
  targetFolderLabel: string,
): UiState {
  if (draggedFolderLabel === targetFolderLabel) {
    return state;
  }
  const draggedIndex = state.reportFolderOrder.findIndex((label) => label === draggedFolderLabel);
  const targetIndex = state.reportFolderOrder.findIndex((label) => label === targetFolderLabel);
  if (draggedIndex < 0 || targetIndex < 0) {
    return state;
  }
  const reportFolderOrder = [...state.reportFolderOrder];
  const [draggedFolder] = reportFolderOrder.splice(draggedIndex, 1);
  if (!draggedFolder) {
    return state;
  }
  reportFolderOrder.splice(targetIndex, 0, draggedFolder);
  return {
    ...state,
    reportFolderOrder,
  };
}

interface UiStateStore extends UiState {
  syncProjects: (projects: readonly SyncProjectInput[]) => void;
  syncReportFolders: (folders: readonly SyncReportFolderInput[]) => void;
  syncThreads: (threads: readonly SyncThreadInput[]) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId, latestTurnCompletedAt: string | null | undefined) => void;
  clearThreadUi: (threadId: ThreadId) => void;
  toggleProject: (projectId: ProjectId) => void;
  setProjectExpanded: (projectId: ProjectId, expanded: boolean) => void;
  reorderProjects: (draggedProjectId: ProjectId, targetProjectId: ProjectId) => void;
  reorderReportFolders: (draggedFolderLabel: string, targetFolderLabel: string) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  syncProjects: (projects) => set((state) => syncProjects(state, projects)),
  syncReportFolders: (folders) => set((state) => syncReportFolders(state, folders)),
  syncThreads: (threads) => set((state) => syncThreads(state, threads)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set((state) => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  clearThreadUi: (threadId) => set((state) => clearThreadUi(state, threadId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectId, targetProjectId) =>
    set((state) => reorderProjects(state, draggedProjectId, targetProjectId)),
  reorderReportFolders: (draggedFolderLabel, targetFolderLabel) =>
    set((state) => reorderReportFolders(state, draggedFolderLabel, targetFolderLabel)),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
