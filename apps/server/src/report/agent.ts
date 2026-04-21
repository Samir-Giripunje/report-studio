import type {
  ProviderApiKeys,
  ReportExecutionState,
  ReportOutputFormat,
  ReportPlan,
  ReportPlanningMessage,
  ReportPlanningOutline,
  ReportPlanningQuestion,
  ReportSectionRun,
  ReportSourceDocument,
} from "@t3tools/contracts";
import { normalizeReportFileRefs } from "@t3tools/shared/report";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

import { sortReportSectionsForExecution } from "./planGraph.ts";

type ReportPlanSection = ReportPlan["sectionTree"][number];

type ReportAgentBackend = "openai" | "gemini";

interface ReportAgentModelTarget {
  readonly backend: ReportAgentBackend;
  readonly model: string;
}

interface ReportPlanningDecisionSection {
  readonly title: string;
  readonly summary: string;
  readonly guidance: ReadonlyArray<string>;
}

interface ReportPlanningDecision {
  readonly status: "clarification-needed" | "awaiting-approval";
  readonly assistantMessage: string;
  readonly questions: ReadonlyArray<string>;
  readonly audience: string | null;
  readonly tone: string | null;
  readonly outline: {
    readonly title: string;
    readonly summary: string;
    readonly sections: ReadonlyArray<ReportPlanningDecisionSection>;
  } | null;
}

const MAX_DOCUMENT_COUNT = 6;
const MAX_DOCUMENT_TEXT_CHARS = 12_000;
const MAX_TOTAL_SOURCE_CHARS = 32_000;
const EXECUTIVE_SUMMARY_PATTERNS = [
  "executive summary",
  "summary",
  "key takeaways",
  "decision summary",
] as const;

