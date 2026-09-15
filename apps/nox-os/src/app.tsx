import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  createBrowserRouter,
  RouterProvider,
  useBlocker,
  useBeforeUnload,
  matchPath,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate
} from "react-router-dom";
import type { ModuleDefinition, ModuleUxDensity } from "@nox-os/contracts";
import { projectAppRail, validateModuleDefinitions } from "@nox-os/module-registry";
import type { NoxDensity, NoxTheme } from "@nox-os/ui";
import { browserAuthConfiguration, createBrowserAuthClient } from "./auth-client";
import { moduleDefinitions } from "./modules/definitions";
import { isTrialViewOnlyNavigation, resolveWorkspaceObjectRoute } from "./workspace-navigation";
import { NoxApiError, type ApiClient } from "./api-client";
import {
  readPlatformIdentity,
  readTenantChoices,
  readTenantContext,
  type PlatformIdentity,
  type TenantChoice,
  type TenantContextPayload
} from "./context-response";

// The unauthenticated entry needs the existing Auth surface, not workspace UI.
// Both exports share the same deferred module; no second Shell is introduced.
const NoxShell = lazy(async () => ({ default: (await import("@nox-os/ui")).NoxShell }));
const NoxDialog = lazy(async () => ({ default: (await import("@nox-os/ui")).NoxDialog }));

const LazyPlatformAuditScreen = lazy(async () => ({
  default: (await import("./platform-control")).PlatformAuditScreen
}));
const LazyPlatformTenantsScreen = lazy(async () => ({
  default: (await import("./platform-control")).PlatformTenantsScreen
}));
const LazyPlatformUsersScreen = lazy(async () => ({
  default: (await import("./platform-control")).PlatformUsersScreen
}));
const LazyTenantSettingsScreen = lazy(async () => ({
  default: (await import("./platform-control")).TenantSettingsScreen
}));

const LazyFoundationModule = lazy(async () => {
  const module = await import("./modules/foundation-module");
  return { default: module.FoundationModuleSurface };
});

const LazyMaterialExperience = lazy(async () => {
  const module = await import("./material-intelligence");
  return { default: module.MaterialExperience };
});

const LazyPlatformMaterialExperience = lazy(async () => {
  const module = await import("./material-intelligence");
  return { default: module.PlatformMaterialExperience };
});

const LazyDesignStudioExperience = lazy(async () => {
  const module = await import("./design-studio");
  return { default: module.DesignStudioExperience };
});

const LazyTrialSensoryExperience = lazy(async () => {
  const module = await import("./trial-sensory");
  return { default: module.TrialSensoryExperience };
});

const LazyReleaseReadinessExperience = lazy(async () => {
  const module = await import("./release-readiness");
  return { default: module.ReleaseReadinessExperience };
});

const LazyInventoryExperience = lazy(async () => {
  const module = await import("./inventory");
  return { default: module.InventoryExperience };
});

const LazyProcurementExperience = lazy(async () => {
  const module = await import("./procurement");
  return { default: module.ProcurementExperience };
});
const LazyProductionExperience = lazy(async () => {
  const module = await import("./production");
  return { default: module.ProductionExperience };
});
const LazyQualityControlExperience = lazy(async () => {
  const module = await import("./quality-control");
  return { default: module.QualityControlExperience };
});
const LazyLabServicesExperience = lazy(async () => {
  const module = await import("./lab-services");
  return { default: module.LabServicesExperience };
});
const LazyProjectOperationsExperience = lazy(async () => {
  const module = await import("./project-operations");
  return { default: module.ProjectOperationsExperience };
});
const LazyCommercialOrdersExperience = lazy(async () => {
  const module = await import("./commercial-orders");
  return { default: module.CommercialOrdersExperience };
});

// Vite's publicBuildEnvironment validates these exact compile-time values,
// including local defaults. Do not ship the build/server validators to render
// two public identity labels; Auth still consumes its existing exact public keys.
const publicIdentity = {
  environment: import.meta.env.VITE_NOX_ENV,
  sourceSha: import.meta.env.VITE_NOX_SOURCE_SHA
};

type SessionState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "authenticated"; session: Session }
  | { kind: "unconfigured" };

