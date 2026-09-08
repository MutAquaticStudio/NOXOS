import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties
} from "react";
import { WorkspaceTabs, type WorkspaceScope, type ObjectRouteResolver } from "./workspace-tabs";
import { DevelopmentSpine, type DevelopmentContext } from "./development-spine";
import {
  clampInspectorWidth,
  useShellPreferences,
  type ShellPreferences
} from "./shell-preferences";
export type NoxTheme = "DARK" | "LIGHT" | "SYSTEM";
export { NoxReadFeedback, type NoxReadState } from "./read-feedback";
export type NoxDensity = "COMPACT" | "DEFAULT" | "COMFORTABLE";

export type WorkspaceObject = {
  id: string;
  objectType: string;
  title: string;
  route: string;
  properties: readonly { label: string; value: string }[];
  readOnly?: boolean;
  development?: DevelopmentContext;
};
const WorkspaceObjectPublisher = createContext<(object: WorkspaceObject | undefined) => void>(
  () => {}
);
const UnsavedPublisher = createContext<(source: symbol, dirty: boolean) => void>(() => {});
export function useUnsavedChanges(dirty: boolean) {
  const publish = useContext(UnsavedPublisher);
  const [source] = useState(() => Symbol("workspace draft"));
  useEffect(() => {
    publish(source, dirty);
    return () => publish(source, false);
  }, [dirty, publish, source]);
}

/** Pass a memoized, already-authorized presentation DTO. Never fetch or authorize here. */
export function useWorkspaceObject(object: WorkspaceObject | undefined) {
  const publish = useContext(WorkspaceObjectPublisher);
  useEffect(() => {
    publish(object);
    return () => publish(undefined);
  }, [publish, object]);
}

export type ShellRailItem = {
  moduleId: string;
  label: string;
  routeRoot: string;
  navigationGroup: string;
  uxProfileId: string;
};