const REPORT_PLANNING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "assistantMessage", "questions", "audience", "tone", "outline"],
  properties: {
    status: {
      type: "string",
      enum: ["clarification-needed", "awaiting-approval"],
    },
    assistantMessage: { type: "string" },
    questions: {
      type: "array",
      items: { type: "string" },
    },
    audience: {
      type: ["string", "null"],
    },
    tone: {
      type: ["string", "null"],
    },
    outline: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["title", "summary", "sections"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "summary", "guidance"],
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              guidance: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function limitText(text: string, maxChars: number): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars).trim()}\n...[truncated]`;
}

function slugifySectionId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function makePlanningMessage(input: {
  readonly role: ReportPlanningMessage["role"];
  readonly text: string;
  readonly createdAt: string;
}): ReportPlanningMessage {
  return {
    id: `report-planning-message:${crypto.randomUUID()}`,
    role: input.role,
    text: input.text.trim(),
    createdAt: input.createdAt,
  };
}

function makePlanningQuestion(index: number, question: string): ReportPlanningQuestion {
  return {
    id: `report-planning-question:${index + 1}`,
    question: question.trim(),
  };
}

function appendClarificationToBrief(brief: string, response: string): string {
  return `${brief.trim()}\n\nUser clarification:\n${response.trim()}`;
}

function normalizeDocuments(
  documents: ReadonlyArray<ReportSourceDocument>,
): ReadonlyArray<ReportSourceDocument> {
  return documents
    .map((document) => ({
      name: document.name.trim(),
      mimeType: document.mimeType.trim(),
      textContent: document.textContent.trim(),
    }))
    .filter((document) => document.name.length > 0 && document.mimeType.length > 0);
}

function buildDocumentContext(documents: ReadonlyArray<ReportSourceDocument>): string {
  let remainingChars = MAX_TOTAL_SOURCE_CHARS;
  const sections: string[] = [];

  for (const [index, document] of documents.slice(0, MAX_DOCUMENT_COUNT).entries()) {
    const header = `${index + 1}. ${document.name} (${document.mimeType})`;
    const content =
      document.textContent.length > 0
        ? limitText(document.textContent, Math.min(MAX_DOCUMENT_TEXT_CHARS, remainingChars))
        : "[text content unavailable]";

    sections.push(`${header}\n${content}`);
    remainingChars -= content.length;
    if (remainingChars <= 0) {
      break;
    }
  }

  return sections.length > 0 ? sections.join("\n\n") : "No uploaded documents were provided.";
}

function buildPlanningPrompt(input: {
  readonly title: string;
  readonly brief: string;
  readonly fileRefs: ReadonlyArray<string>;
  readonly documents: ReadonlyArray<ReportSourceDocument>;
  readonly priorConversation: ReadonlyArray<ReportPlanningMessage>;
}): string {
  const conversationText =
    input.priorConversation.length === 0
      ? "No prior planning conversation."
      : input.priorConversation
          .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
          .join("\n\n");

  return [
    "You are planning a report-generation workflow.",
    "Decide whether the brief and uploaded sources are clear enough to draft the report structure.",
    "If the request is unclear, ask only the minimum clarification questions needed.",
    "If the request is clear, return a concrete report outline with section titles, summaries, and 2-3 guidance bullets per section.",
    "Do not ask for clarification if the decision can be made from the prompt and provided sources.",
    "Keep assistantMessage user-facing and concise.",
    "",
    `Report title: ${input.title}`,
    `Current brief: ${input.brief}`,
    `Attached file references: ${input.fileRefs.join(", ") || "none"}`,
    "",
    "Uploaded source document excerpts:",
    buildDocumentContext(input.documents),
    "",
    "Prior planning conversation:",
    conversationText,
    "",
    "Return JSON only.",
  ].join("\n");
}

function buildSectionPrompt(input: {
  readonly plan: ReportPlan;
  readonly section: ReportPlanSection;
  readonly dependencyContent: ReadonlyArray<{ readonly title: string; readonly content: string }>;
}): string {
  const documents = input.plan.globalSourceConfig.userDocuments.documents;
  const guidance =
    input.section.contentGuidance.length > 0
      ? input.section.contentGuidance.map((g) => `- ${g}`).join("\n")
      : "- Ground the section in the uploaded source material.";
  const mustNotDo =
    input.section.mustNotDo.length > 0
      ? input.section.mustNotDo.map((r) => `- ${r}`).join("\n")
      : "- Do not introduce unsupported claims.";

  const lines = [
    "You are a sub-agent writing one section of a larger report.",
    "Write clean markdown for this section only — start directly with the section heading.",
    "Ground claims in the provided source material. Explicitly note uncertainty when source coverage is weak.",
    "Do not mention that you are an AI model.",
    "Do not write any other section.",
    "",
    `Report title: ${input.plan.metadata.title}`,
    `Report brief: ${input.plan.metadata.brief}`,
    `Audience: ${input.plan.metadata.audience}`,
    `Tone: ${input.plan.metadata.tone}`,
    "",
    `Section to write: ${input.section.title}`,
    `Purpose: ${input.section.purpose}`,
    `Target length: ${input.section.lengthTarget.minWords}-${input.section.lengthTarget.maxWords} words`,
    "",
    "Content guidance:",
    guidance,
    "",
    "Must not do:",
    mustNotDo,
  ];

  if (input.dependencyContent.length > 0) {
    lines.push(
      "",
      "Previously written sections (use these as context — do NOT repeat their content):",
    );
    for (const dep of input.dependencyContent) {
      lines.push("", `--- ${dep.title} ---`, dep.content.trim());
    }
  }

  lines.push("", "Source materials:", buildDocumentContext(documents));

  return lines.join("\n");
}

function buildSectionFallbackContent(section: ReportPlanSection): string {
  const lines = [`## ${section.title}`, "", section.purpose, ""];
  for (const guidance of section.contentGuidance) {
    lines.push(`- ${guidance}`);
  }
  return lines.join("\n").trim();
}

function isOpenAiModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.startsWith("gpt") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  );
}

function isGeminiModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith("gemini");
}

