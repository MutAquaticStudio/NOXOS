import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  BrowserRouter,
  matchPath,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate
} from "react-router-dom";
import type {
  ModuleAvailability,
  ModuleDefinition,
  ModuleUxDensity,
  TenantRoleKey
} from "@nox-os/contracts";
import { publicEnvironment } from "@nox-os/config";
import { projectAppRail, validateModuleDefinitions } from "@nox-os/module-registry";
import { NoxShell, type NoxDensity, type NoxTheme } from "@nox-os/ui";
import { browserAuthConfiguration, createBrowserAuthClient } from "./auth-client";
import { moduleDefinitions } from "./modules/definitions";
import {
  PlatformAuditScreen,
  PlatformTenantsScreen,
  PlatformUsersScreen,
  TenantSettingsScreen,
  NoxApiError,
  type ApiClient
} from "./platform-control";

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

const publicIdentity = publicEnvironment({
  VITE_NOX_ENV: import.meta.env.VITE_NOX_ENV,
  VITE_NOX_SOURCE_SHA: import.meta.env.VITE_NOX_SOURCE_SHA,
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
});

type SessionState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "authenticated"; session: Session }
  | { kind: "unconfigured" };

type TenantChoice = { tenantId: string; name: string; slug: string; roleKey: TenantRoleKey };
type TenantContextPayload = {
  tenant: { tenantId: string; roleKey: TenantRoleKey };
  authorization: { tenantPermissions: string[]; modulePermissions: string[] };
  entitlements: string[];
  moduleAvailability: ModuleAvailability[];
};
type PlatformIdentity = {
  id: string;
  displayName: string | null;
  status: "ACTIVE" | "DISABLED";
  platformRoleKey: "PLATFORM_OWNER" | null;
  platformPermissions: string[];
};

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
  useEffect(() => {
    let current = true;
    setState("loading");
    setActiveTenantId(undefined);
    void fetch("/api/v1/me/tenants", {
      headers: { authorization: `Bearer ${session.access_token}` }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Tenant lookup failed.");
        const payload = (await response.json()) as {
          tenants?: Array<{ roleKey: string; tenant: { id: string; name: string; slug: string } }>;
        };
        return (payload.tenants ?? []).map((item) => ({
          tenantId: item.tenant.id,
          name: item.tenant.name,
          slug: item.tenant.slug,
          roleKey: item.roleKey as TenantRoleKey
        }));
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
  }, [session.access_token]);
  return { choices, activeTenantId, setActiveTenantId, state };
}

function usePlatformIdentity(session: Session) {
  const [identity, setIdentity] = useState<PlatformIdentity>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let current = true;
    setState("loading");
    void fetch("/api/v1/me", { headers: { authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Identity lookup failed.");
        return (await response.json()) as { user: PlatformIdentity };
      })
      .then((payload) => {
        if (!current) return;
        setIdentity(payload.user);
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
  }, [session.access_token]);
  return { identity, state };
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
  const [theme] = useState<NoxTheme>("SYSTEM");
  const tenantSelection = useTenantChoices(session);
  const platformIdentity = usePlatformIdentity(session);
  const activeTenant = tenantSelection.choices.find(
    (tenant) => tenant.tenantId === tenantSelection.activeTenantId
  );
  const [tenantContextState, setTenantContextState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [tenantContext, setTenantContext] = useState<TenantContextPayload>();
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
    void api<TenantContextPayload>("/context", { tenantId: activeTenant.tenantId })
      .then((payload) => {
        if (!current) return;
        setTenantContext(payload);
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
  }, [activeTenant?.tenantId, api]);
  const appRail = useMemo(() => {
    validateModuleDefinitions(moduleDefinitions);
    return projectAppRail(moduleDefinitions, tenantContext?.moduleAvailability ?? []);
  }, [tenantContext]);
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
            definition.descriptor.id !== "quality-control"
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
                  : undefined);
  const density = activeDefinition ? toShellDensity(activeDefinition.uxProfile.density) : "DEFAULT";
  const isPlatformOwner = platformIdentity.identity?.platformRoleKey === "PLATFORM_OWNER";
  const hasNoWorkspace = tenantSelection.state === "ready" && tenantSelection.choices.length === 0;
  const registeredModules = moduleDefinitions.map((definition) => ({
    id: definition.descriptor.id,
    displayName: definition.descriptor.displayName
  }));
  const tenantControl =
    tenantSelection.state === "loading" ? (
      <span>Loading tenants…</span>
    ) : tenantSelection.state === "error" ? (
      <span>Tenant context unavailable</span>
    ) : tenantSelection.choices.length === 0 ? (
      <span>No active workspace</span>
    ) : (
      <label className="nox-tenant-selector">
        <span className="sr-only">Current tenant</span>
        <select
          value={tenantSelection.activeTenantId ?? ""}
          onChange={(event) => tenantSelection.setActiveTenantId(event.target.value || undefined)}
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
      theme={theme}
      density={density}
      railItems={appRail}
      activeRoute={location.pathname}
      onNavigate={navigate}
      identityLabel={session.user.email ?? "Signed-in user"}
      onSignOut={() => {
        void client.auth.signOut();
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
      {hasNoWorkspace && !isPlatformOwner ? (
        <section aria-labelledby="no-workspace-title">
          <p className="nox-ai-context">NO_WORKSPACE</p>
          <h1 id="no-workspace-title">NO ACTIVE WORKSPACE AVAILABLE</h1>
          <p>This identity is authenticated but has no active tenant membership.</p>
        </section>
      ) : (
        <Routes>
          <Route
            path="/settings/tenant"
            element={
              <TenantSettingsScreen
                api={api}
                tenantId={activeTenant?.tenantId}
                tenantRole={tenantContext?.tenant.roleKey ?? activeTenant?.roleKey}
              />
            }
          />
          <Route
            path="/platform/tenants"
            element={
              isPlatformOwner ? (
                <PlatformTenantsScreen api={api} modules={registeredModules} />
              ) : (
                <PlatformConsoleDenied />
              )
            }
          />
          <Route
            path="/platform/users"
            element={
              isPlatformOwner ? <PlatformUsersScreen api={api} /> : <PlatformConsoleDenied />
            }
          />
          <Route
            path="/platform/audit"
            element={
              isPlatformOwner ? <PlatformAuditScreen api={api} /> : <PlatformConsoleDenied />
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
              <Suspense fallback={<p className="nox-ai-context">Loading Material Intelligence…</p>}>
                <LazyMaterialExperience
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
      )}
      {tenantContextState === "loading" ? (
        <p className="nox-ai-context">Refreshing tenant context…</p>
      ) : null}
      {tenantContextState === "error" ? <p role="alert">Tenant context is unavailable.</p> : null}
      {platformIdentity.state === "error" ? (
        <p role="alert">Platform identity is unavailable.</p>
      ) : null}
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
  useEffect(() => {
    let current = true;
    void createBrowserAuthClient(configuration)
      .then((next) => {
        if (current) setClient(next);
      })
      .finally(() => {
        if (current) setAuthRuntimeReady(true);
      });
    return () => {
      current = false;
    };
  }, [configuration]);
  const state = useSession(client, Boolean(configuration) && !authRuntimeReady);
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
            <AuthenticatedApplication client={client!} session={state.session} />
          ) : (
            <Navigate to="/sign-in" replace />
          )
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <SessionBoundary />
    </BrowserRouter>
  );
}