export type NoxShellProps = {
  theme: NoxTheme;
  onThemeChange?: (theme: NoxTheme) => void;
  onUnsavedChange?: (dirty: boolean) => void;
  hasUnsavedChanges?: boolean;
  requestWorkspaceChange?: (action: () => void) => void;
  workspaceScope?: WorkspaceScope;
  resolveObjectRoute?: ObjectRouteResolver;
  density: NoxDensity;
  railItems: readonly ShellRailItem[];
  activeRoute: string;
  onNavigate: (route: string) => void;
  identityLabel?: string;
  onSignOut?: () => void;
  systemNavigation?: ReactNode;
  tenantControl?: ReactNode;
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
  onThemeChange,
  onUnsavedChange,
  hasUnsavedChanges = false,
  requestWorkspaceChange,
  workspaceScope,
  resolveObjectRoute,
  density,
  railItems,
  activeRoute,
  onNavigate,
  identityLabel,
  onSignOut,
  systemNavigation,
  tenantControl,
  children
}: NoxShellProps) {
  const dirtySources = useRef(new Set<symbol>());
  const publishUnsaved = useCallback(
    (source: symbol, dirty: boolean) => {
      if (dirty) dirtySources.current.add(source);
      else dirtySources.current.delete(source);
      onUnsavedChange?.(dirtySources.current.size > 0);
    },
    [onUnsavedChange]
  );
  const [commandOpen, setCommandOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [preferences, updatePreferences] = useShellPreferences(workspaceScope);
  const inspectorOpen = preferences.inspectorOpen;
  const setInspectorOpen = (open: boolean) => updatePreferences({ inspectorOpen: open });
  const resizeStart = useRef<{ x: number; width: number } | undefined>(undefined);
  const [peekOpen, setPeekOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [selectedObject, setSelectedObject] = useState<WorkspaceObject>();
  const currentObject = selectedObject?.route === activeRoute ? selectedObject : undefined;
  const activeItem = railItems.find(
    (item) => activeRoute === item.routeRoot || activeRoute.startsWith(`${item.routeRoot}/`)
  );
  const navigate = (route: string) => {
    setNavigationOpen(false);
    setCommandOpen(false);
    onNavigate(route);
  };
  const commandInput = useRef<HTMLInputElement>(null);
  const commandTrigger = useRef<HTMLButtonElement>(null);

  useShortcut("k", () => setCommandOpen(true));
  useShortcut("j", () => setAssistOpen((value) => !value));

  useEffect(() => {
    if (commandOpen) {
      commandInput.current?.focus();
    }
  }, [commandOpen]);

  useEffect(() => {
    if (!commandOpen) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCommandOpen(false);
        window.requestAnimationFrame(() => commandTrigger.current?.focus());
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [commandOpen]);

  const closeCommandCenter = () => {
    setCommandOpen(false);
    window.requestAnimationFrame(() => commandTrigger.current?.focus());
  };

  return (
    <WorkspaceObjectPublisher.Provider value={setSelectedObject}>
      <div
        className="nox-os"
        data-theme={theme}
        data-density={preferences.density === "MODULE" ? density : preferences.density}
        data-interaction={preferences.interaction.toLowerCase()}
        style={{ "--nox-inspector-w": `${preferences.inspectorWidth}px` } as CSSProperties}
      >
        <a className="nox-skip-link" href="#nox-workbench">
          Skip to workspace
        </a>
        <header className="nox-system-bar">
          <button
            className="nox-mark"
            type="button"
            aria-label="Application menu"
            aria-expanded={navigationOpen}
            onClick={() => setNavigationOpen((value) => !value)}
          >
            NØX
          </button>
          <div className="nox-system-tenant">{tenantControl}</div>
          <button
            ref={commandTrigger}
            className="nox-command-trigger"
            type="button"
            onClick={() => setCommandOpen(true)}
            aria-haspopup="dialog"
          >
            <span>Search NØX-OS or run a command…</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="nox-system-actions" aria-label="System actions">
            <button
              type="button"
              onClick={() => setAssistOpen((value) => !value)}
              aria-pressed={assistOpen}
            >
              NØX Assist <kbd>⌘ J</kbd>
            </button>
            <button
              type="button"
              aria-label="User menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((value) => !value)}
            >
              {identityLabel ?? "User"}
            </button>
          </div>
        </header>

        <div className="nox-shell-grid" data-inspector-open={inspectorOpen}>
          <nav className="nox-app-rail" data-open={navigationOpen} aria-label="Application modules">
            {railItems.map((item) => (
              <button
                className={activeItem?.moduleId === item.moduleId ? "is-active" : undefined}
                key={item.moduleId}
                type="button"
                onClick={() => navigate(item.routeRoot)}
                title={item.label}
                aria-current={activeItem?.moduleId === item.moduleId ? "page" : undefined}
                data-ux-profile={item.uxProfileId}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <main
            id="nox-workbench"
            tabIndex={-1}
            className="nox-workspace"
            aria-label="NØX-OS workspace"
          >
            <WorkspaceTabs
              key={`${workspaceScope?.userId ?? "transient"}:${workspaceScope?.tenantId ?? "none"}`}
              scope={workspaceScope}
              resolveRoute={resolveObjectRoute}
              object={currentObject}
              activeRoute={activeRoute}
              fallbackLabel={activeItem?.label ?? "Workspace"}
              fallbackRoute={activeItem?.routeRoot ?? "/settings/tenant"}
              dirty={hasUnsavedChanges}
              requestChange={requestWorkspaceChange ?? ((action) => action())}
              onNavigate={navigate}
            />
            {currentObject?.development ? (
              <DevelopmentSpine context={currentObject.development} onNavigate={navigate} />
            ) : null}
            <div
              id="nox-workspace-panel"
              role="tabpanel"
              aria-label={currentObject?.title ?? activeItem?.label ?? "Workspace"}
              className="nox-workspace-content"
            >
              <UnsavedPublisher.Provider value={publishUnsaved}>
                {children}
              </UnsavedPublisher.Provider>
            </div>
          </main>

          <aside
            className={inspectorOpen ? "nox-inspector" : "nox-inspector is-hidden"}
            aria-label="Contextual inspector"
          >
            <div
              className="nox-inspector-resizer"
              role="separator"
              tabIndex={0}
              aria-label="Inspector width"
              aria-orientation="vertical"
              aria-valuemin={280}
              aria-valuemax={420}
              aria-valuenow={preferences.inspectorWidth}
              aria-valuetext={`${preferences.inspectorWidth} pixels`}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                updatePreferences({
                  inspectorWidth: clampInspectorWidth(
                    event.key === "Home"
                      ? 280
                      : event.key === "End"
                        ? 420
                        : preferences.inspectorWidth + (event.key === "ArrowLeft" ? 10 : -10)
                  )
                });
              }}
              onPointerDown={(event) => {
                resizeStart.current = { x: event.clientX, width: preferences.inspectorWidth };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (resizeStart.current)
                  updatePreferences({
                    inspectorWidth: clampInspectorWidth(
                      resizeStart.current.width + resizeStart.current.x - event.clientX
                    )
                  });
              }}
              onPointerUp={() => {
                resizeStart.current = undefined;
              }}
              onPointerCancel={() => {
                resizeStart.current = undefined;
              }}
            />
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
            {currentObject ? (
              <InspectorContext
                key={`${currentObject.objectType}:${currentObject.id}`}
                object={currentObject}
              />
            ) : (
              <p>Select an object to inspect its authorized context.</p>
            )}
            <button
              type="button"
              className="nox-peek-trigger"
              aria-expanded={peekOpen}
              aria-haspopup="dialog"
              onClick={() => setPeekOpen((value) => !value)}
            >
              Peek current context
            </button>
            {peekOpen ? (
              <ShellDialog title="Peek current context" onClose={() => setPeekOpen(false)}>
                {currentObject ? (
                  <>
                    <p>{currentObject.title}</p>
                    <p>{currentObject.objectType}</p>
                    <dl className="nox-definition-list">
                      {currentObject.properties.slice(0, 3).map((property) => (
                        <div key={property.label}>
                          <dt>{property.label}</dt>
                          <dd>{property.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <button
                      type="button"
                      onClick={() => {
                        setPeekOpen(false);
                        navigate(currentObject.route);
                      }}
                    >
                      Open object
                    </button>
                  </>
                ) : (
                  <p>No object is selected. Open an object from the workspace.</p>
                )}
              </ShellDialog>
            ) : null}
          </aside>

          {assistOpen ? <NoxAssist onClose={() => setAssistOpen(false)} /> : null}
        </div>

        <footer className="nox-status-bar" aria-label="System status">
          <span>{activeItem?.label ?? "NØX-OS"}</span>
          <span>No background synchronization configured</span>
          {!inspectorOpen ? (
            <button type="button" onClick={() => setInspectorOpen(true)}>
              Show inspector
            </button>
          ) : null}
        </footer>

        {accountOpen ? (
          <ShellDialog title="Account and system" onClose={() => setAccountOpen(false)}>
            <p>{identityLabel ?? "Signed-in user"}</p>
            {onThemeChange ? (
              <label>
                Theme
                <select
                  aria-label="Theme"
                  value={theme}
                  onChange={(event) => onThemeChange(event.target.value as NoxTheme)}
                >
                  <option value="DARK">Dark</option>
                  <option value="LIGHT">Light</option>
                  <option value="SYSTEM">System</option>
                </select>
              </label>
            ) : null}
            <label>
              Density
              <select
                aria-label="Density"
                value={preferences.density}
                onChange={(event) =>
                  updatePreferences({ density: event.target.value as ShellPreferences["density"] })
                }
              >
                <option value="MODULE">Module default</option>
                <option value="COMPACT">Compact</option>
                <option value="DEFAULT">Default</option>
                <option value="COMFORTABLE">Comfortable</option>
              </select>
            </label>
            <label>
              Interaction mode
              <select
                aria-label="Interaction mode"
                value={preferences.interaction}
                onChange={(event) =>
                  updatePreferences({
                    interaction: event.target.value as ShellPreferences["interaction"]
                  })
                }
              >
                <option value="AUTO">Automatic</option>
                <option value="POINTER">Pointer</option>
                <option value="TOUCH">Touch / lab</option>
              </select>
            </label>
            {systemNavigation}
            <button
              type="button"
              onClick={() => {
                setAccountOpen(false);
                onSignOut?.();
              }}
            >
              Sign out
            </button>
          </ShellDialog>
        ) : null}
        {commandOpen ? (
          <CommandCenter
            inputRef={commandInput}
            onClose={closeCommandCenter}
            items={railItems}
            onNavigate={navigate}
          />
        ) : null}
      </div>
    </WorkspaceObjectPublisher.Provider>
  );
}

function InspectorContext({ object }: { object: WorkspaceObject }) {
  const [section, setSection] = useState("Overview");
  return (
    <>
      <h3>{object.title}</h3>
      <p>
        {object.objectType} · {object.id.slice(0, 8)}
        {object.readOnly ? " · Read only" : ""}
      </p>
      <div role="group" aria-label="Inspector sections" className="nox-inspector-sections">
        <button
          type="button"
          aria-pressed={section === "Overview"}
          onClick={() => setSection("Overview")}
        >
          Overview
        </button>
        {object.properties.length ? (
          <button
            type="button"
            aria-pressed={section === "Properties"}
            onClick={() => setSection("Properties")}
          >
            Properties
          </button>
        ) : null}
      </div>
      <section aria-label={section}>
        <dl className="nox-definition-list">
          {(section === "Overview" ? object.properties.slice(0, 3) : object.properties).map(
            (property) => (
              <div key={property.label}>
                <dt>{property.label}</dt>
                <dd>{property.value}</dd>
              </div>
            )
          )}
        </dl>
      </section>
    </>
  );
}

function CommandCenter({
  inputRef,
  onClose,
  items,
  onNavigate
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  items: readonly ShellRailItem[];
  onNavigate: (route: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = items.filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase())
  );
  return (
    <ShellDialog title="Command Center" onClose={onClose}>
      <label>
        <span className="sr-only">Search commands</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search available modules…"
        />
      </label>
      <ul className="nox-command-results">
        {matches.map((item) => (
          <li key={item.moduleId}>
            <button type="button" onClick={() => onNavigate(item.routeRoot)}>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      {matches.length === 0 ? <p role="status">No available modules match.</p> : null}
    </ShellDialog>
  );
}

function ShellDialog({
  title,
  onClose,
  children
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      role="dialog"
      aria-label={title}
      className="nox-command-center"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'
          )
        ).filter((node) => node.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="nox-panel-heading">
        <h2>{title}</h2>
        <button type="button" onClick={onClose} aria-label={`Close ${title}`}>
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}

export { ShellDialog as NoxDialog };

function NoxAssist({ onClose }: { onClose: () => void }) {
  return (
    <ShellDialog title="NØX Assist" onClose={onClose}>
      <section className="nox-assist-content">
        <p className="nox-ai-context">ASK / SUGGEST / ACT</p>
        <section className="nox-ai-proposal" aria-label="AI capability boundary">
          <h3>Proposal boundary</h3>
          <p>
            Suggestions remain previewable. Consequential actions require confirmation and audit.
          </p>
          <p role="status">
            No assistant provider is connected to this shell. No changes can be applied here.
          </p>
        </section>
      </section>
    </ShellDialog>
  );
}
