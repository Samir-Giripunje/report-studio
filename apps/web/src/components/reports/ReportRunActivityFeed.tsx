import { type ReportRunProgressStep } from "@t3tools/contracts";
import {
  CheckCircle2Icon,
  CircleDotIcon,
  LoaderCircleIcon,
  PenLineIcon,
  XCircleIcon,
} from "lucide-react";

interface Props {
  readonly events: ReadonlyArray<ReportRunProgressStep>;
  readonly isRunning: boolean;
}

function eventIcon(kind: string, isLatest: boolean) {
  if (isLatest && kind !== "section.completed" && kind !== "section.failed") {
    return <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />;
  }
  switch (kind) {
    case "section.completed":
    case "run.editor_pass_completed":
    case "run.completed":
      return <CheckCircle2Icon className="size-3.5 shrink-0 text-green-500" />;
    case "section.failed":
    case "run.editor_pass_failed":
      return <XCircleIcon className="size-3.5 shrink-0 text-destructive" />;
    case "run.editor_pass_started":
      return <PenLineIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    default:
      return <CircleDotIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  }
}

function eventLabel(event: ReportRunProgressStep): string {
  return event.message;
}

export function ReportRunActivityFeed({ events, isRunning }: Props) {
  if (events.length === 0 && !isRunning) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {isRunning ? "Generating report…" : "Run complete"}
      </p>
      <ul className="space-y-1.5">
        {events.map((event, index) => {
          const isLatest = isRunning && index === events.length - 1;
          return (
            <li
              key={`${event.at}-${event.kind}`}
              className="flex items-start gap-2 text-xs text-foreground"
            >
              <span className="mt-px">{eventIcon(event.kind, isLatest)}</span>
              <span className={isLatest ? "text-foreground" : "text-muted-foreground"}>
                {eventLabel(event)}
              </span>
            </li>
          );
        })}
        {isRunning && events.length === 0 && (
          <li className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
            <span>Starting…</span>
          </li>
        )}
      </ul>
    </div>
  );
}