function resolveModelTarget(input: {
  readonly apiKeys: ProviderApiKeys;
  readonly requestedModel: string | null;
}): ReportAgentModelTarget | null {
  const requestedModel = input.requestedModel?.trim() ?? null;
  const hasOpenAi = input.apiKeys.openai.trim().length > 0;
  const hasGemini = input.apiKeys.gemini.trim().length > 0;

  if (requestedModel && isGeminiModel(requestedModel) && hasGemini) {
    return { backend: "gemini", model: requestedModel };
  }

  if (requestedModel && isOpenAiModel(requestedModel) && hasOpenAi) {
    return { backend: "openai", model: requestedModel };
  }

  if (hasOpenAi) {
    return {
      backend: "openai",
      model: requestedModel && !isGeminiModel(requestedModel) ? requestedModel : "gpt-5.4",
    };
  }

  if (hasGemini) {
    return {
      backend: "gemini",
      model:
        requestedModel && !isOpenAiModel(requestedModel)
          ? requestedModel
          : "gemini-3-flash-preview",
    };
  }

  return null;
}

function parseJsonResponse<T>(raw: string): T | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
    if (!fenced?.[1]) {
      return null;
    }

    try {
      return JSON.parse(fenced[1]) as T;
    } catch {
      return null;
    }
  }
}

async function generateJsonWithOpenAi<T>(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: string;
  readonly schemaName: string;
  readonly schema: Record<string, unknown>;
}): Promise<T | null> {
  const client = new OpenAI({ apiKey: input.apiKey });
  const response = await client.responses.create({
    model: input.model,
    input: input.prompt,
    text: {
      format: {
        type: "json_schema",
        name: input.schemaName,
        schema: input.schema,
      },
    } as never,
  });
  return parseJsonResponse<T>(response.output_text ?? "");
}

async function generateJsonWithGemini<T>(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: string;
  readonly schema: Record<string, unknown>;
}): Promise<T | null> {
  const client = new GoogleGenAI({ apiKey: input.apiKey });
  const response = await client.models.generateContent({
    model: input.model,
    contents: input.prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: input.schema,
    } as never,
  });
  return parseJsonResponse<T>(response.text ?? "");
}

async function generateTextWithOpenAi(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: string;
}): Promise<string> {
  const client = new OpenAI({ apiKey: input.apiKey });
  const response = await client.responses.create({
    model: input.model,
    input: input.prompt,
  });
  return response.output_text?.trim() ?? "";
}

async function generateTextWithGemini(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: string;
}): Promise<string> {
  const client = new GoogleGenAI({ apiKey: input.apiKey });
  const response = await client.models.generateContent({
    model: input.model,
    contents: input.prompt,
  });
  return response.text?.trim() ?? "";
}

function sanitizePlanningDecision(
  decision: ReportPlanningDecision | null,
): ReportPlanningDecision | null {
  if (!decision) {
    return null;
  }

  const status = decision.status;
  if (status !== "clarification-needed" && status !== "awaiting-approval") {
    return null;
  }

  const assistantMessage = decision.assistantMessage.trim();
  if (assistantMessage.length === 0) {
    return null;
  }

  const questions = decision.questions
    .map((question) => question.trim())
    .filter((question) => question.length > 0)
    .slice(0, 4);
  const outline =
    decision.outline &&
    decision.outline.title.trim().length > 0 &&
    decision.outline.summary.trim().length > 0
      ? {
          title: decision.outline.title.trim(),
          summary: decision.outline.summary.trim(),
          sections: decision.outline.sections
            .map((section) => ({
              title: section.title.trim(),
              summary: section.summary.trim(),
              guidance: section.guidance
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0)
                .slice(0, 3),
            }))
            .filter((section) => section.title.length > 0 && section.summary.length > 0),
        }
      : null;

  if (status === "clarification-needed" && questions.length === 0) {
    return null;
  }

  if (status === "awaiting-approval" && (!outline || outline.sections.length === 0)) {
    return null;
  }

  return {
    status,
    assistantMessage,
    questions,
    audience: decision.audience?.trim() || null,
    tone: decision.tone?.trim() || null,
    outline,
  };
}

