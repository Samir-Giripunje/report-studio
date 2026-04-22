import { SparklesIcon } from "lucide-react";
import { createPortal } from "react-dom";

import { Button } from "../ui/button";

interface SelectionToolbarProps {
  rect: DOMRect;
  onAsk: () => void;
}

/**
 * A floating toolbar rendered above a text selection.
 *
 * Mounted into `document.body` via a React portal so it is never clipped by
 * an ancestor's `overflow: hidden` and always sits at the correct z-index.
 *
 * `onMouseDown` prevents the default browser behaviour of clearing the
 * selection when the user clicks the button, ensuring the selected text is
 * still available in state when `onAsk` fires.
 */
export function SelectionToolbar({ rect, onAsk }: SelectionToolbarProps) {
  return createPortal(
    <div
      className="pointer-events-auto fixed z-50 flex items-center rounded-lg border border-border bg-popover px-1.5 py-1 shadow-md animate-in fade-in-0 zoom-in-95 duration-100"
      style={{
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
        transform: "translateX(-50%) translateY(-100%)",
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Button className="gap-1.5" size="xs" variant="ghost" onClick={onAsk}>
        <SparklesIcon className="size-3.5" />
        Ask AI about this
      </Button>
    </div>,
    document.body,
  );
}
