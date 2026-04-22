import type {
  ProviderApiKeys,
  ReportCitation,
  ReportExecutionState,
  ReportOutputFormat,
  ReportPlan,
  ReportPlanningMessage,
  ReportPlanningOutline,
  ReportPlanningQuestion,
  ReportSectionRun,
  ReportSourceDocument,
} from "@t3tools/contracts";
import {
  buildReportDocumentContextForLlm,
  buildReportDocumentInventoryForLlm,
  listReportDocumentsForLlm,
  listReportTablesForLlm,
  normalizeReportFileRefs,
  normalizeReportSourceDocuments,
  readReportDocumentForLlm,
  readReportTableForLlm,
  searchReportDocumentsForLlm,
} from "@t3tools/shared/report";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

import { flattenReportSections, sortReportSectionsForExecution } from "./planGraph.ts";

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

const EXECUTIVE_SUMMARY_PATTERNS = [
  "executive summary",
  "summary",
  "key takeaways",
  "decision summary",
] as const;

// ---------------------------------------------------------------------------
// Offline document tools — used by section-writing agents to inspect uploaded
// source text without stuffing every document into every section prompt.
// ---------------------------------------------------------------------------

const LIST_DOCUMENTS_TOOL_SPEC = {
  name: "list_documents" as const,
  description:
    "List uploaded source documents and their extracted-text availability. Use this first when you need to inspect what evidence sources are available.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
} as const;

const SEARCH_DOCUMENTS_TOOL_SPEC = {
  name: "search_documents" as const,
  description:
    "Search through uploaded source documents for relevant content. Returns matching lines with " +
    "surrounding context, like grep -C N. Use this before writing to locate specific facts, " +
    "figures, dates, statistics, quotes, or terminology. Multiple calls are allowed — search " +
    "for different terms as needed.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description:
          "Keyword, phrase, or term to search for. Matched case-insensitively as a literal string across all source documents.",
      },
      context_lines: {
        type: "number",
        description: "Lines of context to include around each match (1–20, default 5).",
      },
    },
  },
} as const;

const READ_DOCUMENT_TOOL_SPEC = {
  name: "read_document" as const,
  description:
    "Read extracted text from a specific uploaded document. Supports optional 1-based line ranges. Use after list_documents or search_documents when you need broader context.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["document_name"],
    properties: {
      document_name: {
        type: "string",
        description:
          "Document name or 1-based document number from list_documents, for example 'annual-report.pdf' or '1'.",
      },
      start_line: {
        type: "number",
        description: "Optional 1-based first line to read.",
      },
      end_line: {
        type: "number",
        description: "Optional 1-based last line to read.",
      },
      max_chars: {
        type: "number",
        description: "Maximum characters to return, clamped between 1,000 and 30,000.",
      },
    },
  },
} as const;

const LIST_TABLES_TOOL_SPEC = {
  name: "list_tables" as const,
  description:
    "List extracted table-like sources available to the report agent. Current support is limited to CSV/TSV documents stored as text; PDF table extraction will be added later.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
} as const;

const READ_TABLE_TOOL_SPEC = {
  name: "read_table" as const,
  description:
    "Read a table-like source as rows. Current support is limited to CSV/TSV documents stored as text.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["document_name"],
    properties: {
      document_name: {
        type: "string",
        description:
          "CSV/TSV document name or 1-based document number from list_documents, for example 'financials.csv' or '2'.",
      },
      table_index: {
        type: "number",
        description: "Table index to read. Current CSV/TSV support exposes one table per source.",
      },
      max_rows: {
        type: "number",
        description: "Maximum rows to return, clamped between 1 and 500.",
      },
    },
  },
} as const;