function buildSectionTreeFromDecision(
  sections: ReadonlyArray<ReportPlanningDecisionSection>,
  targetLength: ReportPlan["metadata"]["targetLength"],
): ReadonlyArray<ReportPlanSection> {
  const normalizedSections = sections.map((section) => ({
    ...section,
    title: section.title.trim(),
    summary: section.summary.trim(),
    guidance: section.guidance
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(0, 3),
  }));

  const summaryIndex = normalizedSections.findIndex((section) =>
    EXECUTIVE_SUMMARY_PATTERNS.some((pattern) => section.title.toLowerCase().includes(pattern)),
  );

  // Pre-compute stable IDs once so the summary's dependsOn list references
  // the exact same IDs that are assigned to the content sections.
  // Deduplicate slugs to avoid two sections sharing the same ID.
  const usedIds = new Set<string>();
  const sectionIds = normalizedSections.map((section) => {
    const base = slugifySectionId(section.title);
    if (!base) {
      return `section-${crypto.randomUUID()}`;
    }
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    let counter = 2;
    let candidate = `${base}-${counter}`;
    while (usedIds.has(candidate)) {
      counter++;
      candidate = `${base}-${counter}`;
    }
    usedIds.add(candidate);
    return candidate;
  });

  // IDs of every section that is NOT the executive summary.
  const contentSectionIds = sectionIds.filter((_, i) => i !== summaryIndex);

  const contentSectionCount = Math.max(normalizedSections.length - (summaryIndex >= 0 ? 1 : 0), 1);
  const summaryMinWords = Math.min(400, Math.max(200, Math.round(targetLength.minWords * 0.15)));
  const summaryMaxWords = Math.min(650, Math.max(300, Math.round(targetLength.maxWords * 0.18)));
  const contentMinWords = Math.max(
    180,
    Math.floor(
      (targetLength.minWords - (summaryIndex >= 0 ? summaryMinWords : 0)) / contentSectionCount,
    ),
  );
  const contentMaxWords = Math.max(
    260,
    Math.floor(
      (targetLength.maxWords - (summaryIndex >= 0 ? summaryMaxWords : 0)) / contentSectionCount,
    ),
  );

  // Content sections are independent of each other — they all draw from the
  // same source material and don't need another section's prose to be written.
  // Setting dependsOn=[] lets the orchestrator generate them in parallel.
  //
  // The executive summary depends on ALL content sections and is always the
  // last section generated. This is cycle-proof by construction: the DAG is
  // a simple star — content sections are roots, summary is the single leaf.
  let contentOrderCounter = 0;

  return normalizedSections.map((section, index) => {
    const isSummary = index === summaryIndex;
    const dependsOn: ReadonlyArray<string> = isSummary ? contentSectionIds : [];

    if (!isSummary) {
      contentOrderCounter++;
    }
    const generationOrder: number | "last" = isSummary ? "last" : contentOrderCounter;

    return {
      id: sectionIds[index]!,
      title: section.title,
      depth: 0,
      purpose: section.summary,
      contentGuidance:
        section.guidance.length > 0
          ? [...section.guidance]
          : ["Ground the section in the uploaded source material."],
      mustNotDo: ["Do not introduce unsupported claims."],
      lengthTarget: {
        minWords: isSummary ? summaryMinWords : contentMinWords,
        maxWords: isSummary ? summaryMaxWords : contentMaxWords,
      },
      sourceOverride: null,
      dependsOn,
      generationOrder,
      children: [],
    } satisfies ReportPlanSection;
  });
}

function buildPlanningOutlineFromDecision(
  outline: NonNullable<ReportPlanningDecision["outline"]>,
): ReportPlanningOutline {
  return {
    title: outline.title,
    summary: outline.summary,
    sections: outline.sections.map((section) => ({
      id: slugifySectionId(section.title) || `section-${crypto.randomUUID()}`,
      title: section.title,
      summary: section.summary,
    })),
  };
}

