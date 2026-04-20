import { FileTextIcon, FolderIcon, type LucideIcon, SquarePenIcon } from "lucide-react";

import { type ReportCreationMode, REPORT_CREATION_OPTIONS } from "~/lib/reportCreation";
import { cn } from "~/lib/utils";

const REPORT_CREATION_ICONS: Record<ReportCreationMode, LucideIcon> = {
  guided: FileTextIcon,
  template: SquarePenIcon,
  prebuilt: FolderIcon,
};

export function ReportCreationOptionsGrid(props: {
  busyMode?: ReportCreationMode | null | undefined;
  onSelect: (mode: ReportCreationMode) => void | Promise<void>;
  compact?: boolean;
}) {
  return (
    <div className={cn("grid gap-3", props.compact ? "md:grid-cols-3" : undefined)}>
      {REPORT_CREATION_OPTIONS.map((option) => {
        const Icon = REPORT_CREATION_ICONS[option.mode];
        const isBusy = props.busyMode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            aria-busy={isBusy}
            disabled={props.busyMode !== null && props.busyMode !== undefined}
            className={cn(
              "group flex w-full items-center gap-4 rounded-[1.4rem] border border-border/70 bg-gradient-to-br from-background via-background to-muted/35 px-5 py-5 text-left transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-px hover:border-foreground/18 hover:shadow-md/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-70",
              props.compact && "min-h-36 flex-col items-start gap-3 px-4 py-4",
              isBusy && "border-primary/35 shadow-sm",
            )}
            onClick={() => void props.onSelect(option.mode)}
          >
            <span
              className={cn(
                "flex size-16 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-muted/70 text-foreground/80",
                props.compact && "size-12",
              )}
            >
              <Icon className={cn("size-8", props.compact && "size-6")} />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "flex items-center justify-between gap-3",
                  props.compact && "items-start",
                )}
              >
                <span
                  className={cn(
                    "truncate text-xl font-medium text-foreground",
                    props.compact && "text-base leading-5",
                  )}
                >
                  {option.title}
                </span>
                {isBusy ? (
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    Creating...
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  "mt-1 block text-sm text-muted-foreground",
                  props.compact && "line-clamp-3 text-[13px] leading-5",
                )}
              >
                {option.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
