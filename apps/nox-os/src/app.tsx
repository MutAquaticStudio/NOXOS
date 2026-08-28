import { lazy, Suspense, useMemo, useState } from "react";
import {
  BrowserRouter,
  matchPath,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate
} from "react-router-dom";
import type { ModuleDefinition, ModuleUxDensity } from "@nox-os/contracts";
import { publicEnvironment } from "@nox-os/config";
import {
  projectAppRail,
  resolveModuleAvailability,
  validateModuleDefinitions
} from "@nox-os/module-registry";
import { NoxShell, type NoxDensity, type NoxTheme } from "@nox-os/ui";
import { moduleDefinitions } from "./modules/definitions";

const LazyFoundationModule = lazy(async () => {
  const module = await import("./modules/foundation-module");
  return { default: module.FoundationModuleSurface };
});

const publicIdentity = publicEnvironment({
  VITE_NOX_ENV: import.meta.env.VITE_NOX_ENV,
  VITE_NOX_SOURCE_SHA: import.meta.env.VITE_NOX_SOURCE_SHA,
  VITE_TURNSTILE_SITE_KEY: import.meta.env.VITE_TURNSTILE_SITE_KEY
});

function FoundationRoute({ definition }: { definition: ModuleDefinition }) {
  return (
    <Suspense fallback={<p>Loading module foundation…</p>}>
      <LazyFoundationModule descriptor={definition.descriptor} />
    </Suspense>
  );
}

function toShellDensity(density: ModuleUxDensity): NoxDensity {
  switch (density) {
    case "compact":
      return "COMPACT";
    case "comfortable":
      return "COMFORTABLE";
    default:
      return "DEFAULT";
  }
}

function NoxApplication() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme] = useState<NoxTheme>("SYSTEM");

  const availabilityInputs = useMemo(
    () => ({
      featureFlags: new Set(
        moduleDefinitions
          .map((definition) => definition.descriptor.featureFlag)
          .filter((value): value is string => Boolean(value))
      ),
      entitlements: new Set(
        moduleDefinitions
          .map((definition) => definition.descriptor.entitlement)
          .filter((value): value is string => Boolean(value))
      ),
      permissions: new Set(
        moduleDefinitions.flatMap((definition) => definition.descriptor.permissions)
      )
    }),
    []
  );

  const appRail = useMemo(() => {
    validateModuleDefinitions(moduleDefinitions);
    return projectAppRail(moduleDefinitions, availabilityInputs);
  }, [availabilityInputs]);

  const enabledDefinitions = useMemo(
    () =>
      moduleDefinitions.filter(
        (definition) => resolveModuleAvailability(definition.descriptor, availabilityInputs).enabled
      ),
    [availabilityInputs]
  );
  const routeEntries = useMemo(
    () =>
      enabledDefinitions.flatMap((definition) => [
        { path: definition.descriptor.routeRoot, definition },
        ...definition.descriptor.childRoutes.map((path) => ({ path, definition }))
      ]),
    [enabledDefinitions]
  );
  const activeDefinition = routeEntries.find((route) =>
    matchPath({ path: route.path, end: true }, location.pathname)
  )?.definition;
  const density = activeDefinition ? toShellDensity(activeDefinition.uxProfile.density) : "DEFAULT";

  return (
    <NoxShell
      theme={theme}
      density={density}
      railItems={appRail}
      activeRoute={location.pathname}
      onNavigate={navigate}
    >
      <Routes>
        {routeEntries.map((route) => (
          <Route
            key={route.definition.descriptor.id + route.path}
            path={route.path}
            element={<FoundationRoute definition={route.definition} />}
          />
        ))}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
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
      <p className="nox-ai-context">
        Environment: {publicIdentity.environment} · Source: {publicIdentity.sourceSha}
      </p>
    </NoxShell>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <NoxApplication />
    </BrowserRouter>
  );
}
