import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import { NoxApiError, type ApiClient } from "./platform-control";

const MATERIAL_PERMISSION = {
  read: "module.material-intelligence.material.read",
  create: "module.material-intelligence.material.create",
  requestChange: "module.material-intelligence.material.request-change",
  approve: "module.material-intelligence.material.approve",
  share: "module.material-intelligence.material.share"
} as const;

const PLATFORM_MATERIAL_PERMISSION = {
  read: "module.material-intelligence.reference.read",
  approve: "module.material-intelligence.review.approve"
} as const;

type MaterialType = "SINGLE_MOLECULE" | "NATURAL" | "MIXTURE" | "DILUTION";
type ApprovalStatus = "PENDING_REVIEW" | "APPROVED";
type RegistryView = "REGISTRY" | "MY_TENANT" | "SHARED";
type ReferenceMaterial = { id: string; displayName: string };
type TaxonomyData = {
  GRAND_FAMILIES: string[];
  SUBFAMILIES: string[];
  DESCRIPTORS: string[];
  TEXTURES: string[];
  SENSATIONS: string[];
  SUB_TO_GRAND: Record<string, string>;
};
type MaterialIdentifier = { identifierType: "CAS" | "FEMA" | "INCI"; value: string };
type OdorAssignment = {
  taxonomyVersion: string;
  assignmentType: "GRAND_FAMILY" | "SUBFAMILY" | "DESCRIPTOR" | "TEXTURE" | "SENSATION";
  taxonomyTerm: string;
  intensity?: number | null;
};
type MaterialDetail = {
  id: string;
  tenantId: string | null;
  scope: "PLATFORM" | "TENANT";
  visibility: "PRIVATE" | "SHARED";
  displayName: string;
  materialType: MaterialType;
  approvalStatus: ApprovalStatus;
  noteClassification: "TOP" | "MID" | "BASE" | null;
  contributor: {
    tenantId: string | null;
    tenantName?: string;
    userId?: string;
    userDisplayName?: string;
  };
  approval: { authority: "TENANT" | "PLATFORM" | null; approvedByUserId?: string };
  identifiers: MaterialIdentifier[];
  properties: Record<string, unknown> | null;
  odorAssignments: OdorAssignment[];
  concentrate: {
    sourceMaterialId: string;
    concentrationPct: number;
    solventMaterialId: string | null;
    solventCustomName: string | null;
  } | null;
  components: Array<{
    componentMaterialId: string;
    percentage: number | null;
    role: "COMPONENT" | "TRACE";
  }>;
};
type ChangeRequest = {
  id: string;
  materialId: string;
  tenantId: string | null;
  requestType:
    "CREATE" | "IDENTITY" | "PHYSICAL" | "OLFACTIVE" | "DILUTION" | "COMPONENTS" | "GENERAL";
  proposedPatch: Record<string, unknown>;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  reviewedByAuthority: "TENANT" | "PLATFORM" | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
};
type HistoryEvent = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorUserId?: string | null;
  createdAt: string;
};
type TgscReference = {
  state?: "UNAVAILABLE" | "NOT_FOUND";
  message?: string;
  source?: string;
  values?: Record<string, unknown>;
  referenceUrl?: string;
};
type IdentityResolution =
  | { kind: "NO_MATCH" }
  | { kind: "EXACT_MATCH"; materialId: string; matchedBy: string }
  | { kind: "POSSIBLE_MATCH"; materialIds: string[]; matchedBy: string };

export type MaterialExperienceProps = {
  api: ApiClient;
  tenantId?: string;
  modulePermissions: readonly string[];
};

export type PlatformMaterialExperienceProps = {
  api: ApiClient;
  platformPermissions: readonly string[];
};

function hasPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.includes(permission);
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The requested Material operation could not be completed.";
}

function displayType(type: MaterialType): string {
  return type
    .toLocaleLowerCase("en-US")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    if (candidate.value !== undefined) return String(candidate.value);
    return Object.entries(candidate)
      .map(([key, nested]) => key + ": " + String(nested))
      .join(" · ");
  }
  return String(value);
}

function editableText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "value" in value)
    return String((value as { value: unknown }).value);
  return typeof value === "boolean" ? "" : String(value);
}

function ErrorNotice({ error }: { error?: string }) {
  return error ? (
    <p className="nox-material-error" role="alert">
      {error}
    </p>
  ) : null;
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="nox-material-empty" aria-label={title}>
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

function PermissionDenied({ title = "Material Intelligence access denied" }: { title?: string }) {
  return (
    <section className="nox-material-empty" aria-labelledby="material-access-denied-title">
      <p className="nox-ai-context">403</p>
      <h1 id="material-access-denied-title">{title}</h1>
      <p>Your current tenant context does not grant this Material Intelligence action.</p>
    </section>
  );
}

function TenantRequired() {
  return (
    <section className="nox-material-empty" aria-labelledby="material-tenant-required-title">
      <p className="nox-ai-context">TENANT_CONTEXT_REQUIRED</p>
      <h1 id="material-tenant-required-title">Select an active tenant workspace</h1>
      <p>Material Intelligence is always evaluated inside the current tenant context.</p>
    </section>
  );
}

function useTaxonomy(api: ApiClient, tenantId?: string) {
  const [taxonomy, setTaxonomy] = useState<TaxonomyData>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!tenantId) return;
    let current = true;
    void api<{ taxonomy: TaxonomyData }>("/materials/taxonomy?version=1.2", { tenantId })
      .then((payload) => current && setTaxonomy(payload.taxonomy))
      .catch((reason) => current && setError(message(reason)));
    return () => {
      current = false;
    };
  }, [api, tenantId]);
  return { taxonomy, error };
}