const REPORT_DOCUMENT_TOOL_SPECS = [
  LIST_DOCUMENTS_TOOL_SPEC,
  SEARCH_DOCUMENTS_TOOL_SPEC,
  READ_DOCUMENT_TOOL_SPEC,
  LIST_TABLES_TOOL_SPEC,
  READ_TABLE_TOOL_SPEC,
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
        title: {
          type: "string",
          description:
            "Final report title. Include the company/entity and fiscal period when the brief, filenames, or source text provide one, for example 'Q4 2026 Tata Motors Earnings Report'.",
        },
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
    "Set outline.title to the final report title, not a generic structure label.",
    "For financial reports, include the reporting period when it is present in the brief, filenames, document names, or source text.",
    "Prefer compact fiscal-period labels like 'Q1 2026', 'Q4 FY2025', or 'FY2026'. Do not invent a period when the sources do not provide one.",
    "Preserve the main company, entity, fund, or business unit in the title when it can be inferred from filenames or source content.",
    "Good title examples: 'Q4 2026 Tata Motors Earnings Report', 'FY2025 Group Financial Performance and Deleveraging', 'Q1 2026 Budget Variance Report'.",
    "",
    `Report title: ${input.title}`,
    `Current brief: ${input.brief}`,
    `Attached file references: ${input.fileRefs.join(", ") || "none"}`,
    "",
    "Uploaded source document excerpts:",
    buildReportDocumentContextForLlm(input.documents),
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
    "Ground claims in the source documents. Explicitly note uncertainty when coverage is weak.",
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
    `Target length: ${input.section.lengthTarget.minWords}–${input.section.lengthTarget.maxWords} words`,
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

  lines.push(
    "",
    "Available source documents:",
    buildReportDocumentInventoryForLlm(documents),
    "",
    "Research workflow — complete ALL steps before writing the section:",
    "Step 1 — Inventory: Call list_documents to see all available sources and their extraction status.",
    "Step 2 — Queries: Identify 3–5 targeted search queries based on the section purpose and guidance above.",
    "Step 3 — Evidence search: Call search_documents for each query. Look for relevant facts, figures, dates, statistics, quotes, and terminology.",
    "Step 4 — Deep read: For any passage where broader context is needed around a search hit, call read_document with the relevant line range.",
    "Step 5 — Tables: If CSV/TSV sources are listed, call list_tables then read_table for any tables relevant to this section.",
    "Step 6 — Write: Only after completing the research steps above, write the section content.",
    "",
    "Writing rules:",
    "- Ground every factual claim in evidence from the research phase.",
    "- Where sources do not cover a point, explicitly note the gap — do not speculate.",
    "- Do not begin writing the section body until at least 3 search_documents calls have been made.",
    "- CITATION RULE (mandatory): Every time you use a specific fact, figure, statistic, quote, or",
    "  finding from a source document, you MUST append a citation marker directly after the claim,",
    "  with NO space before it. Format: [cite:ExactDocumentName] where ExactDocumentName is the",
    "  exact name returned by list_documents (e.g. 'Revenue grew 23% [cite:Q3-Report.pdf]').",
    "- If a claim draws from multiple documents: [cite:FileA.pdf][cite:FileB.pdf]",
    "- Use the exact filename including extension as returned by list_documents. Do not invent names.",
    "- Do NOT cite general background statements — only cite specific sourced evidence.",
  );

  return lines.join("\n");
}