function FoundationRoute({ definition }: { definition: ModuleDefinition }) {
  return (
    <Suspense fallback={<p>Loading module foundation…</p>}>
      <LazyFoundationModule descriptor={definition.descriptor} />
    </Suspense>
  );
}

function toShellDensity(density: ModuleUxDensity): NoxDensity {
  return density === "compact" ? "COMPACT" : density === "comfortable" ? "COMFORTABLE" : "DEFAULT";
}

function useSession(client: SupabaseClient | undefined, initializing: boolean): SessionState {
  const [state, setState] = useState<SessionState>(
    initializing || client ? { kind: "loading" } : { kind: "unconfigured" }
  );
  useEffect(() => {
    if (initializing) {
      setState({ kind: "loading" });
      return;
    }
    if (!client) {
      setState({ kind: "unconfigured" });
      return;
    }
    let current = true;
    void client.auth
      .getSession()
      .then(({ data }) => {
        if (current)
          setState(
            data.session
              ? { kind: "authenticated", session: data.session }
              : { kind: "unauthenticated" }
          );
      })
      .catch(() => {
        if (current) setState({ kind: "unauthenticated" });
      });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (current)
        setState(session ? { kind: "authenticated", session } : { kind: "unauthenticated" });
    });
    return () => {
      current = false;
      data.subscription.unsubscribe();
    };
  }, [client, initializing]);
  return state;
}

function useTenantChoices(session: Session) {
  const [choices, setChoices] = useState<TenantChoice[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | undefined>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setState("loading");
    setChoices([]);
    setActiveTenantId(undefined);
    void fetch("/api/v1/me/tenants", {
      headers: { authorization: `Bearer ${session.access_token}` }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Tenant lookup failed.");
        return readTenantChoices(await response.json());
      })
      .then((next) => {
        if (!current) return;
        setChoices(next);
        setActiveTenantId(next.length === 1 ? next[0].tenantId : undefined);
        setState("ready");
      })
      .catch(() => {
        if (current) {
          setChoices([]);
          setState("error");
        }
      });
    return () => {
      current = false;
    };
  }, [session.access_token, session.user.id, reload]);
  return {
    choices,
    activeTenantId,
    setActiveTenantId,
    state,
    retry: () => setReload((value) => value + 1)
  };
}

function usePlatformIdentity(session: Session) {
  const [identity, setIdentity] = useState<PlatformIdentity>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setState("loading");
    setIdentity(undefined);
    void fetch("/api/v1/me", { headers: { authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Identity lookup failed.");
        return readPlatformIdentity(await response.json(), session.user.id);
      })
      .then((identity) => {
        if (!current) return;
        setIdentity(identity);
        setState("ready");
      })
      .catch(() => {
        if (!current) return;
        setIdentity(undefined);
        setState("error");
      });
    return () => {
      current = false;
    };
  }, [session.access_token, session.user.id, reload]);
  return { identity, state, retry: () => setReload((value) => value + 1) };
}

function SignIn({ client }: { client: SupabaseClient | undefined }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await client.auth.signInWithPassword({ email, password });
      if (result.error) setError("Sign-in could not be completed.");
    } catch {
      setError("Sign-in could not be completed.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="nox-auth-page" aria-labelledby="sign-in-title">
      <section className="nox-auth-card">
        <p className="nox-ai-context">NØX-OS</p>
        <h1 id="sign-in-title">Sign in</h1>
        {client ? (
          <form onSubmit={submit}>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <button type="submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <p role="alert">Authentication is not configured for this environment.</p>
        )}
      </section>
    </main>
  );
}

function AuthenticationFoundation({ children }: { children: ReactNode }) {
  return (
    <div className="nox-os" data-theme="SYSTEM" data-density="DEFAULT">
      {children}
    </div>
  );
}