function MaterialReferencePicker({
  api,
  tenantId,
  label,
  value,
  onChange,
  allowClear = true
}: {
  api: ApiClient;
  tenantId: string;
  label: string;
  value: ReferenceMaterial | null;
  onChange: (value: ReferenceMaterial | null) => void;
  allowClear?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<MaterialDetail[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (query.trim().length < 2) {
      setMatches([]);
      return;
    }
    let current = true;
    const encoded = new URLSearchParams({ query: query.trim(), limit: "8", offset: "0" });
    void api<{ materials: MaterialDetail[] }>("/materials?" + encoded, { tenantId })
      .then((payload) => current && setMatches(payload.materials))
      .catch((reason) => current && setError(message(reason)));
    return () => {
      current = false;
    };
  }, [api, query, tenantId]);
  return (
    <fieldset className="nox-material-reference-picker">
      <legend>{label}</legend>
      {value ? (
        <div className="nox-material-selected-reference">
          <span>{value.displayName}</span>
          {allowClear ? (
            <button type="button" onClick={() => onChange(null)} aria-label={`Clear ${label}`}>
              Clear
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <label>
            <span className="sr-only">Search {label}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Material registry…"
            />
          </label>
          {matches.length > 0 ? (
            <ul className="nox-material-reference-results" aria-label={`${label} search results`}>
              {matches.map((match) => (
                <li key={match.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ id: match.id, displayName: match.displayName });
                      setQuery("");
                      setMatches([]);
                    }}
                  >
                    <strong>{match.displayName}</strong>
                    <span>
                      {displayType(match.materialType)} · {match.approvalStatus}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <ErrorNotice error={error} />
    </fieldset>
  );
}

function RegistryTabs({
  view,
  canReview,
  onChange
}: {
  view: RegistryView;
  canReview: boolean;
  onChange: (view: RegistryView) => void;
}) {
  return (
    <div className="nox-material-tabs" role="tablist" aria-label="Material registry views">
      {(
        [
          ["REGISTRY", "Registry"],
          ["MY_TENANT", "My Tenant"],
          ["SHARED", "Shared"]
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={view === key}
          className={view === key ? "is-active" : undefined}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
      {canReview ? <Link to="/materials/review">Review</Link> : null}
    </div>
  );
}

function Registry({ api, tenantId, modulePermissions }: MaterialExperienceProps) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { taxonomy } = useTaxonomy(api, tenantId);
  const [materials, setMaterials] = useState<MaterialDetail[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>();
  const view = (params.get("view") as RegistryView | null) ?? "REGISTRY";
  const canCreate = hasPermission(modulePermissions, MATERIAL_PERMISSION.create);
  const canReview = hasPermission(modulePermissions, MATERIAL_PERMISSION.approve);
  const query = params.get("q") ?? "";
  const materialType = params.get("type") ?? "";
  const approvalStatus = params.get("status") ?? "";
  const scope = params.get("scope") ?? "";
  const visibility = params.get("visibility") ?? "";
  const noteClassification = params.get("note") ?? "";
  const taxonomyAssignmentType = params.get("taxonomyType") ?? "";
  const taxonomyTerm = params.get("taxonomyTerm") ?? "";

  const taxonomyTerms =
    taxonomyAssignmentType === "GRAND_FAMILY"
      ? (taxonomy?.GRAND_FAMILIES ?? [])
      : taxonomyAssignmentType === "SUBFAMILY"
        ? (taxonomy?.SUBFAMILIES ?? [])
        : taxonomyAssignmentType === "DESCRIPTOR"
          ? (taxonomy?.DESCRIPTORS ?? [])
          : taxonomyAssignmentType === "TEXTURE"
            ? (taxonomy?.TEXTURES ?? [])
            : taxonomyAssignmentType === "SENSATION"
              ? (taxonomy?.SENSATIONS ?? [])
              : [];

  const queryString = useMemo(() => {
    const search = new URLSearchParams({ limit: "50", offset: "0" });
    if (query) search.set("query", query);
    if (view !== "REGISTRY") search.set("view", view);
    if (materialType) search.set("materialType", materialType);
    if (approvalStatus) search.set("approvalStatus", approvalStatus);
    if (scope) search.set("scope", scope);
    if (visibility) search.set("visibility", visibility);
    if (noteClassification) search.set("noteClassification", noteClassification);
    if (taxonomyAssignmentType && taxonomyTerm) {
      search.set("taxonomyAssignmentType", taxonomyAssignmentType);
      search.set("taxonomyTerm", taxonomyTerm);
      search.set("taxonomyVersion", "1.2");
    }
    return search.toString();
  }, [
    approvalStatus,
    materialType,
    noteClassification,
    query,
    scope,
    taxonomyAssignmentType,
    taxonomyTerm,
    view,
    visibility
  ]);

  useEffect(() => {
    if (!tenantId) return;
    let current = true;
    setState("loading");
    setError(undefined);
    void api<{ materials: MaterialDetail[] }>("/materials?" + queryString, { tenantId })
      .then((payload) => {
        if (!current) return;
        setMaterials(payload.materials);
        setState("ready");
      })
      .catch((reason) => {
        if (!current) return;
        setError(message(reason));
        setState("error");
      });
    return () => {
      current = false;
    };
  }, [api, queryString, tenantId]);

  if (!tenantId) return <TenantRequired />;
  if (!hasPermission(modulePermissions, MATERIAL_PERMISSION.read)) return <PermissionDenied />;

  const update = (next: Record<string, string | undefined>) => {
    const nextParams = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) nextParams.set(key, value);
      else nextParams.delete(key);
    }
    if (next.view !== undefined && next.view !== "REGISTRY") nextParams.set("view", next.view);
    if (next.view === "REGISTRY") nextParams.delete("view");
    setParams(nextParams, { replace: true });
  };

  return (
    <section className="nox-material-registry" aria-labelledby="material-registry-title">
      <header className="nox-section-heading">
        <div>
          <p className="nox-ai-context">Material Intelligence / Registry</p>
          <h1 id="material-registry-title">Material registry</h1>
          <p>Find, inspect, and govern canonical Material references.</p>
        </div>
        {canCreate ? (
          <Link className="nox-material-primary-action" to="/materials/new">
            + Add Material
          </Link>
        ) : null}
      </header>
      <label className="nox-material-search">
        <span className="sr-only">Search name, CAS, FEMA, or INCI</span>
        <input
          value={query}
          onChange={(event) => update({ q: event.target.value || undefined })}
          placeholder="Search name, CAS, FEMA, INCI…"
        />
      </label>
      <RegistryTabs view={view} canReview={canReview} onChange={(next) => update({ view: next })} />
      <div className="nox-material-filters" aria-label="Material registry filters">
        <label>
          Type
          <select
            value={materialType}
            onChange={(event) => update({ type: event.target.value || undefined })}
          >
            <option value="">All types</option>
            <option value="SINGLE_MOLECULE">Single Molecule</option>
            <option value="NATURAL">Natural</option>
            <option value="MIXTURE">Mixture</option>
            <option value="DILUTION">Dilution</option>
          </select>
        </label>
        <label>
          Status
          <select
            value={approvalStatus}
            onChange={(event) => update({ status: event.target.value || undefined })}
          >
            <option value="">All states</option>
            <option value="PENDING_REVIEW">Pending review</option>
            <option value="APPROVED">Approved</option>
          </select>
        </label>
        <label>
          Scope
          <select
            value={scope}
            onChange={(event) => update({ scope: event.target.value || undefined })}
          >
            <option value="">All scopes</option>
            <option value="PLATFORM">Platform</option>
            <option value="TENANT">Tenant</option>
          </select>
        </label>
        <label>
          Visibility
          <select
            value={visibility}
            onChange={(event) => update({ visibility: event.target.value || undefined })}
          >
            <option value="">All visibility</option>
            <option value="PRIVATE">Private</option>
            <option value="SHARED">Shared</option>
          </select>
        </label>
        <label>
          Note
          <select
            value={noteClassification}
            onChange={(event) => update({ note: event.target.value || undefined })}
          >
            <option value="">All notes</option>
            <option value="TOP">Top</option>
            <option value="MID">Mid</option>
            <option value="BASE">Base</option>
          </select>
        </label>
        <label>
          Taxonomy
          <select
            value={taxonomyAssignmentType}
            onChange={(event) =>
              update({ taxonomyType: event.target.value || undefined, taxonomyTerm: undefined })
            }
          >
            <option value="">No taxonomy filter</option>
            <option value="GRAND_FAMILY">Grand family</option>
            <option value="SUBFAMILY">Subfamily</option>
            <option value="DESCRIPTOR">Descriptor</option>
            <option value="TEXTURE">Texture</option>
            <option value="SENSATION">Sensation</option>
          </select>
        </label>
        {taxonomyAssignmentType ? (
          <label>
            Term
            <select
              value={taxonomyTerm}
              onChange={(event) => update({ taxonomyTerm: event.target.value || undefined })}
            >
              <option value="">Select canonical term</option>
              {taxonomyTerms.map((term) => (
                <option key={term} value={term}>
                  {term}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <ErrorNotice error={error} />
      {state === "loading" ? <p className="nox-ai-context">Loading Material registry…</p> : null}
      {state === "ready" && materials.length === 0 ? (
        <EmptyState title="No Materials found.">
          Adjust the search or filters, or add a new Material.
        </EmptyState>
      ) : null}
      {materials.length > 0 ? (
        <div className="nox-table-wrap" tabIndex={0}>
          <table className="nox-material-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Primary identifier</th>
                <th>Type</th>
                <th>Representative odor</th>
                <th>Status</th>
                <th>Scope</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((material) => {
                const primary =
                  material.identifiers.find((identifier) => identifier.identifierType === "CAS") ??
                  material.identifiers[0];
                const odor = material.odorAssignments.find(
                  (assignment) => assignment.assignmentType === "GRAND_FAMILY"
                );
                return (
                  <tr
                    key={material.id}
                    className="nox-material-row"
                    tabIndex={0}
                    onClick={() => navigate("/materials/" + material.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate("/materials/" + material.id);
                      }
                    }}
                  >
                    <td>
                      <strong>{material.displayName}</strong>
                    </td>
                    <td>{primary ? `${primary.identifierType} ${primary.value}` : "—"}</td>
                    <td>{displayType(material.materialType)}</td>
                    <td>{odor?.taxonomyTerm ?? "—"}</td>
                    <td>
                      <span
                        className={`nox-material-status is-${material.approvalStatus.toLowerCase()}`}
                      >
                        {material.approvalStatus === "PENDING_REVIEW"
                          ? "Pending review"
                          : "Approved"}
                      </span>
                    </td>
                    <td>
                      {material.scope === "PLATFORM"
                        ? "Platform"
                        : material.visibility === "SHARED"
                          ? "Shared"
                          : "Tenant"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="nox-material-detail-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function DefinitionGrid({ values }: { values: Array<[string, unknown]> }) {
  return (
    <dl className="nox-definition-list">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function MaterialChangeRequestForm({
  api,
  tenantId,
  material,
  canShare,
  onSubmitted
}: {
  api: ApiClient;
  tenantId: string;
  material: MaterialDetail;
  canShare: boolean;
  onSubmitted: () => void;
}) {
  const [requestType, setRequestType] = useState<"GENERAL" | "IDENTITY" | "PHYSICAL" | "OLFACTIVE">(
    "GENERAL"
  );
  const [displayName, setDisplayName] = useState(material.displayName);
  const [properties, setProperties] = useState<Record<string, unknown>>({
    ...(material.properties ?? {})
  });
  const [note, setNote] = useState(material.noteClassification ?? "");
  const [share, setShare] = useState(false);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const setProperty = (key: string, value: unknown) =>
    setProperties((current) => ({ ...current, [key]: value }));
  const setMeasurement = (key: string, value: string) =>
    setProperty(key, value.trim() ? { value: Number(value) } : null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      let body: Record<string, unknown>;
      if (requestType === "IDENTITY") body = { requestType, displayName };
      else if (requestType === "PHYSICAL") body = { requestType, properties };
      else if (requestType === "OLFACTIVE")
        body = { requestType, noteClassification: note || null };
      else body = { requestType, displayName, ...(share ? { visibility: "SHARED" } : {}) };
      await api(`/materials/${material.id}/change-requests`, { method: "POST", body, tenantId });
      onSubmitted();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <form className="nox-material-change-form" onSubmit={submit}>
      <label>
        Change area
        <select
          value={requestType}
          onChange={(event) => setRequestType(event.target.value as typeof requestType)}
        >
          <option value="GENERAL">General</option>
          <option value="IDENTITY">Identity</option>
          <option value="PHYSICAL">Physical &amp; safety</option>
          <option value="OLFACTIVE">Olfactive</option>
        </select>
      </label>
      {requestType === "GENERAL" || requestType === "IDENTITY" ? (
        <label>
          Material name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </label>
      ) : null}
      {requestType === "PHYSICAL" ? (
        <div className="nox-material-form-grid">
          <label>
            Appearance
            <input
              value={editableText(properties.appearance)}
              onChange={(event) => setProperty("appearance", event.target.value || null)}
            />
          </label>
          <label>
            Assay
            <input
              value={editableText(properties.assay)}
              onChange={(event) => setProperty("assay", event.target.value || null)}
            />
          </label>
          <label>
            Specific gravity
            <input
              type="number"
              step="any"
              value={editableText(properties.specificGravity)}
              onChange={(event) => setMeasurement("specificGravity", event.target.value)}
            />
          </label>
          <label>
            Pounds per gallon
            <input
              type="number"
              step="any"
              value={editableText(properties.poundsPerGallon)}
              onChange={(event) => setMeasurement("poundsPerGallon", event.target.value)}
            />
          </label>
          <label>
            Refractive index
            <input
              type="number"
              step="any"
              value={editableText(properties.refractiveIndex)}
              onChange={(event) => setMeasurement("refractiveIndex", event.target.value)}
            />
          </label>
          <label>
            Boiling point
            <input
              type="number"
              step="any"
              value={editableText(properties.boilingPoint)}
              onChange={(event) => setMeasurement("boilingPoint", event.target.value)}
            />
          </label>
          <label>
            Acid value
            <input
              type="number"
              step="any"
              value={editableText(properties.acidValue)}
              onChange={(event) => setMeasurement("acidValue", event.target.value)}
            />
          </label>
          <label>
            Vapor pressure
            <input
              type="number"
              step="any"
              value={editableText(properties.vaporPressure)}
              onChange={(event) => setMeasurement("vaporPressure", event.target.value)}
            />
          </label>
          <label>
            Flash point
            <input
              type="number"
              step="any"
              value={editableText(properties.flashPoint)}
              onChange={(event) => setMeasurement("flashPoint", event.target.value)}
            />
          </label>
          <label>
            logP
            <input
              type="number"
              step="any"
              value={editableText(properties.logpOw)}
              onChange={(event) => setMeasurement("logpOw", event.target.value)}
            />
          </label>
          <label>
            Shelf life
            <input
              value={editableText(properties.shelfLife)}
              onChange={(event) => setProperty("shelfLife", event.target.value || null)}
            />
          </label>
          <label>
            Storage
            <input
              value={editableText(properties.storage)}
              onChange={(event) => setProperty("storage", event.target.value || null)}
            />
          </label>
          <label>
            Source reference
            <input
              value={editableText(properties.sourceReference)}
              onChange={(event) => setProperty("sourceReference", event.target.value || null)}
            />
          </label>
          <label>
            IFRA Cat 4 maximum reference level
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={editableText(properties.ifraCat4MaxPct)}
              onChange={(event) =>
                setProperty(
                  "ifraCat4MaxPct",
                  event.target.value ? Number(event.target.value) : null
                )
              }
            />
          </label>
          <label>
            IFRA amendment
            <input
              value={editableText(properties.ifraAmendment)}
              onChange={(event) => setProperty("ifraAmendment", event.target.value || null)}
            />
          </label>
          <label>
            IFRA source
            <input
              value={editableText(properties.ifraSourceReference)}
              onChange={(event) => setProperty("ifraSourceReference", event.target.value || null)}
            />
          </label>
          <label className="nox-toggle-label">
            <input
              type="checkbox"
              checked={properties.fccListed === true}
              onChange={(event) => setProperty("fccListed", event.target.checked)}
            />{" "}
            FCC listed
          </label>
        </div>
      ) : null}
      {requestType === "OLFACTIVE" ? (
        <label>
          Note classification
          <select value={note} onChange={(event) => setNote(event.target.value)}>
            <option value="">Not classified</option>
            <option value="TOP">Top</option>
            <option value="MID">Mid</option>
            <option value="BASE">Base</option>
          </select>
        </label>
      ) : null}
      {requestType === "GENERAL" && canShare && material.approvalStatus === "APPROVED" ? (
        <label className="nox-toggle-label">
          <input
            type="checkbox"
            checked={share}
            onChange={(event) => setShare(event.target.checked)}
          />
          Request sharing with other tenants
        </label>
      ) : null}
      <p className="nox-material-muted">
        Changes are submitted for governed review; this form never edits canonical truth directly.
      </p>
      <ErrorNotice error={error} />
      <button type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}

function MaterialDetailPage({ api, tenantId, modulePermissions }: MaterialExperienceProps) {
  const { materialId } = useParams();
  const [material, setMaterial] = useState<MaterialDetail>();
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [references, setReferences] = useState<Record<string, MaterialDetail>>({});
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string>();
  const [requestingChange, setRequestingChange] = useState(false);
  const reload = () => {
    if (!tenantId || !materialId) return;
    setState("loading");
    setError(undefined);
    void Promise.all([
      api<{ material: MaterialDetail }>(`/materials/${materialId}`, { tenantId }),
      api<{ history: HistoryEvent[] }>(`/materials/${materialId}/history`, { tenantId })
    ])
      .then(async ([detail, events]) => {
        const referenceIds = [
          detail.material.concentrate?.sourceMaterialId,
          detail.material.concentrate?.solventMaterialId,
          ...detail.material.components.map((component) => component.componentMaterialId)
        ].filter((value): value is string => Boolean(value));
        const resolved = await Promise.all(
          [...new Set(referenceIds)].map(async (referenceId) => {
            try {
              const reference = await api<{ material: MaterialDetail }>(
                `/materials/${referenceId}`,
                { tenantId }
              );
              return [referenceId, reference.material] as const;
            } catch {
              return undefined;
            }
          })
        );
        setMaterial(detail.material);
        setHistory(events.history);
        setReferences(
          Object.fromEntries(
            resolved.filter((item): item is readonly [string, MaterialDetail] => Boolean(item))
          )
        );
        setState("ready");
      })
      .catch((reason) => {
        setError(message(reason));
        setState("error");
      });
  };
  useEffect(reload, [api, materialId, tenantId]);
  if (!tenantId) return <TenantRequired />;
  if (!hasPermission(modulePermissions, MATERIAL_PERMISSION.read)) return <PermissionDenied />;
  if (state === "loading") return <p className="nox-ai-context">Loading Material workspace…</p>;
  if (state === "error" || !material)
    return <ErrorNotice error={error ?? "Material was not found."} />;
  const grandFamily = material.odorAssignments.find(
    (item) => item.assignmentType === "GRAND_FAMILY"
  )?.taxonomyTerm;
  const subfamily = material.odorAssignments.find(
    (item) => item.assignmentType === "SUBFAMILY"
  )?.taxonomyTerm;
  const canRequestChange = hasPermission(modulePermissions, MATERIAL_PERMISSION.requestChange);
  const referenceLabel = (referenceId: string | null | undefined) =>
    referenceId ? (references[referenceId]?.displayName ?? referenceId) : null;
  return (
    <section className="nox-material-detail" aria-labelledby="material-detail-title">
      <Link className="nox-material-back-link" to="/materials">
        ← Materials
      </Link>
      <header className="nox-material-detail-heading">
        <div>
          <p className="nox-ai-context">Material / {material.scope}</p>
          <h1 id="material-detail-title">{material.displayName}</h1>
          <p>
            {displayType(material.materialType)} ·{" "}
            {material.identifiers.find((item) => item.identifierType === "CAS")?.value ?? "No CAS"}
          </p>
          <p>
            {[
              grandFamily,
              subfamily,
              material.noteClassification ? material.noteClassification + " note" : undefined
            ]
              .filter(Boolean)
              .join(" · ") || "No olfactive assignment recorded"}
          </p>
        </div>
        <div className="nox-material-heading-actions">
          <span className={`nox-material-status is-${material.approvalStatus.toLowerCase()}`}>
            {material.approvalStatus === "PENDING_REVIEW" ? "Pending review" : "Approved"}
          </span>
          {canRequestChange ? (
            <button type="button" onClick={() => setRequestingChange((value) => !value)}>
              Request update
            </button>
          ) : null}
        </div>
      </header>
      {material.approvalStatus === "PENDING_REVIEW" ? (
        <p className="nox-material-pending-note">
          This Material is awaiting approval. It is not yet available as an approved downstream
          Material template.
        </p>
      ) : null}
      {requestingChange && canRequestChange ? (
        <DetailSection title="Request update">
          <MaterialChangeRequestForm
            api={api}
            tenantId={tenantId}
            material={material}
            canShare={hasPermission(modulePermissions, MATERIAL_PERMISSION.share)}
            onSubmitted={() => {
              setRequestingChange(false);
              reload();
            }}
          />
        </DetailSection>
      ) : null}
      <div className="nox-material-detail-layout">
        <div className="nox-material-detail-main">
          <DetailSection title="Identity">
            <DefinitionGrid
              values={[
                ["Material type", displayType(material.materialType)],
                [
                  "CAS",
                  material.identifiers
                    .filter((item) => item.identifierType === "CAS")
                    .map((item) => item.value)
                    .join(", ")
                ],
                [
                  "FEMA",
                  material.identifiers
                    .filter((item) => item.identifierType === "FEMA")
                    .map((item) => item.value)
                    .join(", ")
                ],
                [
                  "INCI",
                  material.identifiers
                    .filter((item) => item.identifierType === "INCI")
                    .map((item) => item.value)
                    .join(", ")
                ]
              ]}
            />
          </DetailSection>
          <DetailSection title="Olfactive">
            {material.odorAssignments.length === 0 ? (
              <p className="nox-material-muted">No olfactive assignment recorded.</p>
            ) : (
              <DefinitionGrid
                values={material.odorAssignments.map((item) => [
                  item.assignmentType.replaceAll("_", " "),
                  `${item.taxonomyTerm}${item.intensity ? ` · intensity ${item.intensity}` : ""}`
                ])}
              />
            )}
          </DetailSection>
          <DetailSection title="Physical &amp; safety">
            {material.properties ? (
              <DefinitionGrid
                values={[
                  ["Appearance", material.properties.appearance],
                  ["Assay", material.properties.assay],
                  ["FCC listed", material.properties.fccListed],
                  ["Specific gravity", material.properties.specificGravity],
                  ["Pounds per gallon", material.properties.poundsPerGallon],
                  ["Refractive index", material.properties.refractiveIndex],
                  ["Boiling point", material.properties.boilingPoint],
                  ["Acid value", material.properties.acidValue],
                  ["Vapor pressure", material.properties.vaporPressure],
                  ["Flash point", material.properties.flashPoint],
                  ["logP", material.properties.logpOw],
                  ["Shelf life", material.properties.shelfLife],
                  ["Storage", material.properties.storage],
                  ["Source reference", material.properties.sourceReference]
                ]}
              />
            ) : (
              <p className="nox-material-muted">
                No physical or safety reference has been recorded.
              </p>
            )}
          </DetailSection>
          <DetailSection title="IFRA Cat 4 reference">
            <DefinitionGrid
              values={[
                ["Maximum reference level", material.properties?.ifraCat4MaxPct],
                ["Amendment", material.properties?.ifraAmendment],
                ["Source", material.properties?.ifraSourceReference]
              ]}
            />
            <p className="nox-material-muted">
              Reference data only — not formula compliance, legal approval, or regulatory
              certification.
            </p>
          </DetailSection>
          {material.materialType === "DILUTION" ? (
            <DetailSection title="Concentration">
              <DefinitionGrid
                values={[
                  ["Source Material", referenceLabel(material.concentrate?.sourceMaterialId)],
                  [
                    "Concentration",
                    material.concentrate ? material.concentrate.concentrationPct + "%" : null
                  ],
                  [
                    "Solvent",
                    material.concentrate?.solventCustomName ??
                      referenceLabel(material.concentrate?.solventMaterialId)
                  ]
                ]}
              />
            </DetailSection>
          ) : null}
          {["MIXTURE", "NATURAL"].includes(material.materialType) ? (
            <DetailSection title="Known composition">
              {material.components.length ? (
                <div className="nox-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Percentage</th>
                        <th>Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {material.components.map((item) => (
                        <tr key={item.componentMaterialId}>
                          <td>
                            <Link to={`/materials/${item.componentMaterialId}`}>
                              {referenceLabel(item.componentMaterialId)}
                            </Link>
                          </td>
                          <td>{item.percentage ?? "—"}</td>
                          <td>{item.role}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="nox-material-muted">No known composition has been recorded.</p>
              )}
            </DetailSection>
          ) : null}
        </div>
        <aside className="nox-material-detail-side" aria-label="Material context">
          <DetailSection title="Approval">
            <DefinitionGrid
              values={[
                ["State", material.approvalStatus],
                ["Authority", material.approval.authority],
                ["Reviewed by", material.approval.approvedByUserId]
              ]}
            />
          </DetailSection>
          <DetailSection title="Contributor">
            <DefinitionGrid
              values={[
                [
                  "Shared by",
                  material.scope === "TENANT" &&
                  material.visibility === "SHARED" &&
                  material.contributor.userId === undefined
                    ? (material.contributor.tenantName ?? "Tenant")
                    : (material.contributor.userDisplayName ??
                      material.contributor.userId ??
                      material.contributor.tenantName ??
                      "Tenant")
                ],
                [
                  "Tenant",
                  material.contributor.tenantName ?? material.contributor.tenantId ?? "Platform"
                ]
              ]}
            />
          </DetailSection>
          <DetailSection title="History">
            {history.length ? (
              <ol className="nox-material-history">
                {history.map((event) => (
                  <li key={event.id}>
                    <strong>{event.action.replace("module.material-intelligence.", "")}</strong>
                    <span>{formatDate(event.createdAt)}</span>
                    {event.actorUserId ? <small>Actor {event.actorUserId}</small> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="nox-material-muted">No audit history available.</p>
            )}
          </DetailSection>
        </aside>
      </div>
    </section>
  );
}

type FormState = {
  displayName: string;
  materialType: MaterialType;
  cas: string;
  fema: string;
  inci: string;
  noteClassification: string;
  grandFamily: string;
  subfamily: string;
  descriptor: string;
  texture: string;
  sensation: string;
  intensity: string;
  concentrationPct: string;
  appearance: string;
  assay: string;
  fccListed: boolean;
  specificGravity: string;
  poundsPerGallon: string;
  refractiveIndex: string;
  boilingPoint: string;
  acidValue: string;
  vaporPressure: string;
  flashPoint: string;
  logpOw: string;
  shelfLife: string;
  storage: string;
  sourceReference: string;
  ifraCat4MaxPct: string;
  ifraAmendment: string;
  ifraSourceReference: string;
};

const initialForm: FormState = {
  displayName: "",
  materialType: "SINGLE_MOLECULE",
  cas: "",
  fema: "",
  inci: "",
  noteClassification: "",
  grandFamily: "",
  subfamily: "",
  descriptor: "",
  texture: "",
  sensation: "",
  intensity: "",
  concentrationPct: "",
  appearance: "",
  assay: "",
  fccListed: false,
  specificGravity: "",
  poundsPerGallon: "",
  refractiveIndex: "",
  boilingPoint: "",
  acidValue: "",
  vaporPressure: "",
  flashPoint: "",
  logpOw: "",
  shelfLife: "",
  storage: "",
  sourceReference: "",
  ifraCat4MaxPct: "",
  ifraAmendment: "",
  ifraSourceReference: ""
};

function selectOptions(values: readonly string[]) {
  return (
    <>
      <option value="">Not specified</option>
      {values.map((value) => (
        <option key={value} value={value}>
          {value}
        </option>
      ))}
    </>
  );
}

function CreateMaterialPage({ api, tenantId, modulePermissions }: MaterialExperienceProps) {
  const navigate = useNavigate();
  const { taxonomy, error: taxonomyError } = useTaxonomy(api, tenantId);
  const [form, setForm] = useState<FormState>(initialForm);
  const [sourceMaterial, setSourceMaterial] = useState<ReferenceMaterial | null>(null);
  const [solventMaterial, setSolventMaterial] = useState<ReferenceMaterial | null>(null);
  const [customSolvent, setCustomSolvent] = useState("");
  const [components, setComponents] = useState<
    Array<{ material: ReferenceMaterial | null; percentage: string; role: "COMPONENT" | "TRACE" }>
  >([]);
  const [tgsc, setTgsc] = useState<TgscReference>();
  const [identityMatch, setIdentityMatch] = useState<IdentityResolution>();
  const [continueSubmission, setContinueSubmission] = useState(false);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  if (!tenantId) return <TenantRequired />;
  if (!hasPermission(modulePermissions, MATERIAL_PERMISSION.create))
    return <PermissionDenied title="Material creation is not granted" />;
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setIdentityMatch(undefined);
    setContinueSubmission(false);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const lookupTgsc = async () => {
    if (!form.cas.trim()) return;
    setError(undefined);
    try {
      const payload = await api<{ reference: TgscReference }>(
        "/materials/reference/tgsc?" + new URLSearchParams({ cas: form.cas.trim() }),
        { tenantId }
      );
      setTgsc(payload.reference);
    } catch (reason) {
      setTgsc({
        state: "UNAVAILABLE",
        message: "External TGSC reference is unavailable in this environment."
      });
      setError(message(reason));
    }
  };
  const applyTgsc = () => {
    const values = tgsc?.values;
    if (!values) return;
    if (typeof values.appearance === "string") update("appearance", values.appearance);
    if (typeof values.assay === "string") update("assay", values.assay);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    const identifiers: MaterialIdentifier[] = (
      [
        ["CAS", form.cas],
        ["FEMA", form.fema],
        ["INCI", form.inci]
      ] as const
    )
      .filter(([, value]) => Boolean(value.trim()))
      .map(([identifierType, value]) => ({ identifierType, value: value.trim() }));
    const values = [
      ["GRAND_FAMILY", form.grandFamily],
      ["SUBFAMILY", form.subfamily],
      ["DESCRIPTOR", form.descriptor],
      ["TEXTURE", form.texture],
      ["SENSATION", form.sensation]
    ] as const;
    const odorAssignments = values
      .filter(([, term]) => Boolean(term))
      .map(([assignmentType, taxonomyTerm]) => ({
        taxonomyVersion: "1.2",
        assignmentType,
        taxonomyTerm,
        ...(assignmentType === "DESCRIPTOR" && form.intensity
          ? { intensity: Number(form.intensity) }
          : {})
      }));
    const properties = {
      appearance: form.appearance || null,
      assay: form.assay || null,
      fccListed: form.fccListed,
      specificGravity: form.specificGravity ? { value: Number(form.specificGravity) } : null,
      poundsPerGallon: form.poundsPerGallon ? { value: Number(form.poundsPerGallon) } : null,
      refractiveIndex: form.refractiveIndex ? { value: Number(form.refractiveIndex) } : null,
      boilingPoint: form.boilingPoint ? { value: Number(form.boilingPoint) } : null,
      acidValue: form.acidValue ? { value: Number(form.acidValue) } : null,
      vaporPressure: form.vaporPressure ? { value: Number(form.vaporPressure) } : null,
      flashPoint: form.flashPoint ? { value: Number(form.flashPoint) } : null,
      logpOw: form.logpOw ? { value: Number(form.logpOw) } : null,
      shelfLife: form.shelfLife || null,
      storage: form.storage || null,
      sourceReference: form.sourceReference || null,
      ifraCat4MaxPct: form.ifraCat4MaxPct ? Number(form.ifraCat4MaxPct) : null,
      ifraAmendment: form.ifraAmendment || null,
      ifraSourceReference: form.ifraSourceReference || null
    };
    try {
      if (!continueSubmission) {
        const preflight = await api<{ identityResolution: IdentityResolution }>(
          "/materials/identity-resolution?" +
            new URLSearchParams({
              displayName: form.displayName.trim(),
              ...(form.cas.trim() ? { cas: form.cas.trim() } : {}),
              ...(form.fema.trim() ? { fema: form.fema.trim() } : {}),
              ...(form.inci.trim() ? { inci: form.inci.trim() } : {})
            }),
          { tenantId }
        );
        if (preflight.identityResolution.kind !== "NO_MATCH") {
          setIdentityMatch(preflight.identityResolution);
          return;
        }
      }
      const payload = await api<{
        material: MaterialDetail;
      }>("/materials", {
        method: "POST",
        tenantId,
        body: {
          displayName: form.displayName,
          materialType: form.materialType,
          visibility: "PRIVATE",
          noteClassification: form.noteClassification || null,
          identifiers,
          odorAssignments,
          properties,
          ...(form.materialType === "DILUTION"
            ? {
                concentrate: {
                  sourceMaterialId: sourceMaterial?.id,
                  concentrationPct: Number(form.concentrationPct || 0),
                  solventMaterialId: solventMaterial?.id ?? null,
                  solventCustomName: customSolvent || null
                }
              }
            : {}),
          ...(["MIXTURE", "NATURAL"].includes(form.materialType)
            ? {
                components: components
                  .filter((item) => item.material)
                  .map((item) => ({
                    componentMaterialId: item.material!.id,
                    percentage: item.percentage ? Number(item.percentage) : null,
                    role: item.role
                  }))
              }
            : {})
        }
      });
      navigate("/materials/" + payload.material.id);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSubmitting(false);
    }
  };
  const dilutionValid =
    form.materialType !== "DILUTION" ||
    Boolean(
      sourceMaterial &&
      (solventMaterial || customSolvent) &&
      Number(form.concentrationPct) > 0 &&
      Number(form.concentrationPct) < 100
    );
  return (
    <section className="nox-material-create" aria-labelledby="material-create-title">
      <header className="nox-section-heading">
        <div>
          <p className="nox-ai-context">Material Intelligence / Create</p>
          <h1 id="material-create-title">Add Material</h1>
          <p>Submit structured Material data for governed tenant review.</p>
        </div>
        <Link to="/materials">Cancel</Link>
      </header>
      <form className="nox-material-form" onSubmit={submit}>
        <fieldset>
          <legend>Identity</legend>
          <div className="nox-material-form-grid">
            <label>
              Material name
              <input
                value={form.displayName}
                onChange={(event) => update("displayName", event.target.value)}
                required
              />
            </label>
            <label>
              Material type
              <select
                value={form.materialType}
                onChange={(event) => update("materialType", event.target.value as MaterialType)}
              >
                <option value="SINGLE_MOLECULE">Single Molecule</option>
                <option value="NATURAL">Natural</option>
                <option value="MIXTURE">Mixture</option>
                <option value="DILUTION">Dilution</option>
              </select>
            </label>
            <label>
              CAS
              <input value={form.cas} onChange={(event) => update("cas", event.target.value)} />
            </label>
            <label>
              FEMA
              <input value={form.fema} onChange={(event) => update("fema", event.target.value)} />
            </label>
            <label>
              INCI
              <input value={form.inci} onChange={(event) => update("inci", event.target.value)} />
            </label>
          </div>
          <button type="button" onClick={() => void lookupTgsc()} disabled={!form.cas.trim()}>
            Fetch TGSC reference
          </button>
          {tgsc ? (
            <div className="nox-material-reference-state">
              <strong>
                {tgsc.state === "UNAVAILABLE"
                  ? "TGSC reference unavailable"
                  : (tgsc.source ?? "TGSC reference candidate")}
              </strong>
              <p>{tgsc.message ?? "Review candidate reference data before applying it."}</p>
              {tgsc.values ? (
                <>
                  <DefinitionGrid values={Object.entries(tgsc.values)} />
                  <button type="button" onClick={applyTgsc}>
                    Apply reference data
                  </button>
                </>
              ) : null}
              {tgsc.referenceUrl ? (
                <a href={tgsc.referenceUrl} target="_blank" rel="noreferrer">
                  Open source reference
                </a>
              ) : null}
            </div>
          ) : null}
          {identityMatch && identityMatch.kind !== "NO_MATCH" ? (
            <div className="nox-material-reference-state" role="status">
              <strong>Possible existing Material</strong>
              <p>
                {identityMatch.kind === "EXACT_MATCH"
                  ? `An existing Material matched by ${identityMatch.matchedBy} was found.`
                  : `Existing Materials may match by ${identityMatch.matchedBy}.`}
              </p>
              <div className="nox-table-actions">
                {identityMatch.kind === "EXACT_MATCH" ? (
                  <Link to={`/materials/${identityMatch.materialId}`}>Open existing</Link>
                ) : (
                  identityMatch.materialIds.map((materialId) => (
                    <Link key={materialId} to={`/materials/${materialId}`}>
                      Open possible match
                    </Link>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => {
                    setContinueSubmission(true);
                    setIdentityMatch(undefined);
                  }}
                >
                  Continue submission for review
                </button>
              </div>
            </div>
          ) : null}
        </fieldset>
        <fieldset>
          <legend>Olfactive</legend>
          <div className="nox-material-form-grid">
            <label>
              Grand family
              <select
                value={form.grandFamily}
                onChange={(event) => update("grandFamily", event.target.value)}
              >
                {selectOptions(taxonomy?.GRAND_FAMILIES ?? [])}
              </select>
            </label>
            <label>
              Subfamily
              <select
                value={form.subfamily}
                onChange={(event) => update("subfamily", event.target.value)}
              >
                {selectOptions(
                  (taxonomy?.SUBFAMILIES ?? []).filter(
                    (item) => !form.grandFamily || taxonomy?.SUB_TO_GRAND[item] === form.grandFamily
                  )
                )}
              </select>
            </label>
            <label>
              Descriptor
              <select
                value={form.descriptor}
                onChange={(event) => update("descriptor", event.target.value)}
              >
                {selectOptions(taxonomy?.DESCRIPTORS ?? [])}
              </select>
            </label>
            <label>
              Texture
              <select
                value={form.texture}
                onChange={(event) => update("texture", event.target.value)}
              >
                {selectOptions(taxonomy?.TEXTURES ?? [])}
              </select>
            </label>
            <label>
              Sensation
              <select
                value={form.sensation}
                onChange={(event) => update("sensation", event.target.value)}
              >
                {selectOptions(taxonomy?.SENSATIONS ?? [])}
              </select>
            </label>
            <label>
              Intensity (1–10)
              <input
                type="number"
                min="1"
                max="10"
                value={form.intensity}
                onChange={(event) => update("intensity", event.target.value)}
              />
            </label>
            <label>
              Note classification
              <select
                value={form.noteClassification}
                onChange={(event) => update("noteClassification", event.target.value)}
              >
                <option value="">Not classified</option>
                <option value="TOP">Top</option>
                <option value="MID">Mid</option>
                <option value="BASE">Base</option>
              </select>
            </label>
          </div>
          <ErrorNotice error={taxonomyError} />
        </fieldset>
        <fieldset>
          <legend>Physical &amp; safety</legend>
          <div className="nox-material-form-grid">
            <label>
              Appearance
              <input
                value={form.appearance}
                onChange={(event) => update("appearance", event.target.value)}
              />
            </label>
            <label>
              Assay
              <input value={form.assay} onChange={(event) => update("assay", event.target.value)} />
            </label>
            <label>
              Specific gravity
              <input
                type="number"
                step="any"
                value={form.specificGravity}
                onChange={(event) => update("specificGravity", event.target.value)}
              />
            </label>
            <label>
              Pounds per gallon
              <input
                type="number"
                step="any"
                value={form.poundsPerGallon}
                onChange={(event) => update("poundsPerGallon", event.target.value)}
              />
            </label>
            <label>
              Refractive index
              <input
                type="number"
                step="any"
                value={form.refractiveIndex}
                onChange={(event) => update("refractiveIndex", event.target.value)}
              />
            </label>
            <label>
              Boiling point
              <input
                type="number"
                step="any"
                value={form.boilingPoint}
                onChange={(event) => update("boilingPoint", event.target.value)}
              />
            </label>
            <label>
              Acid value
              <input
                type="number"
                step="any"
                value={form.acidValue}
                onChange={(event) => update("acidValue", event.target.value)}
              />
            </label>
            <label>
              Vapor pressure
              <input
                type="number"
                step="any"
                value={form.vaporPressure}
                onChange={(event) => update("vaporPressure", event.target.value)}
              />
            </label>
            <label>
              Flash point
              <input
                type="number"
                step="any"
                value={form.flashPoint}
                onChange={(event) => update("flashPoint", event.target.value)}
              />
            </label>
            <label>
              logP
              <input
                type="number"
                step="any"
                value={form.logpOw}
                onChange={(event) => update("logpOw", event.target.value)}
              />
            </label>
            <label>
              Shelf life
              <input
                value={form.shelfLife}
                onChange={(event) => update("shelfLife", event.target.value)}
              />
            </label>
            <label>
              Storage
              <input
                value={form.storage}
                onChange={(event) => update("storage", event.target.value)}
              />
            </label>
            <label>
              Source reference
              <input
                value={form.sourceReference}
                onChange={(event) => update("sourceReference", event.target.value)}
              />
            </label>
            <label>
              IFRA Cat 4 maximum reference level
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={form.ifraCat4MaxPct}
                onChange={(event) => update("ifraCat4MaxPct", event.target.value)}
              />
            </label>
            <label>
              IFRA amendment
              <input
                value={form.ifraAmendment}
                onChange={(event) => update("ifraAmendment", event.target.value)}
              />
            </label>
            <label>
              IFRA source
              <input
                value={form.ifraSourceReference}
                onChange={(event) => update("ifraSourceReference", event.target.value)}
              />
            </label>
            <label className="nox-toggle-label">
              <input
                type="checkbox"
                checked={form.fccListed}
                onChange={(event) => update("fccListed", event.target.checked)}
              />{" "}
              FCC listed
            </label>
          </div>
        </fieldset>
        {form.materialType === "DILUTION" ? (
          <fieldset>
            <legend>Preparation / concentration</legend>
            <p className="nox-material-muted">
              Concentration is mass-based. No basis selector or unit conversion is used.
            </p>
            <div className="nox-material-form-grid">
              <MaterialReferencePicker
                api={api}
                tenantId={tenantId}
                label="Source Material"
                value={sourceMaterial}
                onChange={setSourceMaterial}
                allowClear={false}
              />
              <label>
                Concentration %
                <input
                  type="number"
                  min="0.01"
                  max="99.99"
                  step="any"
                  value={form.concentrationPct}
                  onChange={(event) => update("concentrationPct", event.target.value)}
                  required
                />
              </label>
              <MaterialReferencePicker
                api={api}
                tenantId={tenantId}
                label="Solvent Material"
                value={solventMaterial}
                onChange={setSolventMaterial}
              />
              <label>
                Custom solvent
                <input
                  value={customSolvent}
                  onChange={(event) => setCustomSolvent(event.target.value)}
                  disabled={Boolean(solventMaterial)}
                />
              </label>
            </div>
          </fieldset>
        ) : null}
        {["MIXTURE", "NATURAL"].includes(form.materialType) ? (
          <fieldset>
            <legend>Known components</legend>
            <p className="nox-material-muted">
              Components are optional and may be partial. Known percentages must not exceed 100%.
            </p>
            {components.map((component, index) => (
              <div className="nox-material-component-row" key={index}>
                <MaterialReferencePicker
                  api={api}
                  tenantId={tenantId}
                  label={`Component ${index + 1}`}
                  value={component.material}
                  onChange={(material) =>
                    setComponents((items) =>
                      items.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, material } : item
                      )
                    )
                  }
                />
                <label>
                  Percentage
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={component.percentage}
                    onChange={(event) =>
                      setComponents((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, percentage: event.target.value } : item
                        )
                      )
                    }
                  />
                </label>
                <label>
                  Role
                  <select
                    value={component.role}
                    onChange={(event) =>
                      setComponents((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, role: event.target.value as "COMPONENT" | "TRACE" }
                            : item
                        )
                      )
                    }
                  >
                    <option value="COMPONENT">Component</option>
                    <option value="TRACE">Trace</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setComponents((items) => items.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setComponents((items) => [
                  ...items,
                  { material: null, percentage: "", role: "COMPONENT" }
                ])
              }
            >
              Add known component
            </button>
          </fieldset>
        ) : null}
        <ErrorNotice error={error} />
        <button
          className="nox-material-primary-action"
          type="submit"
          disabled={submitting || !dilutionValid}
        >
          {submitting ? "Submitting…" : "Submit for review"}
        </button>
      </form>
    </section>
  );
}

function ReviewQueue({ api, tenantId, modulePermissions }: MaterialExperienceProps) {
  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  const [materials, setMaterials] = useState<Record<string, MaterialDetail>>({});
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!tenantId) return;
    let current = true;
    void api<{ changeRequests: ChangeRequest[] }>(
      "/material-change-requests?status=PENDING_REVIEW",
      { tenantId }
    )
      .then(async (payload) => {
        const details = await Promise.all(
          payload.changeRequests.map(async (change) =>
            api<{ material: MaterialDetail }>(`/materials/${change.materialId}`, { tenantId })
              .then((detail) => [change.materialId, detail.material] as const)
              .catch(() => undefined)
          )
        );
        if (!current) return;
        setChanges(payload.changeRequests);
        setMaterials(
          Object.fromEntries(
            details.filter((item): item is readonly [string, MaterialDetail] => Boolean(item))
          )
        );
      })
      .catch((reason) => current && setError(message(reason)));
    return () => {
      current = false;
    };
  }, [api, tenantId]);
  if (!tenantId) return <TenantRequired />;
  if (!hasPermission(modulePermissions, MATERIAL_PERMISSION.approve))
    return <PermissionDenied title="Material review is not granted" />;
  return (
    <section className="nox-material-review" aria-labelledby="tenant-review-title">
      <header className="nox-section-heading">
        <div>
          <p className="nox-ai-context">Material Intelligence / Review</p>
          <h1 id="tenant-review-title">Material review</h1>
          <p>Pending tenant Materials and governed change requests.</p>
        </div>
        <Link to="/materials">Registry</Link>
      </header>
      <ErrorNotice error={error} />
      {changes.length === 0 ? (
        <EmptyState title="No pending reviews.">
          There are no pending tenant Material requests.
        </EmptyState>
      ) : (
        <div className="nox-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th>Type</th>
                <th>Request</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.id}>
                  <td>{materials[change.materialId]?.displayName ?? change.materialId}</td>
                  <td>
                    {materials[change.materialId]
                      ? displayType(materials[change.materialId].materialType)
                      : "—"}
                  </td>
                  <td>{change.requestType}</td>
                  <td>{formatDate(change.createdAt)}</td>
                  <td>
                    <Link to={`/materials/review/${change.id}`}>Open review</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReviewDetail({ api, tenantId, modulePermissions }: MaterialExperienceProps) {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const [change, setChange] = useState<ChangeRequest>();
  const [material, setMaterial] = useState<MaterialDetail>();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const load = () => {
    if (!tenantId || !requestId) return;
    void api<{ changeRequest: ChangeRequest }>(`/material-change-requests/${requestId}`, {
      tenantId
    })
      .then(async (payload) => {
        const detail = await api<{ material: MaterialDetail }>(
          `/materials/${payload.changeRequest.materialId}`,
          { tenantId }
        );
        setChange(payload.changeRequest);
        setMaterial(detail.material);
      })
      .catch((reason) => setError(message(reason)));
  };
  useEffect(load, [api, requestId, tenantId]);
  if (!tenantId) return <TenantRequired />;
  if (!hasPermission(modulePermissions, MATERIAL_PERMISSION.approve))
    return <PermissionDenied title="Material review is not granted" />;
  const decide = async (decision: "approve" | "reject") => {
    if (!requestId) return;
    setError(undefined);
    try {
      await api(`/material-change-requests/${requestId}/${decision}`, {
        method: "POST",
        tenantId,
        body: { decisionNote: note || null }
      });
      navigate("/materials/review");
    } catch (reason) {
      if (reason instanceof NoxApiError && reason.code === "ALREADY_RESOLVED") {
        setError("This review was already resolved by another approver. The final state is shown.");
      } else setError(message(reason));
      load();
    }
  };
  if (!change || !material) return <p className="nox-ai-context">Loading review…</p>;
  return (
    <section className="nox-material-review-detail" aria-labelledby="review-detail-title">
      <Link className="nox-material-back-link" to="/materials/review">
        ← Material review
      </Link>
      <header>
        <p className="nox-ai-context">Review / {change.requestType}</p>
        <h1 id="review-detail-title">{material.displayName}</h1>
        <p>Request status: {change.status}</p>
      </header>
      <div className="nox-material-review-comparison">
        <DetailSection title="Current data">
          <pre>
            {JSON.stringify(
              {
                displayName: material.displayName,
                identifiers: material.identifiers,
                properties: material.properties,
                odorAssignments: material.odorAssignments,
                concentrate: material.concentrate,
                components: material.components
              },
              null,
              2
            )}
          </pre>
        </DetailSection>
        <DetailSection title="Proposed change">
          <pre>{JSON.stringify(change.proposedPatch, null, 2)}</pre>
        </DetailSection>
      </div>
      <label>
        Decision note
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <p className="nox-material-muted">
        Approve or reject the submitted proposal. Proposals cannot be edited inline.
      </p>
      <ErrorNotice error={error} />
      <div className="nox-table-actions">
        <button type="button" className="nox-danger-action" onClick={() => void decide("reject")}>
          Reject
        </button>
        <button
          type="button"
          className="nox-material-primary-action"
          onClick={() => void decide("approve")}
        >
          Approve
        </button>
      </div>
    </section>
  );
}

function PlatformReviewQueue({ api, platformPermissions }: PlatformMaterialExperienceProps) {
  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!hasPermission(platformPermissions, PLATFORM_MATERIAL_PERMISSION.read)) return;
    void api<{ changeRequests: ChangeRequest[] }>(
      "/platform/material-intelligence/review?status=PENDING_REVIEW"
    )
      .then((payload) => setChanges(payload.changeRequests))
      .catch((reason) => setError(message(reason)));
  }, [api, platformPermissions]);
  if (!hasPermission(platformPermissions, PLATFORM_MATERIAL_PERMISSION.read))
    return <PermissionDenied title="Platform Material review is not granted" />;
  return (
    <section className="nox-material-review" aria-labelledby="platform-material-review-title">
      <header className="nox-section-heading">
        <div>
          <p className="nox-ai-context">Platform / Material Intelligence</p>
          <h1 id="platform-material-review-title">Global Material review</h1>
          <p>Platform authority still resolves all corrections through governed transitions.</p>
        </div>
        <Link to="/platform/tenants">Platform Console</Link>
      </header>
      <ErrorNotice error={error} />
      {changes.length === 0 ? (
        <EmptyState title="No pending platform reviews.">
          There are no global Material corrections awaiting Platform review.
        </EmptyState>
      ) : (
        <div className="nox-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Material ID</th>
                <th>Request</th>
                <th>Tenant</th>
                <th>Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.id}>
                  <td>
                    <code>{change.materialId}</code>
                  </td>
                  <td>{change.requestType}</td>
                  <td>{change.tenantId ?? "Platform"}</td>
                  <td>{formatDate(change.createdAt)}</td>
                  <td>
                    <Link to={`/platform/material-intelligence/review/${change.id}`}>
                      Open review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PlatformReviewDetail({ api, platformPermissions }: PlatformMaterialExperienceProps) {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const [payload, setPayload] = useState<{
    changeRequest: ChangeRequest;
    material: MaterialDetail;
  }>();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState("");
  const load = () => {
    if (!requestId) return;
    void api<{ changeRequest: ChangeRequest; material: MaterialDetail }>(
      `/platform/material-intelligence/review/${requestId}`
    )
      .then(setPayload)
      .catch((reason) => setError(message(reason)));
  };
  useEffect(load, [api, requestId]);
  if (!hasPermission(platformPermissions, PLATFORM_MATERIAL_PERMISSION.read))
    return <PermissionDenied title="Platform Material review is not granted" />;
  const canDecide = hasPermission(platformPermissions, PLATFORM_MATERIAL_PERMISSION.approve);
  const decide = async (decision: "approve" | "reject") => {
    if (!requestId) return;
    try {
      await api(`/platform/material-intelligence/review/${requestId}/${decision}`, {
        method: "POST",
        body: { decisionNote: note || null }
      });
      navigate("/platform/material-intelligence/review");
    } catch (reason) {
      if (reason instanceof NoxApiError && reason.code === "ALREADY_RESOLVED") {
        setError("This review was already resolved by another approver. The final state is shown.");
      } else setError(message(reason));
      load();
    }
  };
  if (!payload) return <p className="nox-ai-context">Loading platform review…</p>;
  return (
    <section className="nox-material-review-detail" aria-labelledby="platform-review-detail-title">
      <Link className="nox-material-back-link" to="/platform/material-intelligence/review">
        ← Global Material review
      </Link>
      <p className="nox-ai-context">Platform correction / {payload.changeRequest.requestType}</p>
      <h1 id="platform-review-detail-title">{payload.material.displayName}</h1>
      <div className="nox-material-review-comparison">
        <DetailSection title="Current canonical data">
          <pre>{JSON.stringify(payload.material, null, 2)}</pre>
        </DetailSection>
        <DetailSection title="Proposed change">
          <pre>{JSON.stringify(payload.changeRequest.proposedPatch, null, 2)}</pre>
        </DetailSection>
      </div>
      {canDecide ? (
        <>
          <label>
            Decision note
            <textarea value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <div className="nox-table-actions">
            <button
              type="button"
              className="nox-danger-action"
              onClick={() => void decide("reject")}
            >
              Reject
            </button>
            <button
              type="button"
              className="nox-material-primary-action"
              onClick={() => void decide("approve")}
            >
              Approve
            </button>
          </div>
        </>
      ) : (
        <PermissionDenied title="Platform approval is not granted" />
      )}
      <ErrorNotice error={error} />
    </section>
  );
}

export function MaterialExperience(props: MaterialExperienceProps) {
  return (
    <Routes>
      <Route index element={<Registry {...props} />} />
      <Route path="new" element={<CreateMaterialPage {...props} />} />
      <Route path="review" element={<ReviewQueue {...props} />} />
      <Route path="review/:requestId" element={<ReviewDetail {...props} />} />
      <Route path=":materialId" element={<MaterialDetailPage {...props} />} />
      <Route path="*" element={<Navigate to="/materials" replace />} />
    </Routes>
  );
}

export function PlatformMaterialExperience(props: PlatformMaterialExperienceProps) {
  return (
    <Routes>
      <Route index element={<PlatformReviewQueue {...props} />} />
      <Route path=":requestId" element={<PlatformReviewDetail {...props} />} />
      <Route path="*" element={<Navigate to="/platform/material-intelligence/review" replace />} />
    </Routes>
  );
}