function buildFallbackReportContent(plan: ReportPlan): string {
  const documents = plan.globalSourceConfig.userDocuments.documents;
  const lines = [`# ${plan.metadata.title}`, "", plan.metadata.brief, ""];

  if (documents.length > 0) {
    lines.push("## Source Overview", "");
    for (const document of documents) {
      lines.push(
        `- ${document.name}: ${document.textContent ? "content reviewed" : "name available only"}`,
      );
    }
    lines.push("");
  }

  for (const section of plan.sectionTree) {
    lines.push(`## ${section.title}`, "");
    lines.push(section.purpose);
    lines.push("");
    if (section.contentGuidance.length > 0) {
      for (const guidance of section.contentGuidance) {
        lines.push(`- ${guidance}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

export async function maybePlanReportWithAgent(input: {
  readonly apiKeys: ProviderApiKeys;
  readonly plan: ReportPlan;
  readonly brief: string;
  readonly fileRefs: ReadonlyArray<string>;
  readonly documents: ReadonlyArray<ReportSourceDocument>;
  readonly priorConversation: ReadonlyArray<ReportPlanningMessage>;
}): Promise<ReportPlanningDecision | null> {
  const target = resolveModelTarget({
    apiKeys: input.apiKeys,
    requestedModel: input.plan.orchestration.modelSelection?.model ?? null,
  });
  if (!target) {
    return null;
  }

  const prompt = buildPlanningPrompt({
    title: input.plan.metadata.title,
    brief: input.brief,
    fileRefs: normalizeReportFileRefs(input.fileRefs),
    documents: normalizeDocuments(input.documents),
    priorConversation: input.priorConversation,
  });

  try {
    const rawDecision =
      target.backend === "openai"
        ? await generateJsonWithOpenAi<ReportPlanningDecision>({
            apiKey: input.apiKeys.openai,
            model: target.model,
            prompt,
            schemaName: "report_planning",
            schema: REPORT_PLANNING_SCHEMA,
          })
        : await generateJsonWithGemini<ReportPlanningDecision>({
            apiKey: input.apiKeys.gemini,
            model: target.model,
            prompt,
            schema: REPORT_PLANNING_SCHEMA,
          });
    return sanitizePlanningDecision(rawDecision);
  } catch {
    return null;
  }
}

export function applyPlanningDecision(input: {
  readonly plan: ReportPlan;
  readonly brief: string;
  readonly fileRefs: ReadonlyArray<string>;
  readonly documents: ReadonlyArray<ReportSourceDocument>;
  readonly createdAt: string;
  readonly decision: ReportPlanningDecision;
  readonly response: string | null;
}): ReportPlan {
  const documents = normalizeDocuments(input.documents);
  const fileRefs = normalizeReportFileRefs(input.fileRefs);
  const normalizedBrief =
    input.response && input.response.trim().length > 0
      ? appendClarificationToBrief(input.brief, input.response)
      : input.brief.trim();
  const conversationBase =
    input.response && input.response.trim().length > 0
      ? [
          ...input.plan.planning.conversation,
          makePlanningMessage({
            role: "user",
            text: input.response,
            createdAt: input.createdAt,
          }),
        ]
      : [];

  const sharedPlan: ReportPlan = {
    ...input.plan,
    status: "draft",
    metadata: {
      ...input.plan.metadata,
      brief: normalizedBrief,
      audience: input.decision.audience ?? input.plan.metadata.audience,
      tone: input.decision.tone ?? input.plan.metadata.tone,
    },
    globalSourceConfig: {
      ...input.plan.globalSourceConfig,
      userDocuments: {
        ...input.plan.globalSourceConfig.userDocuments,
        fileRefs,
        documents,
      },
    },
  };

  if (input.decision.status === "clarification-needed") {
    return {
      ...sharedPlan,
      planning: {
        status: "clarification-needed",
        pendingQuestions: input.decision.questions.map((question, index) =>
          makePlanningQuestion(index, question),
        ),
        proposedOutline: null,
        lastOrchestratedAt: input.createdAt,
        conversation: [
          ...conversationBase,
          makePlanningMessage({
            role: "assistant",
            text: input.decision.assistantMessage,
            createdAt: input.createdAt,
          }),
        ],
      },
    };
  }

  const outline = input.decision.outline;
  if (!outline || outline.sections.length === 0) {
    return sharedPlan;
  }

  return {
    ...sharedPlan,
    sectionTree: buildSectionTreeFromDecision(outline.sections, sharedPlan.metadata.targetLength),
    planning: {
      status: "awaiting-approval",
      pendingQuestions: [],
      proposedOutline: buildPlanningOutlineFromDecision(outline),
      lastOrchestratedAt: input.createdAt,
      conversation: [
        ...conversationBase,
        makePlanningMessage({
          role: "assistant",
          text: input.decision.assistantMessage,
          createdAt: input.createdAt,
        }),
      ],
    },
  };
}

export async function generateReportExecution(input: {
  readonly apiKeys: ProviderApiKeys;
  readonly plan: ReportPlan;
  readonly runId: ReportExecutionState["runId"];
  readonly startedAt: string;
}): Promise<{
  readonly latestRun: ReportExecutionState;
  readonly reportStatus: "completed" | "failed";
}> {
  const orderedSections = sortReportSectionsForExecution(input.plan.sectionTree);
  // Build a map from sectionId → full ReportSectionNode so sub-agents have all metadata
  const fullSectionMap = new Map<string, ReportPlanSection>();
  const walkTree = (nodes: ReadonlyArray<ReportPlanSection>) => {
    for (const node of nodes) {
      fullSectionMap.set(node.id, node);
      if (node.children.length > 0) {
        walkTree(node.children);
      }
    }
  };
  walkTree(input.plan.sectionTree);
  const target = resolveModelTarget({
    apiKeys: input.apiKeys,
    requestedModel: input.plan.orchestration.modelSelection?.model ?? null,
  });

  // Map from sectionId → { content, failed }
  const sectionResults = new Map<string, { content: string; failed: boolean }>();

  // Track sectionRun state mutations
  const sectionRunMap = new Map<string, ReportSectionRun>();
  const executionLog: Array<ReportExecutionState["executionLog"][number]> = [
    {
      at: input.startedAt,
      kind: "run.started",
      message: `Starting per-section orchestration for ${orderedSections.length} sections.`,
      payload: {
        reportTitle: input.plan.metadata.title,
        modelSelection: input.plan.orchestration.modelSelection,
        sectionCount: orderedSections.length,
        usingLlm: target !== null,
      },
    },
  ];

  // Build initial sectionRun entries
  for (const [index, section] of orderedSections.entries()) {
    sectionRunMap.set(section.id, {
      sectionId: section.id,
      title: section.title,
      depth: section.depth,
      dependsOn: [...section.dependsOn],
      order: index + 1,
      status: section.dependsOn.length === 0 ? "ready" : "blocked",
      retryCount: 0,
      lastError: null,
    });
  }

  // Process sections in topological waves: collect all sections whose deps
  // are already done, run them in parallel, then repeat.
  const completed = new Set<string>();
  const remaining = new Set(orderedSections.map((s) => s.id));

  while (remaining.size > 0) {
    // Find all sections whose every dependency is completed
    const wave = orderedSections.filter(
      (s) => remaining.has(s.id) && s.dependsOn.every((depId) => completed.has(depId)),
    );

    if (wave.length === 0) {
      // Cycle guard — should never happen after topological sort validates the plan
      break;
    }

    // Mark the whole wave as running
    const waveStartAt = new Date().toISOString();
    for (const flatSection of wave) {
      const run = sectionRunMap.get(flatSection.id)!;
      sectionRunMap.set(flatSection.id, { ...run, status: "running" });
      executionLog.push({
        at: waveStartAt,
        kind: "section.started",
        message: `Starting section: "${flatSection.title}"`,
        payload: { sectionId: flatSection.id, dependsOn: [...flatSection.dependsOn] },
      });
    }

    // Run all sections in this wave in parallel
    await Promise.all(
      wave.map(async (flatSection) => {
        const fullSection = fullSectionMap.get(flatSection.id);
        const dependencyContent = flatSection.dependsOn
          .map((depId) => {
            const result = sectionResults.get(depId);
            const depSection = orderedSections.find((s) => s.id === depId);
            return result && depSection
              ? { title: depSection.title, content: result.content }
              : null;
          })
          .filter((d): d is { title: string; content: string } => d !== null);

        let content = "";
        let failed = false;

        if (target && fullSection) {
          const prompt = buildSectionPrompt({
            plan: input.plan,
            section: fullSection,
            dependencyContent,
          });
          try {
            content =
              target.backend === "openai"
                ? await generateTextWithOpenAi({
                    apiKey: input.apiKeys.openai,
                    model: target.model,
                    prompt,
                  })
                : await generateTextWithGemini({
                    apiKey: input.apiKeys.gemini,
                    model: target.model,
                    prompt,
                  });
          } catch (err) {
            failed = true;
            content = fullSection
              ? buildSectionFallbackContent(fullSection)
              : `## ${flatSection.title}\n\n_Content generation failed._`;
            const failedAt = new Date().toISOString();
            const run = sectionRunMap.get(flatSection.id)!;
            sectionRunMap.set(flatSection.id, {
              ...run,
              status: "failed",
              lastError: err instanceof Error ? err.message : "Section generation failed.",
            });
            executionLog.push({
              at: failedAt,
              kind: "section.failed",
              message: `Section "${flatSection.title}" failed — using fallback content.`,
              payload: {
                sectionId: flatSection.id,
                error: err instanceof Error ? err.message : String(err),
              },
            });
          }
        } else {
          // No API key or missing full node — use static fallback content
          content = fullSection
            ? buildSectionFallbackContent(fullSection)
            : `## ${flatSection.title}\n\n_${flatSection.title}_`;
        }

        if (!failed) {
          const sectionCompletedAt = new Date().toISOString();
          const run = sectionRunMap.get(flatSection.id)!;
          sectionRunMap.set(flatSection.id, { ...run, status: "completed", lastError: null });
          executionLog.push({
            at: sectionCompletedAt,
            kind: "section.completed",
            message: `Completed section: "${flatSection.title}" (${target ? target.backend : "fallback"})`,
            payload: {
              sectionId: flatSection.id,
              wordCount: content.split(/\s+/).filter(Boolean).length,
            },
          });
        }

        sectionResults.set(flatSection.id, { content, failed });
      }),
    );

    // Mark the wave as done so dependents can be unlocked
    for (const flatSection of wave) {
      remaining.delete(flatSection.id);
      completed.add(flatSection.id);
    }
  }

  // Assemble the final report by joining sections in original topological order
  const finalContent = orderedSections
    .map((flatSection) => {
      const cached = sectionResults.get(flatSection.id)?.content;
      if (cached) return cached;
      const fullSection = fullSectionMap.get(flatSection.id);
      return fullSection
        ? buildSectionFallbackContent(fullSection)
        : `## ${flatSection.title}\n\n_Content unavailable._`;
    })
    .join("\n\n");

  const anyFailed = [...sectionResults.values()].some((r) => r.failed);
  const completedAt = new Date().toISOString();

  executionLog.push({
    at: completedAt,
    kind: "run.completed",
    message: anyFailed
      ? `Report assembled with ${sectionResults.size} sections (${[...sectionResults.values()].filter((r) => r.failed).length} used fallback content).`
      : `Report assembled from ${sectionResults.size} independently generated sections.`,
    payload: {
      backend: target?.backend ?? "fallback",
      sectionCount: sectionResults.size,
      failedSections: [...sectionResults.entries()]
        .filter(([, r]) => r.failed)
        .map(([id]) => id),
    },
  });

  return {
    reportStatus: "completed",
    latestRun: {
      runId: input.runId,
      status: "completed",
      sectionRuns: orderedSections.map((s) => sectionRunMap.get(s.id)!),
      executionLog,
      startedAt: input.startedAt,
      updatedAt: completedAt,
      completedAt,
      finalArtifact: {
        format: pickPrimaryOutputFormat(input.plan.metadata.outputFormats),
        content: finalContent,
      },
    },
  };
}

function pickPrimaryOutputFormat(
  outputFormats: ReadonlyArray<ReportOutputFormat>,
): ReportOutputFormat {
  return outputFormats[0] ?? "markdown";
}