function buildSectionFallbackContent(section: ReportPlanSection): string {
  const lines = [`## ${section.title}`, "", section.purpose, ""];
  for (const guidance of section.contentGuidance) {
    lines.push(`- ${guidance}`);
  }
  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Agentic loop helpers
// ---------------------------------------------------------------------------

// These are the compile-time fallbacks only — the real values come from
// plan.orchestration.agentSwarm at runtime so the user can tune them.
const DEFAULT_MAX_SECTION_RETRIES = 3;
const DEFAULT_MAX_TOOL_CALLS_PER_SECTION = 15;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function buildRevisionPrompt(input: {
  readonly plan: ReportPlan;
  readonly section: ReportPlanSection;
  readonly dependencyContent: ReadonlyArray<{ readonly title: string; readonly content: string }>;
  readonly previousDraft: string;
  readonly wordCount: number;
  readonly attempt: number;
}): string {
  const { minWords, maxWords } = input.section.lengthTarget;
  const isTooShort = input.wordCount < minWords;
  const delta = isTooShort ? minWords - input.wordCount : input.wordCount - maxWords;

  const lines = [
    `You are revising a section of a report. This is revision attempt ${input.attempt}.`,
    `The previous draft did not meet the word-count requirement.`,
    "",
    `Section: ${input.section.title}`,
    `Target: ${minWords}–${maxWords} words`,
    `Previous draft: ${input.wordCount} words (${isTooShort ? `too short — add ~${delta} more words` : `too long — remove ~${delta} words`})`,
    "",
    isTooShort
      ? `Add depth, evidence, and analysis to reach at least ${minWords} words. Do not pad with filler sentences.`
      : `Tighten the prose to stay under ${maxWords} words. Remove redundancy but keep every key insight.`,
    "",
    `Report title: ${input.plan.metadata.title}`,
    `Audience: ${input.plan.metadata.audience}`,
    `Tone: ${input.plan.metadata.tone}`,
    "",
    "Previous draft to revise:",
    input.previousDraft,
  ];

  if (input.dependencyContent.length > 0) {
    lines.push("", "Context from other sections (do not repeat their content):");
    for (const dep of input.dependencyContent) {
      lines.push("", `--- ${dep.title} ---`, dep.content.trim());
    }
  }

  lines.push(
    "",
    "Available source documents:",
    buildReportDocumentInventoryForLlm(input.plan.globalSourceConfig.userDocuments.documents),
    "",
    isTooShort
      ? "If additional evidence is needed to reach the target length, call search_documents for any gaps identified during the initial draft, then read_document for broader context. Expand with depth and substance — do not pad with filler."
      : "Tighten the prose to stay under the word limit. Remove the weakest and most redundant passages while keeping every key insight.",
    "Return only the revised section content, starting with the section heading.",
  );

  return lines.join("\n");
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
      model: requestedModel && !isOpenAiModel(requestedModel) ? requestedModel : "gemini-2.5-flash",
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

function enabledReportDocumentToolSpecs(enabledTools: ReadonlySet<string>) {
  return REPORT_DOCUMENT_TOOL_SPECS.filter((tool) => enabledTools.has(tool.name));
}

function executeReportDocumentTool(input: {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly documents: ReadonlyArray<ReportSourceDocument>;
}): string {
  switch (input.toolName) {
    case LIST_DOCUMENTS_TOOL_SPEC.name:
      return listReportDocumentsForLlm(input.documents);
    case SEARCH_DOCUMENTS_TOOL_SPEC.name:
      return searchReportDocumentsForLlm({
        documents: input.documents,
        query: (input.args["query"] as string | undefined) ?? "",
        contextLines: (input.args["context_lines"] as number | undefined) ?? 5,
      });
    case READ_DOCUMENT_TOOL_SPEC.name:
      return readReportDocumentForLlm({
        documents: input.documents,
        documentName: (input.args["document_name"] as string | undefined) ?? "",
        ...(input.args["start_line"] !== undefined
          ? { startLine: input.args["start_line"] as number }
          : {}),
        ...(input.args["end_line"] !== undefined
          ? { endLine: input.args["end_line"] as number }
          : {}),
        ...(input.args["max_chars"] !== undefined
          ? { maxChars: input.args["max_chars"] as number }
          : {}),
      });
    case LIST_TABLES_TOOL_SPEC.name:
      return listReportTablesForLlm(input.documents);
    case READ_TABLE_TOOL_SPEC.name:
      return readReportTableForLlm({
        documents: input.documents,
        documentName: (input.args["document_name"] as string | undefined) ?? "",
        ...(input.args["table_index"] !== undefined
          ? { tableIndex: input.args["table_index"] as number }
          : {}),
        ...(input.args["max_rows"] !== undefined
          ? { maxRows: input.args["max_rows"] as number }
          : {}),
      });
    default:
      return `Error: unknown report document tool "${input.toolName}".`;
  }
}

/**
 * OpenAI Responses-API agent loop with offline document tools.
 * Runs until the model produces a final text response or maxToolCalls is reached.
 */
async function runSectionAgentWithOpenAi(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: string;
  readonly documents: ReadonlyArray<ReportSourceDocument>;
  readonly enabledTools: ReadonlySet<string>;
  readonly maxToolCalls: number;
}): Promise<string> {
  const client = new OpenAI({ apiKey: input.apiKey });

  // Conversation history as plain objects — cast to `never` where the SDK
  // types are too narrow for the Responses API multi-turn format.
  const inputItems: Array<Record<string, unknown>> = [{ role: "user", content: input.prompt }];

  const tools = enabledReportDocumentToolSpecs(input.enabledTools).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  let toolCallCount = 0;

  for (;;) {
    const response = await client.responses.create({
      model: input.model,
      input: inputItems as never,
      ...(tools.length > 0 ? { tools: tools as never } : {}),
    });

    const outputItems = (response.output ?? []) as unknown as Array<Record<string, unknown>>;
    const functionCalls = outputItems.filter((item) => item["type"] === "function_call");

    // No tool calls (or budget exhausted) → final answer
    if (functionCalls.length === 0 || toolCallCount >= input.maxToolCalls) {
      return response.output_text?.trim() ?? "";
    }

    // Append the assistant's output turn to conversation history
    inputItems.push(...outputItems);

    // Execute each function call and append results
    for (const fc of functionCalls) {
      toolCallCount++;
      let result: string;
      try {
        const args = JSON.parse((fc["arguments"] as string | undefined) ?? "{}") as Record<
          string,
          unknown
        >;
        result = executeReportDocumentTool({
          toolName: (fc["name"] as string | undefined) ?? "",
          args,
          documents: input.documents,
        });
      } catch {
        result = "Error: could not parse report document tool arguments.";
      }
      inputItems.push({
        type: "function_call_output",
        call_id: fc["call_id"] as string,
        output: result,
      });
    }
  }
}

/**
 * Google GenAI agent loop with offline document tools via function declarations.
 */
async function runSectionAgentWithGemini(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: string;
  readonly documents: ReadonlyArray<ReportSourceDocument>;
  readonly enabledTools: ReadonlySet<string>;
  readonly maxToolCalls: number;
}): Promise<string> {
  const client = new GoogleGenAI({ apiKey: input.apiKey });

  const enabledTools = enabledReportDocumentToolSpecs(input.enabledTools);
  const tools =
    enabledTools.length > 0
      ? [
          {
            functionDeclarations: enabledTools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          },
        ]
      : [];

  // Gemini multi-turn content history
  const contents: Array<Record<string, unknown>> = [
    { role: "user", parts: [{ text: input.prompt }] },
  ];

  let toolCallCount = 0;

  for (;;) {
    const response = await client.models.generateContent({
      model: input.model,
      contents: contents as never,
      ...(tools.length > 0 ? { config: { tools: tools as never } } : {}),
    });

    const parts = (response.candidates?.[0]?.content?.parts ?? []) as Array<
      Record<string, unknown>
    >;
    const functionCalls = parts.filter((p) => p["functionCall"] != null);

    // No tool calls (or budget exhausted) → final answer
    if (functionCalls.length === 0 || toolCallCount >= input.maxToolCalls) {
      return response.text?.trim() ?? "";
    }

    // Append model turn
    contents.push({ role: "model", parts });

    // Execute function calls and send results back as a user turn
    const responseParts: Array<Record<string, unknown>> = [];
    for (const part of functionCalls) {
      toolCallCount++;
      const fc = part["functionCall"] as { name: string; args: Record<string, unknown> };
      let result: string;
      try {
        result = executeReportDocumentTool({
          toolName: fc.name,
          args: fc.args,
          documents: input.documents,
        });
      } catch {
        result = "Error: could not execute report document tool.";
      }
      responseParts.push({
        functionResponse: { name: fc.name, response: { result } },
      });
    }
    contents.push({ role: "user", parts: responseParts });
  }
}

