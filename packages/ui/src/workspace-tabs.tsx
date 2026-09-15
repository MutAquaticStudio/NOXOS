import { useEffect, useRef, useState } from "react";
import type { WorkspaceObject } from "./index";

export type WorkspaceScope = { userId: string; tenantId: string };
export type ObjectRouteResolver = (objectType: string, objectId: string) => string | undefined;
type Tab = {
  objectType: string;
  objectId: string;
  pinned: boolean;
  route: string;
  title?: string;
  readOnly?: boolean;
};
const idOf = (tab: Pick<Tab, "objectType" | "objectId">) => `${tab.objectType}:${tab.objectId}`;
export const workspaceStorageKey = (scope: WorkspaceScope) =>
  `nox:workspaces:v1:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.tenantId)}`;

export function restoreWorkspaceTabs(
  raw: string | null,
  scope: WorkspaceScope,
  resolveRoute: ObjectRouteResolver
): Tab[] {
  try {
    const data = JSON.parse(raw ?? "null");
    if (
      data?.schemaVersion !== 1 ||
      data.userId !== scope.userId ||
      data.tenantId !== scope.tenantId ||
      !Array.isArray(data.tabs)
    )
      return [];
    const seen = new Set<string>();
    return data.tabs.slice(0, 50).flatMap((value: unknown) => {
      if (!value || typeof value !== "object") return [];
      const tab = value as Record<string, unknown>;
      if (
        typeof tab.objectType !== "string" ||
        typeof tab.objectId !== "string" ||
        typeof tab.pinned !== "boolean"
      )
        return [];
      const route = resolveRoute(tab.objectType, tab.objectId);
      const key = `${tab.objectType}:${tab.objectId}`;
      if (!route || seen.has(key)) return [];
      seen.add(key);
      return [{ objectType: tab.objectType, objectId: tab.objectId, pinned: tab.pinned, route }];
    });
  } catch {
    return [];
  }
}

export function serializeWorkspaceTabs(scope: WorkspaceScope, tabs: readonly Tab[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    ...scope,
    tabs: tabs.map(({ objectType, objectId, pinned }) => ({ objectType, objectId, pinned }))
  });
}

