import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  useWorkspaceObject,
  useUnsavedChanges,
  NoxDialog,
  NoxReadFeedback,
  type NoxReadState
} from "@nox-os/ui";
import { Link, matchPath, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { BrowserReleaseAssessment } from "@nox-os/release-readiness/browser";
import type { ApiClient } from "./platform-control";
import { NoxApiError } from "./api-client";

const permissions = {
  read: "module.release-readiness.assessment.read",
  create: "module.release-readiness.assessment.create",
  run: "module.release-readiness.assessment.run",
  review: "module.release-readiness.assessment.review"
} as const;

function has(values: readonly string[], permission: string): boolean {
  return values.includes(permission);
}

function message(reason: unknown): string {
  if (reason instanceof NoxApiError) {
    switch (reason.code) {
      case "PERMISSION_DENIED":
      case "TENANT_ACCESS_DENIED":
        return "You do not have access to this assessment operation.";
      case "NOT_FOUND":
        return "The requested assessment or FormulaVersion is not available.";
      case "FORMULA_VERSION_NOT_FROZEN":
        return "Select a frozen FormulaVersion before running an assessment.";
      case "APPROVAL_EVIDENCE_REQUIRED":
        return "Valid Formula approval evidence is required before assessment.";
      case "UNSUPPORTED_COMPOSITION_KIND":
        return "This composition kind cannot be assessed for release readiness.";
      case "IDEMPOTENCY_CONFLICT":
        return "This request key belongs to a different assessment request. Review the current assessment before starting a new request.";
    }
    if (reason.status === 401) return "Your session needs to be restored. Sign in again.";
    if (reason.status === 400) return "Check the FormulaVersion and release profile values.";
  }
  return "The response could not be confirmed. Retry the unchanged request to recover its result.";
}

function Registry({
  api,
  tenantId,
  canCreate
}: {
  api: ApiClient;
  tenantId: string;
  canCreate: boolean;
}) {
  const navigate = useNavigate();
  const [assessments, setAssessments] = useState<BrowserReleaseAssessment[]>([]);
  const [readState, setReadState] = useState<NoxReadState>("LOADING");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useSearchParams();
  const formulaFilter = search.get("formula") ?? "";
  const decisionFilter = search.get("decision") ?? "";
  const applicationFilter = search.get("application") ?? "";
  const setFilter = (key: string, value: string) => {
    // BrowserRouter updates history before its transition renders. Compose rapid
    // filter gestures from that current URL, not a previous render's query.
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: key === "formula" });
  };
  const visible = assessments.filter(
    (item) =>
      (!formulaFilter ||
        item.formulaVersionId.toLowerCase().includes(formulaFilter.trim().toLowerCase())) &&
      (!decisionFilter || item.decision === decisionFilter) &&
      (!applicationFilter || item.releaseProfile.applicationKey === applicationFilter)
  );
  useEffect(() => {
    let current = true;
    setReadState("LOADING");
    setAssessments([]);
    void api<{ assessments: BrowserReleaseAssessment[] }>("/release-readiness", { tenantId })
      .then((result) => {
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (
          !Array.isArray(result.assessments) ||
          result.assessments.some(
            (item) =>
              !item ||
              !uuid.test(item.id) ||
              !uuid.test(item.formulaVersionId) ||
              !["READY", "REVIEW_REQUIRED", "BLOCKED"].includes(item.decision) ||
              typeof item.releaseProfile?.applicationKey !== "string" ||
              !Number.isFinite(item.releaseProfile?.dosagePct) ||
              typeof item.policyKey !== "string" ||
              typeof item.policyVersion !== "string" ||
              typeof item.assessedAt !== "string" ||
              !Number.isFinite(Date.parse(item.assessedAt))
          )
        )
          throw new Error("Invalid registry response");
        if (!current) return;
        setAssessments(result.assessments);
        setReadState("READY");
      })
      .catch(() => current && setReadState("ERROR"));
    return () => {
      current = false;
    };
  }, [api, tenantId, reload]);

  return (
    <section className="nox-design-studio" aria-labelledby="release-registry-title">
      <header className="nox-design-header">
        <div>
          <p className="nox-ai-context">RELEASE READINESS · POLICY EVIDENCE</p>
          <h1 id="release-registry-title">Release Assessments</h1>
          <p>Deterministic readiness decisions over approved, frozen Formula truth.</p>
        </div>
        <button
          type="button"
          disabled={!canCreate}
          onClick={() => navigate("/release-readiness/new")}
        >
          New Assessment
        </button>
      </header>
      <fieldset className="nox-inline-form" disabled={readState !== "READY"}>
        <legend>Filter assessments</legend>
        <label>
          FormulaVersion ID
          <input
            value={formulaFilter}
            onChange={(event) => setFilter("formula", event.target.value)}
          />
        </label>
        <div>
          <label htmlFor="release-decision-filter">Recorded decision</label>
          <select
            id="release-decision-filter"
            value={decisionFilter}
            onChange={(event) => setFilter("decision", event.target.value)}
          >
            <option value="">All decisions</option>
            {["READY", "REVIEW_REQUIRED", "BLOCKED"].map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
            {decisionFilter && !["READY", "REVIEW_REQUIRED", "BLOCKED"].includes(decisionFilter) ? (
              <option value={decisionFilter}>Unknown filter: {decisionFilter}</option>
            ) : null}
          </select>
        </div>
        <div>
          <label htmlFor="release-application-filter">Application</label>
          <select
            id="release-application-filter"
            value={applicationFilter}
            onChange={(event) => setFilter("application", event.target.value)}
          >
            <option value="">All applications</option>
            {[
              ...new Set([
                ...assessments.map((item) => item.releaseProfile.applicationKey),
                ...(applicationFilter ? [applicationFilter] : [])
              ])
            ].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={!formulaFilter && !decisionFilter && !applicationFilter}
          onClick={() => {
            const next = new URLSearchParams(window.location.search);
            for (const key of ["formula", "decision", "application"]) next.delete(key);
            setSearch(next);
          }}
        >
          Clear filters
        </button>
      </fieldset>
      <NoxReadFeedback
        state={readState}
        subject="Release Assessments"
        retry={() => setReload((value) => value + 1)}
      />
      {readState === "READY" ? (
        <p role="status">
          {visible.length} of {assessments.length} loaded assessments
        </p>
      ) : null}
      <p className="nox-design-muted">
        Recorded READY is not Batch release. Open the assessment for its policy and evidence.
      </p>
      <div className="nox-table-wrap" tabIndex={0} role="region" aria-label="Assessment results">
        <table className="nox-material-table">
          <caption className="sr-only">Immutable release assessment registry</caption>
          <thead>
            <tr>
              <th>Formula</th>
              <th>Application</th>
              <th>Policy</th>
              <th>Decision</th>
              <th>Assessed At</th>
              <th>Supersedes</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link
                    to={`/release-readiness/${item.id}`}
                    aria-label={`Open assessment ${item.id} for FormulaVersion ${item.formulaVersionId}`}
                  >
                    <code>{item.formulaVersionId}</code>
                  </Link>
                </td>
                <td>
                  {item.releaseProfile.applicationKey} · {item.releaseProfile.dosagePct}%
                </td>
                <td>
                  {item.policyKey} · v{item.policyVersion}
                </td>
                <td>
                  <strong>{item.decision.replaceAll("_", " ")}</strong>
                </td>
                <td>{new Date(item.assessedAt).toLocaleString()}</td>
                <td>{item.supersedesAssessmentId?.slice(0, 8) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {readState === "READY" && assessments.length === 0 ? (
        <p className="nox-design-muted">No release assessments.</p>
      ) : null}
      {readState === "READY" && assessments.length > 0 && visible.length === 0 ? (
        <p>No assessments match these filters. Clear filters to review the loaded records.</p>
      ) : null}
    </section>
  );
}

function NewAssessment({ api, tenantId }: { api: ApiClient; tenantId: string }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [formulaVersionId, setFormulaVersionId] = useState(search.get("formulaVersionId") ?? "");
  const [applicationKey, setApplicationKey] = useState("fine-fragrance");
  const [dosagePct, setDosagePct] = useState(20);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const sending = useRef(false);
  const command = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const [uncertain, setUncertain] = useState(false);
  const [discard, setDiscard] = useState(false);
  const dirty = Boolean(
    formulaVersionId || applicationKey !== "fine-fragrance" || dosagePct !== 20
  );
  useUnsavedChanges(dirty || working || uncertain);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    const fingerprint = JSON.stringify([tenantId, formulaVersionId, applicationKey, dosagePct]);
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, key: crypto.randomUUID() };
    setWorking(true);
    setError(undefined);
    try {
      const result = await api<{ assessment: BrowserReleaseAssessment }>(
        "/release-readiness/assessments",
        {
          method: "POST",
          tenantId,
          body: {
            formulaVersionId,
            applicationKey,
            dosagePct,
            policyKey: "g6-known-limit-v1",
            idempotencyKey: command.current.key
          }
        }
      );
      navigate(`/release-readiness/${result.assessment.id}`);
    } catch (reason) {
      setError(message(reason));
      setUncertain(!(reason instanceof NoxApiError && reason.status >= 400 && reason.status < 500));
    } finally {
      sending.current = false;
      setWorking(false);
    }
  };
  return (
    <section className="nox-design-studio" aria-labelledby="release-new-title">
      <header className="nox-design-header">
        <div>
          <button
            type="button"
            className="nox-design-back"
            disabled={working}
            onClick={() => (dirty || uncertain ? setDiscard(true) : navigate("/release-readiness"))}
          >
            ← Assessments
          </button>
          <p className="nox-ai-context">CONFIRM RELEASE PROFILE</p>
          <h1 id="release-new-title">Assess Release Readiness</h1>
        </div>
      </header>
      <form className="nox-design-panel" onSubmit={submit}>
        <label>
          Approved FormulaVersion
          <input
            disabled={working || uncertain}
            value={formulaVersionId}
            onChange={(event) => setFormulaVersionId(event.target.value)}
            required
          />
        </label>
        <label htmlFor="release-profile-application">
          <span id="release-profile-application-label">Application</span>
          <select
            id="release-profile-application"
            aria-labelledby="release-profile-application-label"
            disabled={working || uncertain}
            value={applicationKey}
            onChange={(event) => setApplicationKey(event.target.value)}
          >
            <option value="fine-fragrance">Fine fragrance · IFRA Category 4</option>
            <option value="unsupported">Unsupported mapping · manual review</option>
          </select>
        </label>
        <label>
          Dosage %
          <input
            disabled={working || uncertain}
            type="number"
            min="0.000001"
            max="100"
            step="0.000001"
            value={dosagePct}
            onChange={(event) => setDosagePct(Number(event.target.value))}
            required
          />
        </label>
        <p className="nox-design-muted">
          Policy g6-known-limit-v1 · version 1. Browser values never replace server-side Formula or
          regulatory evidence.
        </p>
        <p className="nox-design-warning">
          READY applies only to this configured policy and evidence snapshot. It is not universal
          legal certification, market authorization, QC approval, or batch release.
        </p>
        <button type="submit" disabled={working}>
          {working ? "Assessing…" : "Run Assessment"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="nox-design-warning">
          {error}
        </p>
      ) : null}
      {uncertain ? (
        <p role="status">
          The profile is locked while the outcome is unknown. Retry sends the same request key, not
          a new assessment request. Leaving does not cancel a request that reached the server.
        </p>
      ) : null}
      {discard ? (
        <NoxDialog title="Leave assessment form?" onClose={() => setDiscard(false)}>
          <p>
            Your entered profile will be discarded. Leaving does not undo an assessment already
            accepted by the server.
          </p>
          <button type="button" onClick={() => setDiscard(false)}>
            Keep editing
          </button>
          <button type="button" onClick={() => navigate("/release-readiness")}>
            Leave form
          </button>
        </NoxDialog>
      ) : null}
    </section>
  );
}