/**
 * Unified dispatcher: picks the right agent backend and runs the tool loop.
 */
async function runSectionAgentWithTarget(input: {
  readonly target: ReportAgentModelTarget;
  readonly apiKeys: ProviderApiKeys;
  readonly prompt: string;
  readonly documents: ReadonlyArray<ReportSourceDocument>;
  readonly enabledTools: ReadonlySet<string>;
  readonly maxToolCalls: number;
}): Promise<string> {
  return input.target.backend === "openai"
    ? runSectionAgentWithOpenAi({
        apiKey: input.apiKeys.openai,
        model: input.target.model,
        prompt: input.prompt,
        documents: input.documents,
        enabledTools: input.enabledTools,
        maxToolCalls: input.maxToolCalls,
      })
    : runSectionAgentWithGemini({
        apiKey: input.apiKeys.gemini,
        model: input.target.model,
        prompt: input.prompt,
        documents: input.documents,
        enabledTools: input.enabledTools,
        maxToolCalls: input.maxToolCalls,
      });
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
      keyPoints: section.guidance ?? [],
      wordTarget: null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Post-generation AI chat — dedicated multi-turn runners
// ---------------------------------------------------------------------------
//
// These runners differ from the section-writing runners in two important ways:
//
// 1. CONVERSATION HISTORY: Prior messages are passed as proper alternating
//    user/assistant turns in the messages array, not as formatted text. This
//    is what gives the model actual memory of the conversation.
//
// 2. CACHING: The large static content (system instructions + full report) is
//    placed in the *instructions* field (OpenAI) or *systemInstruction* config
//    (Gemini). This content is identical every turn for the same report, so:
//    - OpenAI: automatic prefix caching kicks in for prompts ≥1024 tokens
//      (up to 90% cost reduction on those tokens, up to 24h retention)
//    - Gemini 2.5+: implicit caching activates on the common prefix
//    The dynamic conversation turns are appended *after*, so the static
//    prefix hash never changes between turns.
//

type ChatMessage = { role: "user" | "assistant"; text: string };

async function runChatAgentWithOpenAi(input: {
  readonly apiKey: string;
  readonly model: string;
  /** Static content placed in `instructions` — identical every turn → cached. */
  readonly systemInstruction: string;
  /** Prior conversation turns as actual messages, not formatted text. */
  readonly priorMessages: ReadonlyArray<ChatMessage>;
  readonly userMessage: string;
  readonly documents: ReadonlyArray<ReportSourceDocument>;
  readonly enabledTools: ReadonlySet<string>;
  readonly maxToolCalls: number;
  /**
   * Stable identifier for the report being discussed.
   * Used as `prompt_cache_key` to route all chat turns for the same report to
   * the same GPU, improving cache hit rates across sessions.
   */
  readonly reportId: string;
}): Promise<string> {
  const client = new OpenAI({ apiKey: input.apiKey });

  const tools = enabledReportDocumentToolSpecs(input.enabledTools).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  // Seed conversation with prior turns as proper user/assistant messages,
  // then append the current user message. The static system content lives in
  // `instructions` (a separate field), so the input prefix stays stable.
  const inputItems: Array<Record<string, unknown>> = [
    ...input.priorMessages.map((m) => ({ role: m.role, content: m.text })),
    { role: "user", content: input.userMessage },
  ];

  let toolCallCount = 0;

  for (;;) {
    const response = await client.responses.create({
      model: input.model,
      instructions: input.systemInstruction,
      input: inputItems as never,
      // prompt_cache_key routes all turns for the same report to the same GPU
      // so the cached system instruction + report prefix is always available.
      prompt_cache_key: input.reportId,
      // Keep the cache for 24 hours — users often return to the same report
      // across separate sessions and we want to avoid re-billing those tokens.
      prompt_cache_retention: "24h",
      ...(tools.length > 0 ? { tools: tools as never } : {}),
    } as never);

    const outputItems = (response.output ?? []) as unknown as Array<Record<string, unknown>>;
    const functionCalls = outputItems.filter((item) => item["type"] === "function_call");

    if (functionCalls.length === 0 || toolCallCount >= input.maxToolCalls) {
      return response.output_text?.trim() ?? "";
    }

    inputItems.push(...outputItems);

    for (const fc of functionCalls) {
      toolCallCount++;
      let result: string;
      try {
        const args = JSON.parse((fc["arguments"] as string | undefined) ?? "{}") as Record<
          string,
          unknown
        >;
        result = executeReportDocumentTool({
          toolName: (fc["name"] as string | undefined) ?? "",
          args,
          documents: input.documents,
        });
      } catch {
        result = "Error: could not parse report document tool arguments.";
      }
      inputItems.push({
        type: "function_call_output",
        call_id: fc["call_id"] as string,
        output: result,
      });
    }
  }
}

async function runChatAgentWithGemini(input: {
  readonly apiKey: string;
  readonly model: string;
  /** Static content placed in systemInstruction — identical every turn → cached. */
  readonly systemInstruction: string;
  /** Prior conversation turns as actual messages, not formatted text. */
  readonly priorMessages: ReadonlyArray<ChatMessage>;
  readonly userMessage: string;
  readonly documents: ReadonlyArray<ReportSourceDocument>;
  readonly enabledTools: ReadonlySet<string>;
  readonly maxToolCalls: number;
  /** Unused at runtime; kept for call-site symmetry with the OpenAI runner. */
  readonly reportId: string;
}): Promise<string> {
  const client = new GoogleGenAI({ apiKey: input.apiKey });

  const enabledTools = enabledReportDocumentToolSpecs(input.enabledTools);
  const tools =
    enabledTools.length > 0
      ? [
          {
            functionDeclarations: enabledTools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          },
        ]
      : [];

  // Prior messages as actual Gemini content turns (role "user"/"model"),
  // followed by the current user message.
  const contents: Array<Record<string, unknown>> = [
    ...input.priorMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text }],
    })),
    { role: "user", parts: [{ text: input.userMessage }] },
  ];

  let toolCallCount = 0;

  for (;;) {
    const response = await client.models.generateContent({
      model: input.model,
      contents: contents as never,
      config: {
        // systemInstruction is identical every turn → implicit cache hit on Gemini 2.5+
        systemInstruction: input.systemInstruction,
        ...(tools.length > 0 ? { tools: tools as never } : {}),
      } as never,
    });

    const parts = (response.candidates?.[0]?.content?.parts ?? []) as Array<
      Record<string, unknown>
    >;
    const functionCalls = parts.filter((p) => p["functionCall"] != null);

    if (functionCalls.length === 0 || toolCallCount >= input.maxToolCalls) {
      return response.text?.trim() ?? "";
    }

    contents.push({ role: "model", parts });

    const responseParts: Array<Record<string, unknown>> = [];
    for (const part of functionCalls) {
      toolCallCount++;
      const fc = part["functionCall"] as { name: string; args: Record<string, unknown> };
      let result: string;
      try {
        result = executeReportDocumentTool({
          toolName: fc.name,
          args: fc.args,
          documents: input.documents,
        });
      } catch {
        result = "Error: could not execute report document tool.";
      }
      responseParts.push({
        functionResponse: { name: fc.name, response: { result } },
      });
    }
    contents.push({ role: "user", parts: responseParts });
  }
}