export function WorkspaceTabs({
  scope,
  resolveRoute,
  object,
  activeRoute,
  fallbackLabel,
  fallbackRoute,
  dirty,
  onNavigate,
  requestChange
}: {
  scope?: WorkspaceScope;
  resolveRoute?: ObjectRouteResolver;
  object?: WorkspaceObject;
  activeRoute: string;
  fallbackLabel: string;
  fallbackRoute: string;
  dirty: boolean;
  onNavigate: (route: string) => void;
  requestChange: (action: () => void) => void;
}) {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    if (!scope || !resolveRoute) return [];
    try {
      return restoreWorkspaceTabs(
        localStorage.getItem(workspaceStorageKey(scope)),
        scope,
        resolveRoute
      );
    } catch {
      return [];
    }
  });
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [capacity, setCapacity] = useState(1);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setCapacity(Math.max(1, Math.floor((entry.contentRect.width - 280) / 200)))
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!object || object.route !== activeRoute) {
      setTabs((current) => {
        const stale = current.find(
          (tab) =>
            tab.route === activeRoute && (tab.title !== undefined || tab.readOnly !== undefined)
        );
        return stale
          ? current.map((tab) =>
              tab === stale ? { ...tab, title: undefined, readOnly: undefined } : tab
            )
          : current;
      });
      return;
    }
    setTabs((current) => {
      const existing = current.find(
        (tab) => tab.objectType === object.objectType && tab.objectId === object.id
      );
      const next = {
        objectType: object.objectType,
        objectId: object.id,
        route: object.route,
        title: object.title,
        readOnly: object.readOnly,
        pinned: existing?.pinned ?? false
      };
      if (
        existing?.title === next.title &&
        existing?.route === next.route &&
        existing?.readOnly === next.readOnly
      )
        return current;
      return existing ? current.map((tab) => (tab === existing ? next : tab)) : [...current, next];
    });
  }, [object, activeRoute]);
  useEffect(() => {
    if (!scope) return;
    try {
      localStorage.setItem(workspaceStorageKey(scope), serializeWorkspaceTabs(scope, tabs));
    } catch {
      /* storage disabled: in-memory tabs still work */
    }
  }, [scope?.tenantId, scope?.userId, tabs]);

  const allowed = tabs.filter((tab) => !resolveRoute || resolveRoute(tab.objectType, tab.objectId));
  const sorted = [...allowed].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const active = sorted.find((tab) => tab.route === activeRoute);
  const visible = sorted.slice(0, capacity);
  if (active && !visible.includes(active))
    visible.splice(Math.max(0, visible.length - 1), 1, active);
  const label = (tab: Tab) => {
    // Absence of current authorized presentation is not evidence of deletion or
    // permission denial. Never display a cached title as a verified current object.
    const title =
      tab === active && (!object || object.route !== activeRoute) ? undefined : tab.title;
    return `${title ?? tab.objectType} · ${tab.objectId.slice(0, 8)}${title ? "" : " · Not loaded"}`;
  };
  const choose = (route: string) => {
    setSwitcherOpen(false);
    onNavigate(route);
  };
  const close = (tab: Tab) => {
    const perform = () => {
      setTabs((current) => current.filter((item) => idOf(item) !== idOf(tab)));
      if (tab.route === activeRoute)
        onNavigate(sorted.find((item) => item !== tab)?.route ?? fallbackRoute);
    };
    if (tab.route === activeRoute) requestChange(perform);
    else perform();
  };

  return (
    <div ref={root} className="nox-workspace-tabs">
      <div
        role="tablist"
        aria-label="Active workspaces"
        className="nox-tab-strip"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
          );
          const index = controls.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? controls.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + controls.length) %
                  controls.length;
          controls[next]?.focus();
        }}
      >
        {!active ? (
          <button type="button" role="tab" aria-selected="true" aria-controls="nox-workspace-panel">
            {fallbackLabel}
            {dirty ? " • Unsaved" : ""}
          </button>
        ) : null}
        {visible.map((tab) => (
          <button
            type="button"
            role="tab"
            key={idOf(tab)}
            aria-selected={tab === active}
            aria-controls="nox-workspace-panel"
            tabIndex={tab === active ? 0 : -1}
            title={label(tab)}
            onClick={() => choose(tab.route)}
          >
            <span aria-hidden="true">
              {tab.objectType === "Material" ? "◇" : tab.objectType === "Trial" ? "◉" : "▤"}
            </span>
            <span className="nox-tab-label">{label(tab)}</span>
            {tab.pinned ? <span aria-label="Pinned">◆</span> : null}
            {tab === active && dirty ? <span aria-label="Unsaved changes">●</span> : null}
            {tab === active && object?.readOnly ? <span aria-label="Read only">▣</span> : null}
          </button>
        ))}
      </div>
      {active ? (
        <>
          <button
            type="button"
            className="nox-tab-action"
            aria-label={`${active.pinned ? "Unpin" : "Pin"} current workspace`}
            onClick={() =>
              setTabs((current) =>
                current.map((tab) =>
                  idOf(tab) === idOf(active) ? { ...tab, pinned: !tab.pinned } : tab
                )
              )
            }
          >
            {active.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            className="nox-tab-action"
            aria-label="Close current workspace"
            onClick={() => close(active)}
          >
            ×
          </button>
        </>
      ) : null}
      {sorted.length ? (
        <button
          type="button"
          className="nox-tab-action"
          aria-expanded={switcherOpen}
          onClick={() => setSwitcherOpen((value) => !value)}
        >
          Workspaces ({sorted.length})
        </button>
      ) : null}
      {switcherOpen ? (
        <div
          className="nox-workspace-switcher"
          role="region"
          aria-label="Workspace switcher"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSwitcherOpen(false);
              root.current?.querySelector<HTMLButtonElement>("[aria-expanded]")?.focus();
            }
          }}
        >
          {sorted.map((tab) => (
            <div key={idOf(tab)}>
              <button
                type="button"
                aria-current={tab === active ? "page" : undefined}
                onClick={() => choose(tab.route)}
              >
                {label(tab)}
                {tab.pinned ? " · Pinned" : ""}
              </button>
              <button
                type="button"
                aria-label={`${tab.pinned ? "Unpin" : "Pin"} ${label(tab)}`}
                onClick={() =>
                  setTabs((current) =>
                    current.map((item) =>
                      idOf(item) === idOf(tab) ? { ...item, pinned: !item.pinned } : item
                    )
                  )
                }
              >
                {tab.pinned ? "Unpin" : "Pin"}
              </button>
              <button type="button" aria-label={`Close ${label(tab)}`} onClick={() => close(tab)}>
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
