import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import type { Session } from "../lib/storage";

interface AppShellProps {
  open: boolean;
  onToggle: () => void;
  sessions: Session[];
  activeId: string | null;
  onSelect: (session: Session) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onNewChat: () => void;
  toolLabel?: string;
  toolColor?: string;
  children: ReactNode;
}

/** Common page shell: sidebar + main content + the one reliable way to
 *  reopen the sidebar once it's closed.
 *
 * Every route used to render its own `<div className="app-layout">` /
 * `<Sidebar>` / `<div className="app-main">` boilerplate, and only HomePage
 * happened to also render a "sb-open-btn" — every other route (Research,
 * Coding, PDF, Tool) could close the sidebar via Sidebar's own close button
 * but then had no control left to reopen it. Centralizing the shell here
 * means every route gets the reopen control automatically, keyboard
 * accessible (it's a real `<button>`) and with a stable `aria-label`, at
 * every viewport width — the sidebar's own mobile-overlay behavior in
 * responsive.css doesn't change any of this, it's pure CSS layered on top
 * of the same DOM. */
export function AppShell({ children, ...sidebarProps }: AppShellProps) {
  const { open, onToggle } = sidebarProps;
  return (
    <div className="app-layout">
      <Sidebar {...sidebarProps} />
      <div className="app-main">
        {!open && (
          <button
            className="sb-open-btn"
            onClick={onToggle}
            title="Mở sidebar"
            aria-label="Mở sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
