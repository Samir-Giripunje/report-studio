import type { ModelSelection, ProviderApiKeys, ProviderKind } from "@t3tools/contracts";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

type ReportModelOption = {
  label: string;
  model: string;
  provider: ProviderKind;
  apiKeyRequired: keyof ProviderApiKeys;
};

export const REPORT_MODEL_OPTIONS: readonly ReportModelOption[] = [
  {
    label: "GPT-5.4",
    model: "gpt-5.4",
    provider: "codex",
    apiKeyRequired: "openai",
  },
  {
    label: "GPT-5.4 mini",
    model: "gpt-5.4-mini",
    provider: "codex",
    apiKeyRequired: "openai",
  },
  {
    label: "Gemini 3 Flash Preview",
    model: "gemini-3-flash-preview",
    provider: "codex",
    apiKeyRequired: "gemini",
  },
  {
    label: "Claude Sonnet 4.6",
    model: "claude-sonnet-4-6",
    provider: "claudeAgent",
    apiKeyRequired: "claude",
  },
] as const;

const DEFAULT_MODEL_SLUG = "gemini-3-flash-preview";

function findOption(model: string): ReportModelOption {
  return (
    REPORT_MODEL_OPTIONS.find((option) => option.model === model) ?? {
      label: "Gemini 3 Flash Preview",
      model: "gemini-3-flash-preview",
      provider: "codex" as const,
      apiKeyRequired: "gemini" as const,
    }
  );
}

/**
 * Returns the best default model selection given the currently configured API
 * keys. Prefers `gemini-3-flash-preview` when the Gemini key is present, then
 * falls back to the first model whose key is configured, and finally defaults
 * to `gemini-3-flash-preview` regardless (so the UI is consistent even before
 * any key is entered).
 */
export function getDefaultReportModelSelection(providerApiKeys?: ProviderApiKeys): ModelSelection {
  if (providerApiKeys) {
    const preferred = REPORT_MODEL_OPTIONS.find((o) => o.model === DEFAULT_MODEL_SLUG);
    if (preferred && providerApiKeys[preferred.apiKeyRequired]) {
      return { provider: preferred.provider, model: preferred.model };
    }
    const firstAvailable = REPORT_MODEL_OPTIONS.find((o) => !!providerApiKeys[o.apiKeyRequired]);
    if (firstAvailable) {
      return { provider: firstAvailable.provider, model: firstAvailable.model };
    }
  }
  return { provider: "codex", model: DEFAULT_MODEL_SLUG };
}

/**
 * Validates `selection` against the configured API keys. If the selected
 * model's key is missing, returns the best available default instead so the
 * UI never shows a model the user cannot actually use.
 */
export function resolveReportModelSelection(
  selection: ModelSelection,
  providerApiKeys: ProviderApiKeys,
): ModelSelection {
  const option = REPORT_MODEL_OPTIONS.find((o) => o.model === selection.model);
  if (option && providerApiKeys[option.apiKeyRequired]) {
    return selection;
  }
  return getDefaultReportModelSelection(providerApiKeys);
}

export function ReportModelControl(props: {
  modelSelection: ModelSelection;
  disabled?: boolean;
  providerApiKeys: ProviderApiKeys;
  onModelSelectionChange: (provider: ProviderKind, model: string) => void;
}) {
  const selectedOption = findOption(props.modelSelection.model);

  return (
    <Select
      value={selectedOption.model}
      onValueChange={(value) => {
        const nextOption = REPORT_MODEL_OPTIONS.find((option) => option.model === value);
        if (!nextOption) {
          return;
        }
        props.onModelSelectionChange(nextOption.provider, nextOption.model);
      }}
    >
      <SelectTrigger
        className="h-10 w-36 rounded-full border-border/70 bg-background px-4 shadow-none"
        disabled={props.disabled ?? false}
        size="lg"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectPopup align="end" className="max-h-80">
        {REPORT_MODEL_OPTIONS.map((option) => {
          const hasKey = !!props.providerApiKeys[option.apiKeyRequired];
          return (
            <SelectItem key={option.model} value={option.model} disabled={!hasKey}>
              {option.label}
              {!hasKey && <span className="ml-1 text-xs text-muted-foreground">(no API key)</span>}
            </SelectItem>
          );
        })}
      </SelectPopup>
    </Select>
  );
}
