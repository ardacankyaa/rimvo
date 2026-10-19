import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

const WorkspacePopoverContext = createContext<{
  activeId: string | null;
  setActiveId: Dispatch<SetStateAction<string | null>>;
} | null>(null);

/** Workspace panels share one disclosure slot; changing panels never moves focus. */
export function WorkspacePopoverProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  return <WorkspacePopoverContext.Provider value={{ activeId, setActiveId }}>{children}</WorkspacePopoverContext.Provider>;
}

export function useWorkspacePopover() {
  const context = useContext(WorkspacePopoverContext);
  if (!context) throw new Error('Workspace panels need a WorkspacePopoverProvider.');
  const { activeId, setActiveId } = context;
  const panelId = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const open = activeId === panelId;
  const toggle = useCallback(() => setActiveId(current => current === panelId ? null : panelId), [panelId, setActiveId]);
  const close = useCallback((restoreFocus = true) => {
    setActiveId(current => current === panelId ? null : current);
    if (restoreFocus) openerRef.current?.focus({ preventScroll: true });
  }, [panelId, setActiveId]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !panelRef.current?.contains(target) && !openerRef.current?.contains(target)) close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, close]);

  return { open, panelId, openerRef, panelRef, toggle, close };
}
