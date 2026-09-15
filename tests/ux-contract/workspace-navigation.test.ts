import { expect, it } from "vitest";
import {
  isTrialViewOnlyNavigation,
  resolveWorkspaceObjectRoute
} from "../../apps/nox-os/src/workspace-navigation";

it("restores only known object deep links under currently available module roots", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const cases = [
    ["Material", "material-intelligence", "/materials", ""],
    ["FormulaVersion", "design-studio", "/design-studio", "formula-versions/"],
    ["Trial", "trial-sensory", "/trials", ""],
    ["ReleaseAssessment", "release-readiness", "/release-readiness", ""],
    ["MaterialLot", "inventory", "/inventory", "lots/"],
    ["ProductionOrder", "production", "/production", "orders/"],
    ["ProductionBatch", "production", "/production", "batches/"],
    ["QCSpecification", "quality-control", "/quality-control", "specifications/"],
    ["QCInspection", "quality-control", "/quality-control", "inspections/"],
    ["Customer", "lab-services", "/lab-services", "customers/"],
    ["ServiceOrder", "lab-services", "/lab-services", "service-orders/"],
    ["OperationalProject", "project-operations", "/project-operations", "projects/"],
    ["CommercialQuote", "commercial-orders", "/commercial-orders", "quotes/"],
    ["CommercialOrder", "commercial-orders", "/commercial-orders", ""]
  ];
  for (const [type, moduleId, routeRoot, segment] of cases) {
    const available = [{ moduleId, routeRoot }];
    expect(resolveWorkspaceObjectRoute(available, type, id)).toBe(`${routeRoot}/${segment}${id}`);
    expect(resolveWorkspaceObjectRoute([], type, id)).toBeUndefined();
    expect(
      resolveWorkspaceObjectRoute([{ moduleId: "other", routeRoot }], type, id)
    ).toBeUndefined();
    for (const invalid of ["new", "../settings", `${id}?tenant=other`, "https://example.com"])
      expect(resolveWorkspaceObjectRoute(available, type, invalid)).toBeUndefined();
    expect(resolveWorkspaceObjectRoute(available, "Unknown", id)).toBeUndefined();
  }
});

it("preserves drafts only for same-Trial presentation changes, never another authority/context", () => {
  const current = {
    pathname: "/trials/11111111-1111-4111-8111-111111111111",
    search: "?view=preparation",
    hash: ""
  };
  expect(isTrialViewOnlyNavigation(current, { ...current, search: "?view=sensory" })).toBe(true);
  expect(isTrialViewOnlyNavigation(current, { ...current, search: "" })).toBe(true);
  for (const next of [
    { ...current, pathname: "/trials/22222222-2222-4222-8222-222222222222" },
    { ...current, search: "?view=sensory&tenantId=other" },
    { ...current, search: "?view=unknown" },
    { ...current, hash: "#other" },
    { ...current, pathname: "/materials/11111111-1111-4111-8111-111111111111" }
  ])
    expect(isTrialViewOnlyNavigation(current, next)).toBe(false);
});
