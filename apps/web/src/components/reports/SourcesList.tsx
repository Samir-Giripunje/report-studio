import { FileTextIcon } from "lucide-react";

import type { ReportCitation } from "@t3tools/contracts";

interface SourcesListProps {
  citations: ReadonlyArray<ReportCitation>;
  /** Indices that actually appear in the current (possibly user-edited) content. */
  visibleIndices: ReadonlySet<number>;
}

/**
 * Renders the "Sources" footer below the report body.
 *
 * Only lists citations whose `[N]` marker is still present in the current
 * content — if a user edits the report and removes a citation, it disappears
 * here automatically without breaking anything.
 */
export function SourcesList({ citations, visibleIndices }: SourcesListProps) {
  const visible = citations.filter((c) => visibleIndices.has(c.index));
  if (visible.length === 0) return null;

  return (
    <div className="sources-list mt-8 border-t border-border/60 pt-6">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Sources
      </p>
      <ol className="space-y-1.5 list-none p-0">
        {visible.map((citation) => (
          <li key={citation.index} className="flex items-center gap-2 text-xs">
            <span className="shrink-0 min-w-[1.5rem] font-semibold text-muted-foreground">
              [{citation.index}]
            </span>
            <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
            <span className="text-foreground/80">{citation.documentName}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