function Detail({
  api,
  tenantId,
  assessmentId,
  canReassess
}: {
  api: ApiClient;
  tenantId: string;
  assessmentId: string;
  canReassess: boolean;
}) {
  const navigate = useNavigate();
  const [assessment, setAssessment] = useState<BrowserReleaseAssessment>();
  const sending = useRef(false);
  const commandKey = useRef<string | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  const workspaceObject = useMemo(
    () =>
      !error && assessment?.id === assessmentId
        ? {
            id: assessment.id,
            objectType: "ReleaseAssessment",
            title: `Assessment · ${assessment.decision.replaceAll("_", " ")}`,
            route: `/release-readiness/${assessment.id}`,
            readOnly: true,
            properties: [
              { label: "Decision", value: assessment.decision },
              { label: "FormulaVersion", value: assessment.formulaVersionId },
              { label: "Policy", value: `${assessment.policyKey} · ${assessment.policyVersion}` },
              { label: "Bundle hash", value: assessment.formulaBundleHash }
            ]
          }
        : undefined,
    [assessment, assessmentId, error]
  );
  useWorkspaceObject(workspaceObject);
  useEffect(() => {
    let current = true;
    void api<{ assessment: BrowserReleaseAssessment }>(
      `/release-readiness/assessments/${assessmentId}`,
      { tenantId }
    )
      .then((result) => current && setAssessment(result.assessment))
      .catch((reason) => current && setError(message(reason)));
    return () => {
      current = false;
    };
  }, [api, tenantId, assessmentId]);
  if (error && !assessment)
    return (
      <p role="alert" className="nox-design-warning">
        {error}
      </p>
    );
  if (!assessment) return <p aria-busy="true">Loading immutable assessment…</p>;
  const reassess = async () => {
    if (sending.current || !canReassess) return;
    sending.current = true;
    commandKey.current ??= crypto.randomUUID();
    setWorking(true);
    setError(undefined);
    try {
      const result = await api<{ assessment: BrowserReleaseAssessment }>(
        `/release-readiness/assessments/${assessment.id}/reassess`,
        { method: "POST", tenantId, body: { idempotencyKey: commandKey.current } }
      );
      navigate(`/release-readiness/${result.assessment.id}`);
    } catch (reason) {
      setError(message(reason));
    } finally {
      sending.current = false;
      setWorking(false);
    }
  };
  return (
    <section className="nox-design-studio" aria-labelledby="release-detail-title">
      <header className="nox-design-header">
        <div>
          <button
            type="button"
            className="nox-design-back"
            onClick={() => navigate("/release-readiness")}
          >
            ← Assessments
          </button>
          <p className="nox-ai-context">FINAL · IMMUTABLE</p>
          <h1 id="release-detail-title">{assessment.decision.replaceAll("_", " ")}</h1>
        </div>
        <button type="button" disabled={!canReassess || working} onClick={() => void reassess()}>
          {error ? "Retry same reassessment request" : "Reassess Current Evidence"}
        </button>
      </header>
      {error ? (
        <p role="alert">
          {error} No new request key will be generated when retrying this reassessment.
        </p>
      ) : null}
      <dl className="nox-design-intent-list">
        <div>
          <dt>FormulaVersion</dt>
          <dd>
            <code>{assessment.formulaVersionId}</code>
          </dd>
        </div>
        <div>
          <dt>Bundle Hash</dt>
          <dd>
            <code>{assessment.formulaBundleHash}</code>
          </dd>
        </div>
        <div>
          <dt>G4 Approval</dt>
          <dd>{assessment.evidenceSnapshot.approvalState}</dd>
        </div>
        <div>
          <dt>G5 Trace</dt>
          <dd>
            {assessment.evidenceSnapshot.approvalTrace.verified ? "VERIFIED" : "REVIEW REQUIRED"}
          </dd>
        </div>
        <div>
          <dt>Release Profile</dt>
          <dd>
            {assessment.releaseProfile.applicationKey} · {assessment.releaseProfile.dosagePct}%
          </dd>
        </div>
        <div>
          <dt>Policy</dt>
          <dd>
            {assessment.policyKey} · v{assessment.policyVersion}
          </dd>
        </div>
      </dl>
      <p className="nox-design-warning">
        This decision applies only to the recorded release profile, policy version, and immutable
        evidence snapshot. It is not a production or batch release.
      </p>
      {assessment.checks.length === 0 ? (
        <p role="status">
          No check evidence was returned. Do not infer verified readiness from an empty evidence
          list.
        </p>
      ) : null}
      <div className="nox-table-wrap" role="region" aria-label="Assessment evidence" tabIndex={0}>
        <table className="nox-table" aria-label="Assessment checks">
          <thead>
            <tr>
              <th>Group</th>
              <th>Check</th>
              <th>Material</th>
              <th>Result</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {assessment.checks.length === 0 ? (
              <tr>
                <td colSpan={5}>No checks returned.</td>
              </tr>
            ) : null}
            {assessment.checks.map((check, index) => (
              <tr key={`${check.checkKey}-${check.materialId ?? "formula"}-${index}`}>
                <td>
                  {check.subjectType === "FORMULA"
                    ? "Eligibility / Mapping"
                    : "Known Limits / Evidence"}
                </td>
                <td>{check.checkKey.replaceAll("_", " ")}</td>
                <td>
                  {check.materialId ? <code>{check.materialId.slice(0, 8)}</code> : "Formula"}
                </td>
                <td>
                  <strong>{check.result}</strong>
                </td>
                <td>{check.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {assessment.supersedesAssessmentId ? (
        <p className="nox-design-muted">
          Supersedes immutable assessment <code>{assessment.supersedesAssessmentId}</code>.
        </p>
      ) : null}
    </section>
  );
}

export function ReleaseReadinessExperience({
  api,
  tenantId,
  modulePermissions
}: {
  api: ApiClient;
  tenantId?: string;
  modulePermissions: readonly string[];
}) {
  const location = useLocation();
  if (!tenantId || !has(modulePermissions, permissions.read)) {
    return (
      <section>
        <p className="nox-ai-context">403 · PERMISSION_DENIED</p>
        <h1>Release Readiness access denied</h1>
      </section>
    );
  }
  if (location.pathname === "/release-readiness/new") {
    return has(modulePermissions, permissions.create) && has(modulePermissions, permissions.run) ? (
      <NewAssessment key={tenantId} api={api} tenantId={tenantId} />
    ) : (
      <section>
        <h1>Assessment permission required</h1>
      </section>
    );
  }
  const detail = matchPath("/release-readiness/:assessmentId", location.pathname);
  if (detail?.params.assessmentId) {
    return (
      <Detail
        key={`${tenantId}:${detail.params.assessmentId}`}
        api={api}
        tenantId={tenantId}
        assessmentId={detail.params.assessmentId}
        canReassess={
          has(modulePermissions, permissions.run) && has(modulePermissions, permissions.review)
        }
      />
    );
  }
  return (
    <Registry
      key={tenantId}
      api={api}
      tenantId={tenantId}
      canCreate={
        has(modulePermissions, permissions.create) && has(modulePermissions, permissions.run)
      }
    />
  );
}
