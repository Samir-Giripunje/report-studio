import {
  REPORT_TOOL_NAMES,
  type ModelSelection,
  type ProviderApiKeys,
  type ProviderKind,
  type ReportAgentSwarmConfig,
  type ReportToolName,
} from "@t3tools/contracts";
import { BotIcon, ChevronDownIcon, SlidersHorizontalIcon, WrenchIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Switch } from "../ui/switch";
import { REPORT_MODEL_OPTIONS, getDefaultReportModelSelection } from "./ReportModelControl";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

// ---------------------------------------------------------------------------
// Tool metadata for UI display
// ---------------------------------------------------------------------------

const TOOL_META: Record<ReportToolName, { label: string; description: string }> = {
  list_documents: {
    label: "List Documents",
    description:
      "Inspect available uploaded sources, extracted text status, and table availability.",
  },
  search_documents: {
    label: "Search Documents",
    description: "Grep-style search through uploaded PDFs and source files (like grep -C N).",
  },
  read_document: {
    label: "Read Document",
    description: "Read extracted text from a selected source document or line range.",
  },
  list_tables: {
    label: "List Tables",
    description: "List extracted table-like sources available to report agents.",
  },
  read_table: {
    label: "Read Table",
    description: "Read a table-like source as rows for financial or quantitative sections.",
  },
  web_search: {
    label: "Web Search",
    description: "Search the web for current facts, recent data, and external references.",
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const INHERIT_SENTINEL = "__inherit__";

function AgentModelSelect(props: {
  label: string;
  description: string;
  value: ModelSelection | null;
  inheritLabel: string;
  disabled: boolean;
  providerApiKeys: ProviderApiKeys;
  onChange: (value: ModelSelection | null) => void;
}) {
  const currentValue = props.value?.model ?? INHERIT_SENTINEL;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{props.label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{props.description}</div>
      </div>
      <Select
        value={currentValue}
        onValueChange={(val) => {
          if (val === INHERIT_SENTINEL) {
            props.onChange(null);
            return;
          }
          const option = REPORT_MODEL_OPTIONS.find((o) => o.model === val);
          if (option) {
            props.onChange({ provider: option.provider as ProviderKind, model: option.model });
          }
        }}
      >
        <SelectTrigger
          className="h-9 w-44 shrink-0 rounded-lg border-border/70 bg-background px-3 shadow-none"
          disabled={props.disabled}
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectPopup align="end" className="max-h-80">
          <SelectItem value={INHERIT_SENTINEL}>
            <span className="text-muted-foreground">{props.inheritLabel}</span>
          </SelectItem>
          {REPORT_MODEL_OPTIONS.map((option) => {
            const hasKey = !!props.providerApiKeys[option.apiKeyRequired];
            return (
              <SelectItem key={option.model} value={option.model} disabled={!hasKey}>
                {option.label}
                {!hasKey && (
                  <span className="ml-1 text-xs text-muted-foreground">(no API key)</span>
                )}
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>
    </div>
  );
}

function ToolToggleRow(props: {
  tool: ReportToolName;
  enabled: boolean;
  disabled: boolean;
  onToggle: (tool: ReportToolName, enabled: boolean) => void;
}) {
  const meta = TOOL_META[props.tool];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background">
        <WrenchIcon className="size-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs font-medium text-foreground">{props.tool}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{meta.description}</div>
      </div>
      <Switch
        className="mt-0.5 shrink-0"
        checked={props.enabled}
        disabled={props.disabled}
        onCheckedChange={(checked) => props.onToggle(props.tool, checked)}
      />
    </div>
  );
}

function LimitInput(props: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{props.label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{props.description}</div>
      </div>
      <input
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n) && n >= props.min && n <= props.max) {
            props.onChange(n);
          }
        }}
        className={cn(
          "h-9 w-20 shrink-0 rounded-lg border border-border/70 bg-background px-3 text-right text-sm tabular-nums shadow-none",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReportAdvancedSettings(props: {
  agentSwarm: ReportAgentSwarmConfig;
  providerApiKeys: ProviderApiKeys;
  disabled: boolean;
  onSave: (agentSwarm: ReportAgentSwarmConfig) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReportAgentSwarmConfig>(props.agentSwarm);
  const [saving, setSaving] = useState(false);

  // Sync draft when saved config changes from outside (e.g. after another save)
  useEffect(() => {
    setDraft(props.agentSwarm);
  }, [props.agentSwarm]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(props.agentSwarm);

  const handleToolToggle = useCallback((tool: ReportToolName, enabled: boolean) => {
    setDraft((prev) => ({
      ...prev,
      enabledTools: enabled
        ? [...prev.enabledTools.filter((t) => t !== tool), tool]
        : prev.enabledTools.filter((t) => t !== tool),
    }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await props.onSave(draft);
    } finally {
      setSaving(false);
    }
  }, [draft, props]);

  const handleReset = useCallback(() => {
    setDraft(props.agentSwarm);
  }, [props.agentSwarm]);

  const fallback = getDefaultReportModelSelection(props.providerApiKeys);
  const orchestratorLabel = draft.orchestratorModel
    ? (REPORT_MODEL_OPTIONS.find((o) => o.model === draft.orchestratorModel?.model)?.label ??
      draft.orchestratorModel.model)
    : `Inherit (${REPORT_MODEL_OPTIONS.find((o) => o.model === fallback.model)?.label ?? fallback.model})`;

  const disabled = props.disabled || saving;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger className="w-full text-left" disabled={disabled}>
          <CardHeader className="select-none">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontalIcon className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">Advanced Agent Settings</CardTitle>
              </div>
              <ChevronDownIcon
                className={cn(
                  "size-4 text-muted-foreground transition-transform duration-200",
                  open && "rotate-180",
                )}
              />
            </div>
            <CardDescription>
              Configure the agent swarm — orchestrator model, section sub-agent model, tools, and
              limits.
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-6 pt-0">
            {/* ── Agent models ───────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <BotIcon className="size-3.5" />
                Agents
              </div>

              <AgentModelSelect
                label="Orchestrator model"
                description="Plans the report and coordinates section agents. Uses the report-level model when set to inherit."
                value={draft.orchestratorModel}
                inheritLabel={`Inherit (${REPORT_MODEL_OPTIONS.find((o) => o.model === fallback.model)?.label ?? fallback.model})`}
                disabled={disabled}
                providerApiKeys={props.providerApiKeys}
                onChange={(value) => setDraft((prev) => ({ ...prev, orchestratorModel: value }))}
              />

              <div className="h-px bg-border/50" />

              <AgentModelSelect
                label="Section sub-agent model"
                description="Each section is written by an independent sub-agent. Set a smaller/cheaper model here to keep costs down while using a powerful orchestrator."
                value={draft.sectionAgentModel}
                inheritLabel={`Inherit (${orchestratorLabel})`}
                disabled={disabled}
                providerApiKeys={props.providerApiKeys}
                onChange={(value) => setDraft((prev) => ({ ...prev, sectionAgentModel: value }))}
              />
            </div>

            {/* ── Tools ──────────────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <WrenchIcon className="size-3.5" />
                Tools
              </div>

              <div className="space-y-2">
                {REPORT_TOOL_NAMES.map((tool) => (
                  <ToolToggleRow
                    key={tool}
                    tool={tool}
                    enabled={draft.enabledTools.includes(tool)}
                    disabled={disabled}
                    onToggle={handleToolToggle}
                  />
                ))}
              </div>
            </div>

            {/* ── Limits ─────────────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Limits
              </div>

              <LimitInput
                label="Max tool calls per section"
                description="Hard cap on how many search/tool calls each sub-agent can make while writing a section."
                value={draft.maxToolCallsPerSection}
                min={1}
                max={20}
                disabled={disabled}
                onChange={(value) =>
                  setDraft((prev) => ({ ...prev, maxToolCallsPerSection: value }))
                }
              />

              <div className="h-px bg-border/50" />

              <LimitInput
                label="Max retries per section"
                description="How many times a sub-agent will revise a section that misses the target word count. Set to 0 to disable retries."
                value={draft.maxSectionRetries}
                min={0}
                max={10}
                disabled={disabled}
                onChange={(value) => setDraft((prev) => ({ ...prev, maxSectionRetries: value }))}
              />
            </div>

            {/* ── Actions ────────────────────────────────────────────────── */}
            {isDirty && (
              <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-4">
                <Button variant="ghost" size="sm" disabled={disabled} onClick={handleReset}>
                  Discard
                </Button>
                <Button size="sm" disabled={disabled} onClick={() => void handleSave()}>
                  {saving ? "Saving…" : "Save settings"}
                </Button>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
