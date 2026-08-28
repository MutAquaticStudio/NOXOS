import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ModuleUxProfile } from "@nox-os/contracts";

export type NoxTheme = "DARK" | "LIGHT" | "SYSTEM";
export type NoxDensity = "COMPACT" | "DEFAULT" | "COMFORTABLE";

export type ShellRailItem = {
  moduleId: string;
  label: string;
  routeRoot: string;
  navigationGroup: string;
  uxProfileId: ModuleUxProfile;
};

export type NoxShellProps = {
  theme: NoxTheme;
  density: NoxDensity;
  railItems: readonly ShellRailItem[];
  activeRoute: string;
  onNavigate: (route: string) => void;
  children: ReactNode;
};

function useShortcut(key: string, action: () => void): void {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === key) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [action, key]);
}

export function ReactBitsAdapter({
  intensity,
  children
}: {
  intensity: "none" | "low" | "medium";
  children: ReactNode;
}): ReactNode {
  return <div data-reactbits-intensity={intensity}>{children}</div>;
}

export function NoxShell({
  theme,
  density,
  railItems,
  activeRoute,
  onNavigate,
  children
}: NoxShellProps) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const commandInput = useRef<HTMLInputElement>(null);

  useShortcut("k", () => setCommandOpen(true));
  useShortcut("j", () => setAssistOpen((value) => !value));

  useEffect(() => {
    if (commandOpen) {
      commandInput.current?.focus();
    }
  }, [commandOpen]);

  return (
    <div className="nox-os" data-theme={theme} data-density={density}>
      <header className="nox-system-bar">
        <button className="nox-mark" type="button" aria-label="Open NØX launchpad">
          NØX
        </button>
        <button
          className="nox-command-trigger"
          type="button"
          onClick={() => setCommandOpen(true)}
          aria-haspopup="dialog"
        >
          <span>Search NØX-OS or run a command…</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="nox-system-actions" aria-label="System actions">
          <span className="nox-sync-status" aria-label="Synchronization state: foundation offline">
            Sync foundation
          </span>
          <button
            type="button"
            onClick={() => setAssistOpen((value) => !value)}
            aria-pressed={assistOpen}
          >
            NØX Assist <kbd>⌘ J</kbd>
          </button>
          <button type="button" aria-label="Notifications">
            Notifications
          </button>
          <button type="button" aria-label="User menu">
            User
          </button>
        </div>
      </header>

      <div className="nox-shell-grid">
        <nav className="nox-app-rail" aria-label="Application modules">
          {railItems.map((item) => (
            <button
              className={activeRoute.startsWith(item.routeRoot) ? "is-active" : undefined}
              key={item.moduleId}
              type="button"
              onClick={() => onNavigate(item.routeRoot)}
              data-ux-profile={item.uxProfileId}
            >
              <span aria-hidden="true">◈</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <main className="nox-workspace" aria-label="NØX-OS workspace">
          <div className="nox-workspace-tabs" role="tablist" aria-label="Active workspaces">
            <button role="tab" aria-selected="true" type="button">
              {activeRoute}
            </button>
          </div>
          <div className="nox-workspace-content">{children}</div>
        </main>

        <aside
          className={inspectorOpen ? "nox-inspector" : "nox-inspector is-hidden"}
          aria-label="Contextual inspector"
        >
          <div className="nox-panel-heading">
            <h2>Inspector</h2>
            <button
              type="button"
              onClick={() => setInspectorOpen(false)}
              aria-label="Close inspector"
            >
              Close
            </button>
          </div>
          <p>Selection-aware context is provided by later module capabilities.</p>
          <button type="button" className="nox-peek-trigger">
            Peek current context
          </button>
        </aside>

        {assistOpen ? <NoxAssist onClose={() => setAssistOpen(false)} /> : null}
      </div>

      <footer className="nox-status-bar" aria-label="System status">
        <span>Foundation shell</span>
        <span>Keyboard ready</span>
        {!inspectorOpen ? (
          <button type="button" onClick={() => setInspectorOpen(true)}>
            Show inspector
          </button>
        ) : null}
      </footer>

      {commandOpen ? (
        <CommandCenter inputRef={commandInput} onClose={() => setCommandOpen(false)} />
      ) : null}
    </div>
  );
}

function CommandCenter({
  inputRef,
  onClose
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
}) {
  return (
    <div className="nox-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="nox-command-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nox-command-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="nox-panel-heading">
          <h2 id="nox-command-title">Command Center</h2>
          <button type="button" onClick={onClose} aria-label="Close Command Center">
            Close
          </button>
        </div>
        <label>
          <span className="sr-only">Search commands</span>
          <input ref={inputRef} placeholder="Search NØX-OS or run a command…" />
        </label>
        <p>Navigation and contextual commands will be projected from the Module Registry.</p>
      </section>
    </div>
  );
}

function NoxAssist({ onClose }: { onClose: () => void }) {
  return (
    <aside className="nox-assist" aria-label="NØX Assist">
      <div className="nox-panel-heading">
        <h2>NØX Assist</h2>
        <button type="button" onClick={onClose} aria-label="Close NØX Assist">
          Close
        </button>
      </div>
      <p className="nox-ai-context">Context: foundation shell only</p>
      <section className="nox-ai-proposal" aria-label="AI proposal example">
        <h3>Proposal boundary</h3>
        <p>Suggestions remain previewable. Consequential actions require confirmation and audit.</p>
        <div className="nox-proposal-actions">
          <button type="button">Reject</button>
          <button type="button" disabled aria-describedby="nox-proposal-note">
            Apply changes
          </button>
        </div>
        <p id="nox-proposal-note">Business mutation is not implemented in Gate 1.</p>
      </section>
    </aside>
  );
}
