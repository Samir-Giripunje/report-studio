import { useCallback, useEffect, useRef, useState } from "react";

export interface TextSelectionState {
  text: string;
  rect: DOMRect | null;
}

/**
 * Tracks text selected inside `containerRef`.
 *
 * Returns:
 * - `text`  – the trimmed selected string (empty when nothing is selected)
 * - `rect`  – the bounding rect of the selection range, used to position a
 *             floating toolbar
 * - `clearSelection` – clears both the DOM selection and internal state
 *
 * Only selections whose `commonAncestorContainer` is a descendant of the
 * provided container are surfaced; selections elsewhere in the document are
 * ignored and any previous state is cleared.
 */
export function useTextSelection(
  containerRef: React.RefObject<Element | null>,
): TextSelectionState & {
  clearSelection: () => void;
} {
  const [state, setState] = useState<TextSelectionState>({ text: "", rect: null });

  // Keep a stable ref so the event listener callback never needs to be
  // re-registered just because the container ref object changes identity.
  const containerRefRef = useRef(containerRef);
  containerRefRef.current = containerRef;

  const handleSelectionChange = useCallback(() => {
    const domSel = window.getSelection();

    if (!domSel || domSel.isCollapsed || domSel.rangeCount === 0) {
      setState({ text: "", rect: null });
      return;
    }

    const text = domSel.toString().trim();
    if (!text) {
      setState({ text: "", rect: null });
      return;
    }

    const container = containerRefRef.current.current;
    if (container) {
      const range = domSel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        setState({ text: "", rect: null });
        return;
      }
    }

    const range = domSel.getRangeAt(0);
    setState({ text, rect: range.getBoundingClientRect() });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [handleSelectionChange]);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setState({ text: "", rect: null });
  }, []);

  return { ...state, clearSelection };
}
