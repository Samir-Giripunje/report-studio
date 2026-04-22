import { FileTextIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

interface CitationBadgeProps {
  index: number;
  documentName: string | undefined;
  excerpt?: string | undefined;
}

/**
 * Renders a numbered superscript citation badge.
 * Hovering shows a tooltip with the source document name and a text excerpt.
 *
 * If `documentName` is undefined (index not in the citation map, e.g. the user
 * manually typed a bare `[N]`), we fall back to plain text so nothing breaks.
 */
export function CitationBadge({ index, documentName, excerpt }: CitationBadgeProps) {
  if (!documentName) {
    return <>[{index}]</>;
  }

  return (
    // delay=0 → instant open, closeDelay=100 → quick close
    <Tooltip>
      <TooltipTrigger
        delay={0}
        closeDelay={100}
        render={
          <span
            aria-label={`Citation ${index}: ${documentName}`}
            className="citation-badge relative -top-[3px] mx-[1px] inline-flex cursor-default select-none items-center justify-center rounded bg-primary/12 px-[5px] py-[1px] text-[9px] font-semibold leading-none text-primary transition-colors hover:bg-primary/22"
          >
            {index}
          </span>
        }
      />
      <TooltipPopup side="top" sideOffset={6} className="max-w-72 px-3 py-2.5">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <FileTextIcon className="size-3.5 shrink-0 text-primary/70" />
            <span className="break-all text-xs font-semibold text-foreground">{documentName}</span>
          </div>
          {excerpt && excerpt.length > 0 && (
            <p className="line-clamp-4 text-[11px] leading-relaxed text-muted-foreground">
              {excerpt}
            </p>
          )}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
