type RouteLocation = { pathname: string; search: string; hash: string };

/** Presentation deep links only. Module availability/roots still come from App Rail. */
export function resolveWorkspaceObjectRoute(
  availableModules: readonly { moduleId: string; routeRoot: string }[],
  type: string,
  id: string
): string | undefined {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined;
  let moduleId: string,
    segment = "";
  switch (type) {
    case "Material":
      moduleId = "material-intelligence";
      break;
    case "FormulaVersion":
      moduleId = "design-studio";
      segment = "formula-versions/";
      break;
    case "Trial":
      moduleId = "trial-sensory";
      break;
    case "ReleaseAssessment":
      moduleId = "release-readiness";
      break;
    case "MaterialLot":
      moduleId = "inventory";
      segment = "lots/";
      break;
    case "ProductionOrder":
      moduleId = "production";
      segment = "orders/";
      break;
    case "ProductionBatch":
      moduleId = "production";
      segment = "batches/";
      break;
    case "QCSpecification":
      moduleId = "quality-control";
      segment = "specifications/";
      break;
    case "QCInspection":
      moduleId = "quality-control";
      segment = "inspections/";
      break;
    case "Customer":
      moduleId = "lab-services";
      segment = "customers/";
      break;
    case "ServiceOrder":
      moduleId = "lab-services";
      segment = "service-orders/";
      break;
    case "OperationalProject":
      moduleId = "project-operations";
      segment = "projects/";
      break;
    case "CommercialQuote":
      moduleId = "commercial-orders";
      segment = "quotes/";
      break;
    case "CommercialOrder":
      moduleId = "commercial-orders";
      break;
    default:
      return undefined;
  }
  const root = availableModules.find((item) => item.moduleId === moduleId)?.routeRoot;
  return root ? `${root}/${segment}${id}` : undefined;
}

/** Both G5 panels stay mounted: changing only their view cannot discard the draft. */
export function isTrialViewOnlyNavigation(current: RouteLocation, next: RouteLocation): boolean {
  if (
    current.pathname !== next.pathname ||
    current.hash !== next.hash ||
    !/^\/trials\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      current.pathname
    )
  )
    return false;
  const before = new URLSearchParams(current.search),
    after = new URLSearchParams(next.search);
  if (
    ![before.get("view"), after.get("view")].every(
      (view) => view === null || view === "preparation" || view === "sensory"
    )
  )
    return false;
  before.delete("view");
  after.delete("view");
  return before.toString() === after.toString();
}
