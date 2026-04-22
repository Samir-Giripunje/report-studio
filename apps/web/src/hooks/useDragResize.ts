import { useCallback, useRef, useState } from "react";

export interface UseDragResizeOptions {
  initialWidth: number;
  minWidth: number;
  maxWidth: number;
  /**
   * Controls which drag direction grows the panel.
   * - `"right"` – dragging right increases width (left-side panels).
   * - `"left"`  – dragging left increases width (right-side panels).
   */
  direction: "right" | "left";
  /**
   * Optional localStorage key. When supplied the width is persisted across
   * page reloads and initialised from storage on mount.
   */
  storageKey?: string;
}

/**
 * Manages the width of a single resizable panel via mouse drag.
 *
 * Returns:
 * - `width`          – the current panel width in pixels
 * - `isDragging`     – true while the user is actively dragging
 * - `handleMouseDown`– attach to the divider element's `onMouseDown`
 */
export function useDragResize({
  initialWidth,
  minWidth,
  maxWidth,
  direction,
  storageKey,
}: UseDragResizeOptions): {
  width: number;
  isDragging: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
} {
  const [width, setWidth] = useState<number>(() => {
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored !== null) {
          const parsed = Number(stored);
          if (Number.isFinite(parsed)) {
            return Math.max(minWidth, Math.min(maxWidth, parsed));
          }
        }
      } catch {
        // localStorage may be unavailable (e.g. private browsing restrictions)
      }
    }
    return initialWidth;
  });

  const [isDragging, setIsDragging] = useState(false);

  // Stable refs — event-handler closures reference these so they never go stale
  const widthRef = useRef(width);
  const directionRef = useRef(direction);
  const storageKeyRef = useRef(storageKey);
  const minWidthRef = useRef(minWidth);
  const maxWidthRef = useRef(maxWidth);

  widthRef.current = width;
  directionRef.current = direction;
  storageKeyRef.current = storageKey;
  minWidthRef.current = minWidth;
  maxWidthRef.current = maxWidth;

  // Stable callback — all mutable deps are accessed through refs above
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    const startX = e.clientX;
    const startWidth = widthRef.current;

    setIsDragging(true);

    // Pin the cursor globally so it stays col-resize even when the pointer
    // drifts outside the narrow handle element during fast mouse movement.
    document.documentElement.style.cursor = "col-resize";
    document.documentElement.style.userSelect = "none";

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = directionRef.current === "right" ? ev.clientX - startX : startX - ev.clientX;

      const next = Math.max(minWidthRef.current, Math.min(maxWidthRef.current, startWidth + delta));

      setWidth(next);

      if (storageKeyRef.current) {
        try {
          localStorage.setItem(storageKeyRef.current, String(next));
        } catch {
          // ignore write errors
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.documentElement.style.cursor = "";
      document.documentElement.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []); // intentionally empty — all deps are read through stable refs

  return { width, isDragging, handleMouseDown };
}