/**
 * Sends a user message to the AI about a completed report and returns the
 * assistant's reply. Prior conversation turns are passed as proper multi-turn
 * messages (not as formatted text), giving the model real memory. The static
 * system prompt + report content is placed in a dedicated field so both
 * OpenAI and Gemini can cache it across turns.
 */
export async function runReportChatWithAgent(input: {
  readonly apiKeys: ProviderApiKeys;
  readonly reportId: string;
  readonly plan: ReportPlan;
  readonly reportContent: string;
  readonly priorConversation: ReadonlyArray<ReportPlanningMessage>;
  readonly userMessage: string;
}): Promise<string | null> {
  const target = resolveModelTarget({
    apiKeys: input.apiKeys,
    requestedModel: input.plan.orchestration.modelSelection?.model ?? null,
  });
  if (!target) {
    return null;
  }

  const documents = input.plan.globalSourceConfig.userDocuments.documents;
  const enabledTools = new Set(
    input.plan.orchestration.agentSwarm.enabledTools as ReadonlyArray<string>,
  );

  // Static system instruction — identical every turn for the same report.
  // Placing it here (not in the messages array) lets OpenAI and Gemini cache
  // it automatically: OpenAI prefix-caches prompts ≥1024 tokens; Gemini 2.5+
  // uses implicit caching on common prefixes.
  const systemInstruction = [
    "You are an expert AI assistant helping a user review, refine, and discuss a completed report.",
    "You have access to the original source documents via the document tools — use them to look up",
    "specific facts or passages when the user asks questions grounded in the source material.",
    "Answer questions, suggest revisions, summarise sections, or discuss findings as the user requests.",
    "Be concise. Do not mention that you are an AI model.",
    "",
    `Report title: ${input.plan.metadata.title}`,
    `Audience: ${input.plan.metadata.audience}`,
    `Tone: ${input.plan.metadata.tone}`,
    "",
    "── FULL REPORT CONTENT ──",
    input.reportContent.trim(),
    "",
    "── AVAILABLE SOURCE DOCUMENTS ──",
    buildReportDocumentInventoryForLlm(documents),
  ].join("\n");

  // Prior conversation as proper ChatMessage turns — not formatted text.
  // The model will see these as actual conversation history, giving it
  // real memory of what was discussed in earlier turns.
  const priorMessages: ChatMessage[] = input.priorConversation
    .filter((m): m is ReportPlanningMessage & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant",
    )
    .map((m) => ({ role: m.role, text: m.text }));

  try {
    if (target.backend === "openai") {
      return await runChatAgentWithOpenAi({
        apiKey: input.apiKeys.openai,
        model: target.model,
        systemInstruction,
        priorMessages,
        userMessage: input.userMessage,
        documents,
        enabledTools,
        maxToolCalls: input.plan.orchestration.agentSwarm.maxToolCallsPerSection,
        reportId: input.reportId,
      });
    } else {
      return await runChatAgentWithGemini({
        apiKey: input.apiKeys.gemini,
        model: target.model,
        systemInstruction,
        priorMessages,
        userMessage: input.userMessage,
        documents,
        enabledTools,
        maxToolCalls: input.plan.orchestration.agentSwarm.maxToolCallsPerSection,
        reportId: input.reportId,
      });
    }
  } catch {
    return null;
  }
}

