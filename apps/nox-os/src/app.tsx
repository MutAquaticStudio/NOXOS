import { lazy, Suspense, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { publicEnvironment } from "@nox-os/config";
import { projectAppRail, validateModuleDefinitions } from "@nox-os/module-registry";
import { NoxShell, type NoxDensity, type NoxTheme } from "@nox-os/ui";
import { moduleDefinitions } from "./modules/definitions";

const LazyFoundationModule = lazy(async () => {
  const module = await import("./modules/foundation-module");
  return { default: module.FoundationModuleSurface };
});

const publicIdentity = publicEnvironment(import.meta.env);

function FoundationRoute({ moduleId }: { moduleId: string }) {
  const definition = moduleDefinitions.find((candidate) => candidate.descriptor.id === moduleId);

  if (!definition) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Suspense fallback={<p>Loading module foundation…</p>}>
      <LazyFoundationModule descriptor={definition.descriptor} />
    </Suspense>
  );
}

function NoxApplication() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme] = useState<NoxTheme>("SYSTEM");
  const [density] = useState<NoxDensity>("DEFAULT");

  const appRail = useMemo(() => {
    validateModuleDefinitions(moduleDefinitions);
    return projectAppRail(moduleDefinitions, {
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
    });
  }, []);

  const routeEntries = moduleDefinitions.flatMap((definition) => [
    { path: definition.descriptor.routeRoot, moduleId: definition.descriptor.id },
    ...definition.descriptor.childRoutes.map((path) => ({
      path,
      moduleId: definition.descriptor.id
    }))
  ]);

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
            key={route.moduleId + route.path}
            path={route.path}
            element={<FoundationRoute moduleId={route.moduleId} />}
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
