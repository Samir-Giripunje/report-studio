import { FolderPlusIcon, LightbulbIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

export function NewReportFolderDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (folderName: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [folderName, setFolderName] = useState("");

  useEffect(() => {
    if (!props.open) {
      setFolderName("");
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [props.open]);

  const trimmedFolderName = folderName.trim();

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-xl border-border/70 bg-popover/95 shadow-lg/5 backdrop-blur">
        <DialogHeader className="border-b border-border/60 pb-5">
          <DialogTitle>Create Project Folder</DialogTitle>
          <DialogDescription>
            Name the folder first, then choose which type of report to create inside it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4 pt-3">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-foreground">Folder name</span>
            <div className="relative">
              <FolderPlusIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                ref={inputRef}
                value={folderName}
                placeholder="OpenReport"
                className="pl-9"
                onChange={(event) => setFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || trimmedFolderName.length === 0) {
                    return;
                  }
                  event.preventDefault();
                  props.onConfirm(trimmedFolderName);
                }}
              />
            </div>
          </label>

          <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/28 px-4 py-3 text-sm text-muted-foreground">
            <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-foreground/70" />
            <p>
              Folder names appear under Projects in the sidebar. The folder will show up after the
              first report is created in it.
            </p>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={trimmedFolderName.length === 0}
            onClick={() => props.onConfirm(trimmedFolderName)}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