function ApplicationLoadError({
  authentication = false,
  embedded = false
}: {
  authentication?: boolean;
  embedded?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const content = (
    <section className="nox-auth-card" aria-labelledby="application-load-error-title">
      <p className="nox-ai-context">NØX-OS</p>
      <h1 id="application-load-error-title" ref={heading} tabIndex={-1}>
        {authentication ? "Authentication unavailable" : "Workspace unavailable"}
      </h1>
      <p role="alert">
        {authentication
          ? "Authentication could not be loaded. Check your connection and reload to try again."
          : "This workspace could not be loaded. Check your connection and reload to try again."}
      </p>
      <p>Reloading may discard unsaved local edits. Saved server data is not changed.</p>
      <button type="button" onClick={() => window.location.reload()}>
        {authentication ? "Reload sign-in" : "Reload workspace"}
      </button>
    </section>
  );
  if (embedded) return content;
  return (
    <AuthenticationFoundation>
      <main className="nox-auth-page" aria-labelledby="application-load-error-title">
        {content}
      </main>
    </AuthenticationFoundation>
  );
}

// Isolate module render/import failures inside the existing workspace. A rejected
// dynamic import needs explicit reload; navigation to a different path resets only
// this boundary, without replacing Auth or the OS Shell.
class WorkspaceRenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <ApplicationLoadError embedded /> : this.props.children;
  }
}

function PlatformConsoleDenied() {
  return (
    <section aria-labelledby="platform-console-denied-title">
      <p className="nox-ai-context">403</p>
      <h1 id="platform-console-denied-title">Platform Console access denied</h1>
      <p>Platform control is available only to an active PLATFORM_OWNER.</p>
    </section>
  );
}

