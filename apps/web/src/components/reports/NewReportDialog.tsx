import { type ReportCreationMode } from "~/lib/reportCreation";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { ReportCreationOptionsGrid } from "./ReportCreationOptionsGrid";

export function NewReportDialog(props: {
  open: boolean;
  busyMode?: ReportCreationMode | null;
  targetFolder?: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (mode: ReportCreationMode) => void | Promise<void>;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-3xl border-border/70 bg-popover/95 shadow-lg/5 backdrop-blur">
        <DialogHeader className="border-b border-border/60 pb-5">
          <DialogTitle>Create New Report</DialogTitle>
          {props.targetFolder ? (
            <DialogDescription>
              New report will be created in{" "}
              <span className="font-medium">{props.targetFolder}</span>.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogPanel className="pt-3">
          <ReportCreationOptionsGrid busyMode={props.busyMode} onSelect={props.onSelect} />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