export async function maybePlanReportWithAgent(input: {
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
    documents: normalizeReportSourceDocuments(input.documents),
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
  const documents = normalizeReportSourceDocuments(input.documents);
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

// ---------------------------------------------------------------------------
// Final editor pass
// ---------------------------------------------------------------------------

function buildFinalEditorPrompt(input: {
  readonly plan: ReportPlan;
  readonly presentationSections: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly sectionContents: ReadonlyMap<string, string>;
}): string {
  const lines = [
    "You are the final editor assembling a multi-section report.",
    "The section drafts were written independently by separate sub-agents. Your job is to produce the finished, cohesive report.",
    "",
    "Editorial rules:",
    "1. Preserve the approved section order listed below. Do not reorder, add, or remove sections.",
    "2. Fix transitions so adjacent sections flow naturally into each other.",
    "3. Eliminate verbatim repetition of the same facts, statistics, or phrases across sections.",
    "4. If an Executive Summary is present, verify it accurately summarises the key claims in the body.",
    "   Rewrite the Executive Summary if it diverges from the body — do not change the body sections.",
    "5. Standardise terminology and tone throughout the report.",
    "6. Do NOT invent new facts, statistics, or claims not present in the drafts.",
    "7. Return the complete report as clean markdown, opening with the report title as a level-1 heading.",
    "8. CRITICAL: Preserve every [cite:filename] marker EXACTLY as written — do NOT remove, reword,",
    "   reformat, merge, or move them. They are structured citation anchors, not decorative text.",
    "   Example of correct preservation: '...grew 23% [cite:Q3-Report.pdf] driven by...'",
    "",
    `Report title: ${input.plan.metadata.title}`,
    `Audience: ${input.plan.metadata.audience}`,
    `Tone: ${input.plan.metadata.tone}`,
    "",
    "Approved section order:",
    input.presentationSections.map((s, i) => `${i + 1}. ${s.title}`).join("\n"),
    "",
    "Section drafts:",
  ];

  for (const section of input.presentationSections) {
    const content =
      input.sectionContents.get(section.id) ?? `## ${section.title}\n\n_Content unavailable._`;
    lines.push("", `--- ${section.title} ---`, content.trim());
  }

  lines.push("", "Return the complete polished report as markdown starting with '# Report Title'.");

  return lines.join("\n");
}

/**
 * Runs a single orchestrator-model pass over all generated sections to produce
 * a cohesive, polished final report. No tools are used — this is a pure
 * read-and-refine call that fixes transitions, repetition, and ensures the
 * executive summary matches the body.
 */
async function runFinalEditorPass(input: {
  readonly target: ReportAgentModelTarget;
  readonly apiKeys: ProviderApiKeys;
  readonly plan: ReportPlan;
  readonly presentationSections: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly sectionContents: ReadonlyMap<string, string>;
}): Promise<string> {
  const prompt = buildFinalEditorPrompt({
    plan: input.plan,
    presentationSections: input.presentationSections,
    sectionContents: input.sectionContents,
  });
  // No tools — the editor only reads the draft sections passed in the prompt.
  return runSectionAgentWithTarget({
    target: input.target,
    apiKeys: input.apiKeys,
    prompt,
    documents: [],
    enabledTools: new Set(),
    maxToolCalls: 0,
  });
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
  const presentationSections = flattenReportSections(input.plan.sectionTree);
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

  const agentSwarm = input.plan.orchestration.agentSwarm;

  // Orchestrator model — used for planning (future) and as the fallback for sections.
  const target = resolveModelTarget({
    apiKeys: input.apiKeys,
    requestedModel:
      agentSwarm.orchestratorModel?.model ?? input.plan.orchestration.modelSelection?.model ?? null,
  });

  // Section sub-agent model — may differ from the orchestrator so its context
  // stays lean while the orchestrator handles coordination.
  const sectionTarget =
    agentSwarm.sectionAgentModel != null
      ? (resolveModelTarget({
          apiKeys: input.apiKeys,
          requestedModel: agentSwarm.sectionAgentModel.model,
        }) ?? target)
      : target;

  const enabledTools = new Set<string>(agentSwarm.enabledTools);
  const maxToolCallsPerSection =
    agentSwarm.maxToolCallsPerSection ?? DEFAULT_MAX_TOOL_CALLS_PER_SECTION;
  const maxSectionRetries = agentSwarm.maxSectionRetries ?? DEFAULT_MAX_SECTION_RETRIES;

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
        let sectionRetryCount = 0;
        let lastSectionError: string | null = null;

        if (sectionTarget && fullSection) {
          // -----------------------------------------------------------------
          // Agentic loop: generate → validate word count → refine if needed
          // -----------------------------------------------------------------
          while (sectionRetryCount <= maxSectionRetries) {
            const isRevision = sectionRetryCount > 0 && content.length > 0;
            const prompt = isRevision
              ? buildRevisionPrompt({
                  plan: input.plan,
                  section: fullSection,
                  dependencyContent,
                  previousDraft: content,
                  wordCount: countWords(content),
                  attempt: sectionRetryCount,
                })
              : buildSectionPrompt({
                  plan: input.plan,
                  section: fullSection,
                  dependencyContent,
                });

            try {
              const generated = await runSectionAgentWithTarget({
                target: sectionTarget,
                apiKeys: input.apiKeys,
                prompt,
                documents: input.plan.globalSourceConfig.userDocuments.documents,
                enabledTools,
                maxToolCalls: maxToolCallsPerSection,
              });

              content = generated;
              const words = countWords(content);
              const { minWords, maxWords } = fullSection.lengthTarget;

              if (words >= minWords && words <= maxWords) {
                // Quality gate passed — exit the loop
                break;
              }

              // Quality gate failed — log and retry if budget allows
              if (sectionRetryCount < maxSectionRetries) {
                const direction = words < minWords ? "short" : "long";
                executionLog.push({
                  at: new Date().toISOString(),
                  kind: "section.retrying",
                  message: `Section "${flatSection.title}" is too ${direction} (${words} words, target ${minWords}–${maxWords}). Refining (attempt ${sectionRetryCount + 2}/${maxSectionRetries + 1}).`,
                  payload: {
                    sectionId: flatSection.id,
                    wordCount: words,
                    attempt: sectionRetryCount + 1,
                  },
                });
              }
              sectionRetryCount++;
            } catch (err) {
              lastSectionError = err instanceof Error ? err.message : "Section generation failed.";
              sectionRetryCount++;
              if (sectionRetryCount > maxSectionRetries) {
                failed = true;
                content = buildSectionFallbackContent(fullSection);
              }
            }
          }

          // Empty response after all attempts
          if (!failed && content.length === 0) {
            failed = true;
            content = buildSectionFallbackContent(fullSection);
            lastSectionError = "Model returned empty content.";
          }

          if (failed) {
            const failedAt = new Date().toISOString();
            const run = sectionRunMap.get(flatSection.id)!;
            sectionRunMap.set(flatSection.id, {
              ...run,
              status: "failed",
              retryCount: sectionRetryCount,
              lastError: lastSectionError ?? "Section generation failed after retries.",
            });
            executionLog.push({
              at: failedAt,
              kind: "section.failed",
              message: `Section "${flatSection.title}" failed after ${sectionRetryCount} attempt(s) — using fallback content.`,
              payload: {
                sectionId: flatSection.id,
                error: lastSectionError ?? "Unknown error",
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
          sectionRunMap.set(flatSection.id, {
            ...run,
            status: "completed",
            retryCount: sectionRetryCount,
            lastError: null,
          });
          executionLog.push({
            at: sectionCompletedAt,
            kind: "section.completed",
            message: `Completed section: "${flatSection.title}" (${sectionTarget ? sectionTarget.backend : "fallback"}, ${sectionRetryCount} revision(s))`,
            payload: {
              sectionId: flatSection.id,
              wordCount: countWords(content),
              retryCount: sectionRetryCount,
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

  // Build the raw assembled content as a fallback and as the editor's input.
  const rawSectionContents = new Map<string, string>(
    presentationSections.map((flatSection) => {
      const cached = sectionResults.get(flatSection.id)?.content;
      if (cached) return [flatSection.id, cached];
      const fullSection = fullSectionMap.get(flatSection.id);
      return [
        flatSection.id,
        fullSection
          ? buildSectionFallbackContent(fullSection)
          : `## ${flatSection.title}\n\n_Content unavailable._`,
      ];
    }),
  );

  function buildRawFinalContent(): string {
    return [
      `# ${input.plan.metadata.title}`,
      ...presentationSections.map((s) => rawSectionContents.get(s.id) ?? ""),
    ].join("\n\n");
  }

  const anyFailed = [...sectionResults.values()].some((r) => r.failed);

  // ---------------------------------------------------------------------------
  // Final editor pass — orchestrator assembles all sections into a cohesive
  // report: fixed transitions, no repetition, executive summary matches body.
  // Falls back to raw concatenation if the editor call fails.
  // ---------------------------------------------------------------------------
  let finalContent: string;

  if (target) {
    const editorStartAt = new Date().toISOString();
    executionLog.push({
      at: editorStartAt,
      kind: "run.editor_pass_started",
      message: `Running final editor pass over ${presentationSections.length} section(s).`,
      payload: { sectionCount: presentationSections.length },
    });

    try {
      const polished = await runFinalEditorPass({
        target,
        apiKeys: input.apiKeys,
        plan: input.plan,
        presentationSections,
        sectionContents: rawSectionContents,
      });

      finalContent = polished.trim().length > 0 ? polished.trim() : buildRawFinalContent();

      executionLog.push({
        at: new Date().toISOString(),
        kind: "run.editor_pass_completed",
        message: "Final editor pass completed.",
        payload: { wordCount: countWords(finalContent) },
      });
    } catch (editorErr) {
      finalContent = buildRawFinalContent();
      executionLog.push({
        at: new Date().toISOString(),
        kind: "run.editor_pass_failed",
        message: "Final editor pass failed — using raw section assembly.",
        payload: {
          error: editorErr instanceof Error ? editorErr.message : "Unknown error",
        },
      });
    }
  } else {
    finalContent = buildRawFinalContent();
  }

  const completedAt = new Date().toISOString();

  executionLog.push({
    at: completedAt,
    kind: "run.completed",
    message: anyFailed
      ? `Report assembled with ${sectionResults.size} sections (${[...sectionResults.values()].filter((r) => r.failed).length} used fallback content).`
      : `Report assembled from ${sectionResults.size} independently generated sections.`,
    payload: {
      backend: sectionTarget?.backend ?? "fallback",
      sectionCount: sectionResults.size,
      failedSections: [...sectionResults.entries()].filter(([, r]) => r.failed).map(([id]) => id),
    },
  });

  // Resolve [cite:Name] markers to numeric references [N] and build citation index
  const { content: citedContent, citations } = processCitations(
    finalContent,
    input.plan.globalSourceConfig.userDocuments.documents,
  );

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
        content: citedContent,
        citations,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Citation processing — runs once on the final assembled content.
// Replaces every [cite:FileName.ext] marker emitted by section agents with a
// numeric reference [N] and builds the citation index used by the web renderer.
// ---------------------------------------------------------------------------

interface CitationProcessingResult {
  readonly content: string;
  readonly citations: ReadonlyArray<ReportCitation>;
}

/** Extracts a short preview excerpt (~250 chars) from document text content. */
function extractDocumentExcerpt(textContent: string, maxChars = 250): string {
  const cleaned = textContent
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  // Trim to last word boundary
  const truncated = cleaned.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.7 ? truncated.slice(0, lastSpace) : truncated) + "…";
}

function processCitations(
  content: string,
  documents: ReadonlyArray<ReportSourceDocument>,
): CitationProcessingResult {
  const documentNames = new Set(documents.map((d) => d.name));
  // Case-insensitive fallback map: lowercase name → canonical name
  const nameLower = new Map<string, string>([...documentNames].map((n) => [n.toLowerCase(), n]));
  // Build excerpt map: documentName → short preview
  const excerptMap = new Map<string, string>(
    documents.map((d) => [d.name, extractDocumentExcerpt(d.textContent)]),
  );
  const citationMap = new Map<string, number>(); // documentName → index
  let nextIndex = 1;

  const processed = content.replace(/\[cite:([^\]]+)\]/g, (_: string, raw: string) => {
    const trimmed = raw.trim();
    // Exact match first, then case-insensitive fallback
    const canonical = documentNames.has(trimmed)
      ? trimmed
      : (nameLower.get(trimmed.toLowerCase()) ?? null);
    if (canonical === null) {
      // Unknown document — silently drop the marker
      return "";
    }
    if (!citationMap.has(canonical)) {
      citationMap.set(canonical, nextIndex++);
    }
    return `[${citationMap.get(canonical)!}]`;
  });

  const citations: ReportCitation[] = [...citationMap.entries()]
    .map(([documentName, index]) => ({
      index,
      documentName,
      excerpt: excerptMap.get(documentName) ?? "",
    }))
    .sort((a, b) => a.index - b.index);

  return { content: processed, citations };
}

function pickPrimaryOutputFormat(
  outputFormats: ReadonlyArray<ReportOutputFormat>,
): ReportOutputFormat {
  return outputFormats[0] ?? "markdown";
}
