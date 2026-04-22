import type { RefObject } from "react";
import { DownloadIcon, FileTextIcon, PrinterIcon } from "lucide-react";

import type { ReportCitation } from "@t3tools/contracts";
import { toastManager } from "~/components/ui/toast";
import { exportReportAsDocx, exportReportAsPdf } from "~/lib/reportExport";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

export function ReportExportMenu(props: {
  title: string;
  content: string;
  citations?: ReadonlyArray<ReportCitation>;
  disabled?: boolean;
  renderedContentRef?: RefObject<HTMLElement | null>;
}) {
  const disabled = props.disabled === true || props.content.trim().length === 0;

  const handleExportPdf = () => {
    try {
      exportReportAsPdf({
        title: props.title,
        markdown: props.content,
        citations: props.citations ?? [],
        renderedElement: props.renderedContentRef?.current ?? null,
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "PDF export failed",
        description: cause instanceof Error ? cause.message : "Could not prepare the PDF export.",
      });
    }
  };

  const handleExportDocx = () => {
    try {
      exportReportAsDocx({
        title: props.title,
        markdown: props.content,
        citations: props.citations ?? [],
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "DOCX export failed",
        description: cause instanceof Error ? cause.message : "Could not prepare the DOCX file.",
      });
    }
  };

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button disabled={disabled} size="sm" variant="outline" aria-label="Export report" />
        }
      >
        <DownloadIcon className="size-3.5" />
        Export
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem disabled={disabled} onClick={handleExportPdf}>
          <PrinterIcon className="size-4" />
          Export as PDF
        </MenuItem>
        <MenuItem disabled={disabled} onClick={handleExportDocx}>
          <FileTextIcon className="size-4" />
          Export as DOCX
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