function AuthenticatedApplication({
  client,
  session
}: {
  client: SupabaseClient;
  session: Session;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<NoxTheme>("DARK");
  const [unsaved, setUnsavedState] = useState(false);
  const unsavedRef = useRef(false);
  const setUnsaved = useCallback((value: boolean) => {
    unsavedRef.current = value;
    setUnsavedState(value);
  }, []);
  const [pendingChange, setPendingChange] = useState<() => void>();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      unsavedRef.current && !isTrialViewOnlyNavigation(currentLocation, nextLocation)
  );
  useBeforeUnload(
    useCallback(
      (event) => {
        if (unsaved) {
          event.preventDefault();
          event.returnValue = "";
        }
      },
      [unsaved]
    )
  );
  const changeWorkspace = (action: () => void) => {
    if (unsaved) setPendingChange(() => action);
    else action();
  };
  const tenantSelection = useTenantChoices(session);
  const platformIdentity = usePlatformIdentity(session);
  const activeTenant = tenantSelection.choices.find(
    (tenant) => tenant.tenantId === tenantSelection.activeTenantId
  );
  const [tenantContextState, setTenantContextState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [tenantContext, setTenantContext] = useState<TenantContextPayload>();
  const [contextReload, setContextReload] = useState(0);
  const api = useCallback<ApiClient>(
    async (path, options = {}) => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${session.access_token}`
      };
      if (options.tenantId) headers["x-nox-tenant-id"] = options.tenantId;
      if (options.body !== undefined) headers["content-type"] = "application/json";
      const response = await fetch("/api/v1" + path, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => undefined)) as
          { error?: { code?: string; message?: string } } | undefined;
        throw new NoxApiError(
          errorBody?.error?.message ?? `Request was rejected (${response.status}).`,
          response.status,
          errorBody?.error?.code
        );
      }
      return (await response.json()) as never;
    },
    [session.access_token]
  );
  useEffect(() => {
    if (!activeTenant) {
      setTenantContextState("idle");
      setTenantContext(undefined);
      return;
    }
    let current = true;
    setTenantContextState("loading");
    setTenantContext(undefined);
    void api<unknown>("/context", { tenantId: activeTenant.tenantId })
      .then((payload) => {
        if (!current) return;
        setTenantContext(readTenantContext(payload, activeTenant.tenantId));
        setTenantContextState("ready");
      })
      .catch(() => {
        if (!current) return;
        setTenantContext(undefined);
        setTenantContextState("error");
      });
    return () => {
      current = false;
    };
  }, [activeTenant?.tenantId, api, contextReload]);
  const appRail = useMemo(() => {
    validateModuleDefinitions(moduleDefinitions);
    return projectAppRail(moduleDefinitions, tenantContext?.moduleAvailability ?? []);
  }, [tenantContext]);
  const resolveObjectRoute = useCallback(
    (type: string, id: string) => resolveWorkspaceObjectRoute(appRail, type, id),
    [appRail]
  );
  const enabledDefinitions = useMemo(() => {
    const visibleModuleIds = new Set(appRail.map((item) => item.moduleId));
    return moduleDefinitions.filter((definition) => visibleModuleIds.has(definition.descriptor.id));
  }, [appRail]);
  const routeEntries = useMemo(
    () =>
      enabledDefinitions
        .filter(
          (definition) =>
            definition.descriptor.id !== "material-intelligence" &&
            definition.descriptor.id !== "design-studio" &&
            definition.descriptor.id !== "trial-sensory" &&
            definition.descriptor.id !== "release-readiness" &&
            definition.descriptor.id !== "inventory" &&
            definition.descriptor.id !== "procurement" &&
            definition.descriptor.id !== "production" &&
            definition.descriptor.id !== "quality-control" &&
            definition.descriptor.id !== "commercial-orders" &&
            // Project Operations has its own route-based workspace below. Leaving
            // its generated registry entry here creates a higher-ranked duplicate
            // child route and shadows /project-operations/projects/:projectId.
            definition.descriptor.id !== "project-operations"
        )
        .flatMap((definition) => [
          { path: definition.descriptor.routeRoot, definition },
          ...definition.descriptor.childRoutes.map((path) => ({ path, definition }))
        ]),
    [enabledDefinitions]
  );
  const activeDefinition =
    routeEntries.find((route) => matchPath({ path: route.path, end: true }, location.pathname))
      ?.definition ??
    (location.pathname.startsWith("/materials")
      ? moduleDefinitions.find((definition) => definition.descriptor.id === "material-intelligence")
      : location.pathname.startsWith("/design-studio")
        ? moduleDefinitions.find((definition) => definition.descriptor.id === "design-studio")
        : location.pathname.startsWith("/trials")
          ? moduleDefinitions.find((definition) => definition.descriptor.id === "trial-sensory")
          : location.pathname.startsWith("/inventory")
            ? moduleDefinitions.find((definition) => definition.descriptor.id === "inventory")
            : location.pathname.startsWith("/procurement")
              ? moduleDefinitions.find((definition) => definition.descriptor.id === "procurement")
              : location.pathname.startsWith("/production")
                ? moduleDefinitions.find((definition) => definition.descriptor.id === "production")
                : location.pathname.startsWith("/quality-control")
                  ? moduleDefinitions.find(
                      (definition) => definition.descriptor.id === "quality-control"
                    )
                  : location.pathname.startsWith("/commercial-orders")
                    ? moduleDefinitions.find(
                        (definition) => definition.descriptor.id === "commercial-orders"
                      )
                    : undefined);
  const density = activeDefinition ? toShellDensity(activeDefinition.uxProfile.density) : "DEFAULT";
  const isPlatformOwner =
    platformIdentity.state === "ready" &&
    platformIdentity.identity?.platformRoleKey === "PLATFORM_OWNER";
  const hasNoWorkspace = tenantSelection.state === "ready" && tenantSelection.choices.length === 0;
  const registeredModules = moduleDefinitions.map((definition) => ({
    id: definition.descriptor.id,
    displayName: definition.descriptor.displayName
  }));
  const tenantControl =
    tenantSelection.state === "loading" ? (
      <span role="status">Loading workspaces…</span>
    ) : tenantSelection.state === "error" ? (
      <>
        <span role="alert">Workspace lookup failed</span>
        <button type="button" onClick={tenantSelection.retry}>
          Retry workspaces
        </button>
      </>
    ) : tenantSelection.choices.length === 0 ? (
      <span>No active workspace</span>
    ) : (
      <label className="nox-tenant-selector">
        <span className="sr-only">Current tenant</span>
        <select
          value={tenantSelection.activeTenantId ?? ""}
          onChange={(event) => {
            const id = event.target.value || undefined;
            changeWorkspace(() => tenantSelection.setActiveTenantId(id));
          }}
        >
          <option value="" disabled>
            Select tenant
          </option>
          {tenantSelection.choices.map((tenant) => (
            <option key={tenant.tenantId} value={tenant.tenantId}>
              {tenant.name}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <NoxShell
      key={`${session.user.id}:${activeTenant?.tenantId ?? "no-workspace"}`}
      theme={theme}
      onThemeChange={setTheme}
      onUnsavedChange={setUnsaved}
      hasUnsavedChanges={unsaved}
      requestWorkspaceChange={changeWorkspace}
      workspaceScope={
        tenantContextState === "ready" && activeTenant
          ? { userId: session.user.id, tenantId: activeTenant.tenantId }
          : undefined
      }
      resolveObjectRoute={resolveObjectRoute}
      density={density}
      railItems={appRail}
      activeRoute={location.pathname}
      onNavigate={navigate}
      identityLabel={session.user.email ?? "Signed-in user"}
      onSignOut={() => {
        changeWorkspace(() => {
          void client.auth.signOut();
        });
      }}
      systemNavigation={
        isPlatformOwner ? (
          <>
            <button type="button" onClick={() => navigate("/platform/tenants")}>
              Platform Console
            </button>
            {platformIdentity.identity?.platformPermissions.includes(
              "module.material-intelligence.reference.read"
            ) ? (
              <button
                type="button"
                onClick={() => navigate("/platform/material-intelligence/review")}
              >
                Material review
              </button>
            ) : null}
          </>
        ) : undefined
      }
      tenantControl={tenantControl}
    >
      {pendingChange || blocker.state === "blocked" ? (
        <NoxDialog
          title="Unsaved changes"
          onClose={() => {
            setPendingChange(undefined);
            if (blocker.state === "blocked") blocker.reset();
          }}
        >
          <p>
            Leave this workspace and discard unsaved local edits? Saved server drafts are not
            deleted.
          </p>
          <button
            type="button"
            onClick={() => {
              setPendingChange(undefined);
              if (blocker.state === "blocked") blocker.reset();
            }}
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={() => {
              setUnsaved(false);
              if (pendingChange) pendingChange();
              else if (blocker.state === "blocked") blocker.proceed();
              setPendingChange(undefined);
            }}
          >
            Discard local edits and continue
          </button>
        </NoxDialog>
      ) : null}
      {tenantContextState === "loading" ? (
        <p className="nox-ai-context" role="status">
          Refreshing tenant context…
        </p>
      ) : null}
      {tenantContextState === "error" ? (
        <div>
          <p role="alert">Tenant context is unavailable.</p>
          <button type="button" onClick={() => setContextReload((value) => value + 1)}>
            Retry tenant context
          </button>
        </div>
      ) : null}
      {platformIdentity.state === "loading" ? <p role="status">Loading identity…</p> : null}
      {platformIdentity.state === "error" ? (
        <div>
          <p role="alert">Platform identity is unavailable.</p>
          <button type="button" onClick={platformIdentity.retry}>
            Retry identity
          </button>
        </div>
      ) : null}
      {hasNoWorkspace && !isPlatformOwner ? (
        <section aria-labelledby="no-workspace-title">
          <p className="nox-ai-context">NO_WORKSPACE</p>
          <h1 id="no-workspace-title">NO ACTIVE WORKSPACE AVAILABLE</h1>
          <p>This identity is authenticated but has no active tenant membership.</p>
        </section>
      ) : (
        <WorkspaceRenderBoundary key={location.pathname}>
          <Routes>
            <Route
              path="/settings/tenant"
              element={
                <Suspense fallback={<p role="status">Loading tenant settings…</p>}>
                  <LazyTenantSettingsScreen
                    key={`${session.user.id}:${activeTenant?.tenantId ?? "none"}`}
                    api={api}
                    tenantId={activeTenant?.tenantId}
                    tenantPermissions={
                      tenantContextState === "ready" &&
                      tenantContext &&
                      activeTenant &&
                      tenantContext.tenant.tenantId === activeTenant.tenantId
                        ? tenantContext.authorization.tenantPermissions
                        : []
                    }
                  />
                </Suspense>
              }
            />
            <Route
              path="/platform/tenants"
              element={
                isPlatformOwner ? (
                  <Suspense fallback={<p role="status">Loading Platform Console…</p>}>
                    <LazyPlatformTenantsScreen api={api} modules={registeredModules} />
                  </Suspense>
                ) : (
                  <PlatformConsoleDenied />
                )
              }
            />
            <Route
              path="/platform/users"
              element={
                isPlatformOwner ? (
                  <Suspense fallback={<p role="status">Loading Platform users…</p>}>
                    <LazyPlatformUsersScreen api={api} />
                  </Suspense>
                ) : (
                  <PlatformConsoleDenied />
                )
              }
            />
            <Route
              path="/platform/audit"
              element={
                isPlatformOwner ? (
                  <Suspense fallback={<p role="status">Loading Platform audit…</p>}>
                    <LazyPlatformAuditScreen api={api} />
                  </Suspense>
                ) : (
                  <PlatformConsoleDenied />
                )
              }
            />
            <Route
              path="/platform/material-intelligence/review/*"
              element={
                <Suspense fallback={<p className="nox-ai-context">Loading Material review…</p>}>
                  <LazyPlatformMaterialExperience
                    api={api}
                    platformPermissions={platformIdentity.identity?.platformPermissions ?? []}
                  />
                </Suspense>
              }
            />
            <Route
              path="/materials/*"
              element={
                <Suspense
                  fallback={<p className="nox-ai-context">Loading Material Intelligence…</p>}
                >
                  <LazyMaterialExperience
                    key={`${activeTenant?.tenantId ?? "no-workspace"}:${location.pathname}`}
                    api={api}
                    tenantId={activeTenant?.tenantId}
                    modulePermissions={tenantContext?.authorization.modulePermissions ?? []}
                  />
                </Suspense>
              }
            />
            <Route
              path="/design-studio/*"
              element={
                <Suspense fallback={<p className="nox-ai-context">Loading Design Studio…</p>}>
                  <LazyDesignStudioExperience
                    key={`${activeTenant?.tenantId ?? "no-workspace"}:${location.pathname}`}
                    api={api}
                    tenantId={activeTenant?.tenantId}
                    modulePermissions={tenantContext?.authorization.modulePermissions ?? []}
                  />
                </Suspense>
              }
            />
            <Route
              path="/trials/*"
              element={
                <Suspense fallback={<p className="nox-ai-context">Loading Trial & Sensory…</p>}>
                  <LazyTrialSensoryExperience
                    key={`${activeTenant?.tenantId ?? "no-workspace"}:${location.pathname}`}
                    api={api}
                    tenantId={activeTenant?.tenantId}
                    modulePermissions={tenantContext?.authorization.modulePermissions ?? []}
                  />
                </Suspense>
              }
            />
            <Route
              path="/inventory/*"
              element={
                <Suspense fallback={<p className="nox-ai-context">Loading Inventory…</p>}>
                  <LazyInventoryExperience
                    api={api}
                    tenantId={activeTenant?.tenantId}
                    modulePermissions={tenantContext?.authorization.modulePermissions ?? []}
                  />
                </Suspense>
              }
            />
            <Route
              path="/procurement/*"
              element={
                <Suspense fallback={<p className="nox-ai-context">Loading Procurement…</p>}>
                  <LazyProcurementExperience
                    api={api}
                    tenantId={activeTenant?.tenantId}
                    modulePermissions={tenantContext?.authorization.modulePermissions ?? []}
                  />
                </Suspense>
              }
            />
            {[
              "/production",
              "/production/new",
              "/production/orders/:orderId",
              "/production/batches/:batchId"
            ].map((path) => (
              <Route
                key={path}
                path={path}
                element={
                  <Suspense fallback={<p className="nox-ai-context">Loading Production…</p>}>
                    <LazyProductionExperience
                      api={api}
                      tenantId={activeTenant?.tenantId}
                      modulePermissions={tenantContext?.authorization.modulePermissions ?? []}
                    />
                  </Suspense>
                }
              />
            ))}
            <Route
              path="/quality-control/*"
              element={
                <Suspense fallback={<p className="nox-ai-context">Loading Quality Control…</p>}>
                  <LazyQualityControlExperience
                    api={api}
                    tenantId={activeTenant?.tenantId}
                    modulePermissions={tenantContext?.authorization.modulePermissions ?? []}
                  />
                </Suspense>
              }
            />
            <Route
              path="/project-operations/*"
              element={
                <Suspense fallback={<p className="nox-ai-context">Loading Project Operations…</p>}>
                  <LazyProjectOperationsExperience
                    api={api}
                    tenantId={activeTenant?.tenantId}
                    modulePermissions={tenantContext?.authorization.modulePermissions ?? []}
                  />
                </Suspense>
              }
            />
            <Route
              path="/commercial-orders/*"
              element={
                <Suspense fallback={<p className="nox-ai-context">Loading Commercial Orders…</p>}>
                  <LazyCommercialOrdersExperience
                    key={activeTenant?.tenantId ?? "no-workspace"}
                    api={api}
                    tenantId={activeTenant?.tenantId}
                    modulePermissions={tenantContext?.authorization.modulePermissions ?? []}
                  />
                </Suspense>
              }
            />
            <Route
              path="/lab-services/*"
              element={
                <Suspense fallback={<p className="nox-ai-context">Loading NØX Lab Services…</p>}>
                  <LazyLabServicesExperience
                    api={api}
                    tenantId={activeTenant?.tenantId}
                    modulePermissions={tenantContext?.authorization.modulePermissions ?? []}
                  />
                </Suspense>
              }
            />
            <Route
              path="/release-readiness/*"
              element={
                <Suspense fallback={<p className="nox-ai-context">Loading Release Readiness…</p>}>
                  <LazyReleaseReadinessExperience
                    api={api}
                    tenantId={activeTenant?.tenantId}
                    modulePermissions={tenantContext?.authorization.modulePermissions ?? []}
                  />
                </Suspense>
              }
            />
            <Route
              path="/material-intelligence/*"
              element={
                <Navigate
                  to={
                    location.pathname.replace(/^\/material-intelligence/, "/materials") +
                    location.search
                  }
                  replace
                />
              }
            />
            <Route
              path="/dashboard"
              element={
                <Navigate to={isPlatformOwner ? "/platform/tenants" : "/settings/tenant"} replace />
              }
            />
            {routeEntries.map((route) => (
              <Route
                key={route.definition.descriptor.id + route.path}
                path={route.path}
                element={<FoundationRoute definition={route.definition} />}
              />
            ))}
            <Route
              path="/"
              element={
                <Navigate to={isPlatformOwner ? "/platform/tenants" : "/settings/tenant"} replace />
              }
            />
            <Route
              path="*"
              element={
                <section>
                  <p className="nox-ai-context">404</p>
                  <h1>Route not registered</h1>
                  <p>Runtime routes are projected from the canonical Module Registry.</p>
                </section>
              }
            />
          </Routes>
        </WorkspaceRenderBoundary>
      )}
      <p className="nox-ai-context">
        Environment: {publicIdentity.environment} · Source: {publicIdentity.sourceSha}
      </p>
    </NoxShell>
  );
}

function SessionBoundary() {
  const configuration = useMemo(() => browserAuthConfiguration(import.meta.env), []);
  const [client, setClient] = useState<SupabaseClient | undefined>();
  const [authRuntimeReady, setAuthRuntimeReady] = useState(!configuration);
  const [authRuntimeFailed, setAuthRuntimeFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void createBrowserAuthClient(configuration)
      .then((next) => {
        if (current) setClient(next);
      })
      .catch(() => {
        // Import/network errors are not missing configuration. Never render the
        // raw exception, provider URL or stack, and never invent an Auth session.
        if (current) setAuthRuntimeFailed(true);
      })
      .finally(() => {
        if (current) setAuthRuntimeReady(true);
      });
    return () => {
      current = false;
    };
  }, [configuration]);
  const state = useSession(client, Boolean(configuration) && !authRuntimeReady);
  if (authRuntimeFailed) return <ApplicationLoadError authentication />;
  if (state.kind === "loading")
    return (
      <AuthenticationFoundation>
        <main className="nox-auth-page" aria-busy="true">
          Restoring secure session…
        </main>
      </AuthenticationFoundation>
    );
  return (
    <Routes>
      <Route
        path="/sign-in"
        element={
          state.kind === "authenticated" ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <AuthenticationFoundation>
              <SignIn client={client} />
            </AuthenticationFoundation>
          )
        }
      />
      <Route
        path="*"
        element={
          state.kind === "authenticated" ? (
            <Suspense
              fallback={
                <AuthenticationFoundation>
                  <main className="nox-auth-page" aria-busy="true">
                    <p role="status">Loading workspace shell…</p>
                  </main>
                </AuthenticationFoundation>
              }
            >
              <AuthenticatedApplication client={client!} session={state.session} />
            </Suspense>
          ) : (
            <Navigate to="/sign-in" replace />
          )
        }
      />
    </Routes>
  );
}

export function App() {
  const [router] = useState(() =>
    createBrowserRouter([
      { path: "*", element: <SessionBoundary />, errorElement: <ApplicationLoadError /> }
    ])
  );
  return <RouterProvider router={router} />;
}
