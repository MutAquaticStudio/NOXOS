import { useEffect, useState, type FormEvent } from "react";
import { matchPath, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { BrowserReleaseAssessment } from "@nox-os/release-readiness/browser";
import type { ApiClient } from "./platform-control";

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
  return reason instanceof Error ? reason.message : "Release Readiness operation failed.";
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
  const [error, setError] = useState<string>();
  useEffect(() => {
    let current = true;
    void api<{ assessments: BrowserReleaseAssessment[] }>("/release-readiness", { tenantId })
      .then((result) => current && setAssessments(result.assessments))
      .catch((reason) => current && setError(message(reason)));
    return () => {
      current = false;
    };
  }, [api, tenantId]);

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
      {error ? (
        <p role="alert" className="nox-design-warning">
          {error}
        </p>
      ) : null}
      <div className="nox-material-table-wrap">
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
            {assessments.map((item) => (
              <tr key={item.id}>
                <td>
                  <button
                    type="button"
                    className="nox-design-back"
                    onClick={() => navigate(`/release-readiness/${item.id}`)}
                  >
                    <code>{item.formulaVersionId.slice(0, 8)}</code>
                  </button>
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
      {assessments.length === 0 ? (
        <p className="nox-design-muted">No release assessments.</p>
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
  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
            policyKey: "g6-known-limit-v1"
          }
        }
      );
      navigate(`/release-readiness/${result.assessment.id}`);
    } catch (reason) {
      setError(message(reason));
    } finally {
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
            onClick={() => navigate("/release-readiness")}
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
            value={formulaVersionId}
            onChange={(event) => setFormulaVersionId(event.target.value)}
            required
          />
        </label>
        <label>
          Application
          <select
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
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
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
  if (error)
    return (
      <p role="alert" className="nox-design-warning">
        {error}
      </p>
    );
  if (!assessment) return <p aria-busy="true">Loading immutable assessment…</p>;
  const reassess = async () => {
    setWorking(true);
    try {
      const result = await api<{ assessment: BrowserReleaseAssessment }>(
        `/release-readiness/assessments/${assessment.id}/reassess`,
        { method: "POST", tenantId }
      );
      navigate(`/release-readiness/${result.assessment.id}`);
    } catch (reason) {
      setError(message(reason));
    } finally {
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
          Reassess Current Evidence
        </button>
      </header>
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
      <div className="nox-material-table-wrap">
        <table className="nox-material-table">
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
      <NewAssessment api={api} tenantId={tenantId} />
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
      api={api}
      tenantId={tenantId}
      canCreate={
        has(modulePermissions, permissions.create) && has(modulePermissions, permissions.run)
      }
    />
  );
}
