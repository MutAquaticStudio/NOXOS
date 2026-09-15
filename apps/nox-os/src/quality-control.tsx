import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  useWorkspaceObject,
  NoxReadFeedback,
  NoxDialog,
  useUnsavedChanges,
  type NoxReadState
} from "@nox-os/ui";
import { Link, Route, Routes, useNavigate, useParams, useLocation } from "react-router-dom";
import { NoxApiError } from "./api-client";
import type {
  BatchInspection,
  BatchSpecification,
  QualityBatchView
} from "@nox-os/quality-control/browser";
import type { ApiClient } from "./platform-control";

const permissions = {
  read: "module.quality-control.read",
  manageSpecification: "module.quality-control.specification.manage",
  createInspection: "module.quality-control.inspection.create",
  editInspection: "module.quality-control.inspection.edit",
  finalizeInspection: "module.quality-control.inspection.finalize",
  cancelInspection: "module.quality-control.inspection.cancel",
  holdBatch: "module.quality-control.batch.hold",
  releaseBatch: "module.quality-control.batch.release",
  rejectBatch: "module.quality-control.batch.reject"
} as const;

type Props = { api: ApiClient; tenantId?: string; modulePermissions?: string[] };
const allowed = (values: string[], permission: string) => values.includes(permission);
const message = (_error: unknown) =>
  "Quality Control request could not be completed. Review current state and permissions.";

function Registry({ api, tenantId, modulePermissions = [] }: Props) {
  const [batches, setBatches] = useState<QualityBatchView[]>([]);
  const [readState, setReadState] = useState<NoxReadState>("LOADING");
  const [reload, setReload] = useState(0);
  const canRead = allowed(modulePermissions, permissions.read);
  useEffect(() => {
    let current = true;
    setReadState("LOADING");
    setBatches([]);
    if (!tenantId || !canRead) return;
    void api<{ batches: QualityBatchView[] }>("/quality-control", { tenantId })
      .then((value) => {
        if (!Array.isArray(value.batches)) throw new Error("Invalid registry response");
        if (!current) return;
        setBatches(value.batches);
        setReadState("READY");
      })
      .catch(() => current && setReadState("ERROR"));
    return () => {
      current = false;
    };
  }, [api, tenantId, canRead, reload]);
  return (
    <section aria-labelledby="qc-title">
      <header className="nox-module-header">
        <div>
          <p className="nox-ai-context">OPERATIONS / QUALITY CONTROL</p>
          <h1 id="qc-title">Quality Control</h1>
          <p>Inspection evidence and explicit whole-Batch disposition.</p>
        </div>
        {allowed(modulePermissions, permissions.manageSpecification) ? (
          <Link className="nox-button" to="/quality-control/specifications">
            Specifications
          </Link>
        ) : null}
      </header>
      <NoxReadFeedback
        state={readState}
        subject="Quality Control"
        retry={() => setReload((value) => value + 1)}
      />
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <caption className="sr-only">
            Completed Production Batches awaiting or holding QC disposition
          </caption>
          <thead>
            <tr>
              <th>Batch</th>
              <th>Formula</th>
              <th>Production</th>
              <th>Actual output</th>
              <th>QC inspection</th>
              <th>QC outcome</th>
              <th>Current G6</th>
              <th>Disposition</th>
              <th>Decision time</th>
            </tr>
          </thead>
          <tbody>
            {batches.length ? (
              batches.map((value) => (
                <tr key={value.batch.batchId}>
                  <td>
                    <Link to={`/quality-control/batches/${value.batch.batchId}`}>
                      {value.batch.batchNumber}
                    </Link>
                  </td>
                  <td>
                    <code>{value.batch.formulaVersionId}</code>
                  </td>
                  <td>{value.batch.productionOrderStatus}</td>
                  <td>{value.batch.actualOutputMassMg ?? "—"} mg</td>
                  <td>{value.currentInspection?.inspectionNumber ?? "Not started"}</td>
                  <td>
                    {value.currentInspection?.outcome ??
                      value.currentInspection?.status ??
                      "PENDING"}
                  </td>
                  <td>
                    {value.currentReadiness.status === "RESOLVED"
                      ? value.currentReadiness.decision
                      : value.currentReadiness.status}
                  </td>
                  <td>{value.disposition}</td>
                  <td>
                    {value.currentDecision
                      ? new Date(value.currentDecision.decidedAt).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))
            ) : readState === "READY" ? (
              <tr>
                <td colSpan={9}>No completed Production Batches found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Specifications({ api, tenantId, modulePermissions = [] }: Props) {
  const navigate = useNavigate();
  const [values, setValues] = useState<BatchSpecification[]>([]);
  const [readState, setReadState] = useState<NoxReadState>("LOADING");
  const readGeneration = useRef(0);
  const [error, setError] = useState<unknown>();
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const draftForm = useRef<HTMLFormElement>(null);
  const [creating, setCreating] = useState<"IDLE" | "PENDING" | "UNKNOWN">("IDLE");
  const createLock = useRef(false);
  const current = useRef(true);
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  useUnsavedChanges(dirty || creating !== "IDLE");
  const load = useCallback(() => {
    if (!tenantId) return;
    const generation = ++readGeneration.current;
    setReadState("LOADING");
    setValues([]);
    void api<{ specifications: BatchSpecification[] }>("/quality-control/specifications", {
      tenantId
    })
      .then((value) => {
        if (
          !Array.isArray(value.specifications) ||
          value.specifications.some(
            (spec) => !spec || spec.tenantId !== tenantId || !Array.isArray(spec.items)
          )
        )
          throw new Error("Invalid specifications");
        if (current.current && generation === readGeneration.current) {
          setValues(value.specifications);
          setReadState("READY");
        }
      })
      .catch(() => {
        if (current.current && generation === readGeneration.current) setReadState("ERROR");
      });
  }, [api, tenantId]);
  useEffect(load, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !tenantId ||
      createLock.current ||
      readState !== "READY" ||
      !allowed(modulePermissions, permissions.manageSpecification) ||
      !event.currentTarget.reportValidity()
    )
      return;
    const data = new FormData(event.currentTarget);
    createLock.current = true;
    setCreating("PENDING");
    try {
      const response = await api<{ specification: BatchSpecification }>(
        "/quality-control/specifications",
        {
          method: "POST",
          tenantId,
          body: {
            specificationCode: data.get("code"),
            versionNumber: Number(data.get("version")),
            formulaVersionId: data.get("formulaVersionId"),
            formulaBundleHash: data.get("bundleHash"),
            notes: data.get("notes") || null
          }
        }
      );
      if (!current.current) return;
      if (!response.specification?.id) throw new Error("Invalid creation response");
      setDirty(false);
      setCreating("IDLE");
      navigate(`/quality-control/specifications/${encodeURIComponent(response.specification.id)}`);
    } catch (value) {
      if (!current.current) return;
      setError(value);
      if (value instanceof NoxApiError && value.status >= 400 && value.status < 500) {
        createLock.current = false;
        setCreating("IDLE");
      } else setCreating("UNKNOWN");
    }
  }
  return (
    <section aria-labelledby="qc-specifications-title">
      <header className="nox-module-header">
        <div>
          <Link to="/quality-control">← Quality Control</Link>
          <h1 id="qc-specifications-title">Batch Specifications</h1>
          <p>Versioned criteria for exact approved Formula lineage.</p>
        </div>
      </header>
      {error ? <p role="alert">{message(error)}</p> : null}
      {readState !== "READY" ? (
        <NoxReadFeedback state={readState} subject="Specifications" retry={load} />
      ) : values.length === 0 ? (
        <p>No specifications recorded.</p>
      ) : null}
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Version</th>
              <th>Formula</th>
              <th>Status</th>
              <th>Items</th>
            </tr>
          </thead>
          <tbody>
            {values.map((value) => (
              <tr key={value.id}>
                <td>
                  <Link to={`/quality-control/specifications/${value.id}`}>
                    {value.specificationCode}
                  </Link>
                </td>
                <td>{value.versionNumber}</td>
                <td>
                  <code>{value.formulaVersionId}</code>
                </td>
                <td>{value.status}</td>
                <td>{value.items.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {allowed(modulePermissions, permissions.manageSpecification) ? (
        <form
          aria-label="Create specification"
          ref={draftForm}
          onChange={() => setDirty(true)}
          onSubmit={(event) => void submit(event)}
        >
          {creating === "PENDING" ? <p role="status">Creating specification…</p> : null}
          {creating === "UNKNOWN" ? (
            <p role="alert">
              Creation outcome unknown. Draft retained; do not submit again until current
              specifications are reconciled.
            </p>
          ) : null}
          <fieldset
            className="nox-design-panel nox-qc-creation"
            disabled={creating !== "IDLE" || readState !== "READY"}
          >
            <h2>New DRAFT specification</h2>
            <label>
              Code
              <input name="code" required />
            </label>
            <label>
              Version
              <input name="version" type="number" min="1" required />
            </label>
            <label>
              FormulaVersion ID
              <input name="formulaVersionId" required />
            </label>
            <label>
              Bundle Hash
              <input name="bundleHash" pattern="[a-f0-9]{64}" required />
            </label>
            <label>
              Notes
              <textarea name="notes" />
            </label>
            <button type="submit">Create DRAFT</button>
            {dirty ? (
              <button type="button" onClick={() => setDiscard(true)}>
                Discard draft
              </button>
            ) : null}
          </fieldset>
          {discard ? (
            <NoxDialog title="Discard specification draft" onClose={() => setDiscard(false)}>
              <p>Discard unsaved specification fields? No server data will be changed.</p>
              <button type="button" onClick={() => setDiscard(false)}>
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => {
                  if (creating !== "IDLE") return;
                  draftForm.current?.reset();
                  setDirty(false);
                  setDiscard(false);
                }}
              >
                Discard unsaved fields
              </button>
            </NoxDialog>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

function SpecificationDetail({ api, tenantId, modulePermissions = [] }: Props) {
  const { specificationId = "" } = useParams();
  const [value, setValue] = useState<BatchSpecification>();
  const [error, setError] = useState<unknown>();
  const [intent, setIntent] = useState<"items" | "activate" | "retire">();
  const [phase, setPhase] = useState<"CONFIRM" | "PENDING" | "UNKNOWN" | "SAVED">("CONFIRM");
  const locked = useRef(false);
  const current = useRef(true);
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  useUnsavedChanges(Boolean(intent));
  const workspaceObject = useMemo(
    () =>
      !error && value?.id === specificationId && value.tenantId === tenantId
        ? {
            id: value.id,
            objectType: "QCSpecification",
            title: `${value.specificationCode} · v${value.versionNumber}`,
            route: `/quality-control/specifications/${value.id}`,
            properties: [
              { label: "Status", value: value.status },
              { label: "FormulaVersion", value: value.formulaVersionId },
              { label: "Version", value: String(value.versionNumber) },
              { label: "Bundle hash", value: value.formulaBundleHash }
            ]
          }
        : undefined,
    [value, specificationId, tenantId, error]
  );
  useWorkspaceObject(workspaceObject);
  const load = useCallback(() => {
    if (!tenantId) return;
    return api<{ specification: BatchSpecification }>(
      `/quality-control/specifications/${specificationId}`,
      { tenantId }
    ).then((result) => {
      if (
        !result.specification ||
        result.specification.id !== specificationId ||
        result.specification.tenantId !== tenantId ||
        !Array.isArray(result.specification.items)
      )
        throw new Error("Invalid specification");
      if (current.current) {
        setValue(result.specification);
        setError(undefined);
      }
    });
  }, [api, tenantId, specificationId]);
  useEffect(() => {
    void load()?.catch(setError);
  }, [load]);
  async function setDefaultItems() {
    if (!tenantId) return;
    await api(`/quality-control/specifications/${specificationId}/items`, {
      method: "PUT",
      tenantId,
      body: {
        items: [
          {
            itemOrder: 1,
            checkKey: "specific-gravity",
            name: "Specific gravity",
            checkType: "NUMERIC_RANGE",
            unitCode: "ratio",
            minValue: "0.850",
            maxValue: "0.900"
          },
          {
            itemOrder: 2,
            checkKey: "appearance-clear",
            name: "Appearance clear",
            checkType: "BOOLEAN",
            expectedBoolean: true
          },
          {
            itemOrder: 3,
            checkKey: "odor-conformance",
            name: "Odor conformance",
            checkType: "QUALITATIVE",
            acceptanceCriteriaText: "Conforms to approved reference."
          }
        ]
      }
    });
  }
  async function confirm() {
    if (
      !tenantId ||
      !intent ||
      locked.current ||
      !allowed(modulePermissions, permissions.manageSpecification)
    )
      return;
    if (value?.status !== (intent === "retire" ? "ACTIVE" : "DRAFT")) return;
    locked.current = true;
    setPhase("PENDING");
    try {
      if (intent === "items") await setDefaultItems();
      else
        await api(`/quality-control/specifications/${specificationId}/${intent}`, {
          method: "POST",
          tenantId
        });
    } catch (result) {
      if (!current.current) return;
      setError(result);
      if (result instanceof NoxApiError && result.status >= 400 && result.status < 500) {
        locked.current = false;
        setPhase("CONFIRM");
      } else setPhase("UNKNOWN");
      return;
    }
    if (!current.current) return;
    try {
      await load();
      if (current.current) {
        locked.current = false;
        setIntent(undefined);
        setPhase("CONFIRM");
      }
    } catch {
      if (current.current) setPhase("SAVED");
    }
  }
  if (!value)
    return (
      <section>
        <Link to="/quality-control/specifications">← Specifications</Link>
        <NoxReadFeedback
          state={error ? "ERROR" : "LOADING"}
          subject="Specification"
          retry={() => {
            setError(undefined);
            void load()?.catch(setError);
          }}
        />
      </section>
    );
  return (
    <section aria-labelledby="qc-spec-title">
      <Link to="/quality-control/specifications">← Specifications</Link>
      <header className="nox-module-header">
        <div>
          <p className="nox-ai-context">{value.status}</p>
          <h1 id="qc-spec-title">
            {value.specificationCode} · v{value.versionNumber}
          </h1>
          <p>
            <code>{value.formulaVersionId}</code>
          </p>
        </div>
        {allowed(modulePermissions, permissions.manageSpecification) ? (
          <fieldset disabled={Boolean(intent)}>
            {value.status === "DRAFT" ? (
              <>
                <button type="button" onClick={() => setIntent("items")}>
                  Load baseline items
                </button>
                <button type="button" onClick={() => setIntent("activate")}>
                  Activate
                </button>
              </>
            ) : value.status === "ACTIVE" ? (
              <button type="button" onClick={() => setIntent("retire")}>
                Retire
              </button>
            ) : null}
          </fieldset>
        ) : null}
      </header>
      {intent ? (
        <NoxDialog
          title="Confirm specification action"
          onClose={() => {
            if (phase === "CONFIRM") setIntent(undefined);
          }}
        >
          <p>
            {value.specificationCode} · v{value.versionNumber} · {specificationId}
          </p>
          <p>
            {intent === "items"
              ? "Replace all current checks with baseline examples: specific gravity 0.850–0.900 ratio; appearance clear = true; odor conforms to approved reference. These are not validated limits for this formula. Review before activation."
              : intent === "activate"
                ? "Activate this specification for matching FormulaVersion inspections. Verify every acceptance criterion; this does not release a batch."
                : "Retire this specification from new inspections. Existing inspection evidence remains unchanged."}
          </p>
          {phase === "CONFIRM" ? (
            <>
              <button type="button" onClick={() => setIntent(undefined)}>
                Cancel action
              </button>
              <button type="button" onClick={() => void confirm()}>
                Confirm action
              </button>
            </>
          ) : (
            <p role="status">
              {phase === "PENDING"
                ? "Submitting specification action…"
                : phase === "UNKNOWN"
                  ? "Outcome unknown. Do not resubmit; review current specification."
                  : "Change saved. Refresh failed; retry the read only."}
            </p>
          )}
          {phase === "SAVED" || phase === "UNKNOWN" ? (
            <button
              type="button"
              onClick={() => {
                void load()
                  ?.then(() => {
                    if (current.current && phase === "SAVED") {
                      locked.current = false;
                      setIntent(undefined);
                      setPhase("CONFIRM");
                    }
                  })
                  .catch(setError);
              }}
            >
              Read current specification
            </button>
          ) : null}
        </NoxDialog>
      ) : null}
      {error ? <p role="alert">{message(error)}</p> : null}
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Check</th>
              <th>Type</th>
              <th>Criteria</th>
            </tr>
          </thead>
          <tbody>
            {value.items.map((item) => (
              <tr key={item.id}>
                <td>{item.itemOrder}</td>
                <td>{item.name}</td>
                <td>{item.checkType}</td>
                <td>
                  {item.checkType === "NUMERIC_RANGE"
                    ? `${item.minValue ?? "—"}–${item.maxValue ?? "—"} ${item.unitCode}`
                    : item.checkType === "BOOLEAN"
                      ? String(item.expectedBoolean)
                      : item.acceptanceCriteriaText}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BatchDetail({ api, tenantId, modulePermissions = [] }: Props) {
  const navigate = useNavigate();
  const { batchId = "" } = useParams();
  const [value, setValue] = useState<QualityBatchView>();
  const [specifications, setSpecifications] = useState<BatchSpecification[]>([]);
  const [error, setError] = useState<unknown>();
  const [decision, setDecision] = useState<"hold" | "release" | "reject">();
  const [reason, setReason] = useState("");
  const [decisionState, setDecisionState] = useState<"CONFIRM" | "PENDING" | "UNKNOWN">("CONFIRM");
  const [inspectionDraft, setInspectionDraft] = useState(false);
  const [discardInspection, setDiscardInspection] = useState(false);
  const inspectionForm = useRef<HTMLFormElement>(null);
  const [inspectionCreation, setInspectionCreation] = useState<"IDLE" | "PENDING" | "UNKNOWN">(
    "IDLE"
  );
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );
  useUnsavedChanges(Boolean(decision) || inspectionDraft || inspectionCreation !== "IDLE");
  const load = useCallback(() => {
    if (!tenantId) return;
    void Promise.all([
      api<{ batch: QualityBatchView }>(`/quality-control/batches/${batchId}`, { tenantId }),
      api<{ specifications: BatchSpecification[] }>("/quality-control/specifications", { tenantId })
    ])
      .then(([batch, specs]) => {
        setValue(batch.batch);
        setSpecifications(specs.specifications ?? []);
      })
      .catch(setError);
  }, [api, tenantId, batchId]);
  useEffect(load, [load]);
  async function createInspection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !tenantId ||
      sending.current ||
      decision ||
      !allowed(modulePermissions, permissions.createInspection) ||
      !event.currentTarget.reportValidity()
    )
      return;
    const data = new FormData(event.currentTarget);
    sending.current = true;
    setInspectionCreation("PENDING");
    try {
      const response = await api<{ inspection: BatchInspection }>("/quality-control/inspections", {
        method: "POST",
        tenantId,
        body: {
          batchId,
          specificationId: data.get("specificationId"),
          sampleReference: data.get("sampleReference") || null
        }
      });
      if (!mounted.current) return;
      if (!response.inspection?.id) throw new Error("Invalid creation response");
      setInspectionDraft(false);
      setInspectionCreation("IDLE");
      navigate(`/quality-control/inspections/${encodeURIComponent(response.inspection.id)}`);
    } catch (result) {
      if (!mounted.current) return;
      setError(result);
      if (result instanceof NoxApiError && result.status >= 400 && result.status < 500) {
        sending.current = false;
        setInspectionCreation("IDLE");
      } else setInspectionCreation("UNKNOWN");
    }
  }
  async function decide() {
    if (!tenantId || !decision || sending.current || decisionState !== "CONFIRM") return;
    const permission = {
      hold: permissions.holdBatch,
      release: permissions.releaseBatch,
      reject: permissions.rejectBatch
    }[decision];
    if (!allowed(modulePermissions, permission) || (decision !== "release" && !reason.trim())) {
      setError(new Error("Decision unavailable"));
      return;
    }
    sending.current = true;
    setDecisionState("PENDING");
    try {
      await api(`/quality-control/batches/${batchId}/${decision}`, {
        method: "POST",
        tenantId,
        body: decision !== "release" ? { reason: reason.trim() } : undefined
      });
      if (!mounted.current) return;
      setDecision(undefined);
      setReason("");
      setError(undefined);
      sending.current = false;
      setDecisionState("CONFIRM");
      load();
    } catch (result) {
      if (!mounted.current) return;
      setError(result);
      if (result instanceof NoxApiError && result.status >= 400 && result.status < 500) {
        sending.current = false;
        setDecisionState("CONFIRM");
      } else setDecisionState("UNKNOWN");
    }
  }
  if (!value)
    return (
      <section>
        <Link to="/quality-control">← Quality Control</Link>
        {error ? <p role="alert">{message(error)}</p> : <p>Loading Batch…</p>}
      </section>
    );
  return (
    <section aria-labelledby="qc-batch-title">
      <Link to="/quality-control">← Quality Control</Link>
      <header className="nox-module-header">
        <div>
          <p className="nox-ai-context">
            PRODUCTION {value.batch.productionOrderStatus} · QC{" "}
            {value.currentInspection?.outcome ?? "PENDING"}
          </p>
          <h1 id="qc-batch-title">{value.batch.batchNumber}</h1>
          <p>
            Disposition: <strong>{value.disposition}</strong>
          </p>
        </div>
        <fieldset disabled={Boolean(decision) || inspectionCreation !== "IDLE" || inspectionDraft}>
          {allowed(modulePermissions, permissions.holdBatch) ? (
            <button type="button" onClick={() => setDecision("hold")}>
              Hold
            </button>
          ) : null}
          {allowed(modulePermissions, permissions.releaseBatch) ? (
            <button type="button" onClick={() => setDecision("release")}>
              Release
            </button>
          ) : null}
          {allowed(modulePermissions, permissions.rejectBatch) ? (
            <button
              type="button"
              className="nox-danger-action"
              onClick={() => setDecision("reject")}
            >
              Reject
            </button>
          ) : null}
        </fieldset>
      </header>
      {decision ? (
        <NoxDialog
          title="Confirm QC decision"
          onClose={() => {
            if (decisionState === "CONFIRM") {
              setDecision(undefined);
              setReason("");
            }
          }}
        >
          <p>
            {decision.toUpperCase()} · {value.batch.batchNumber} · {batchId}
          </p>
          <p>
            {decision === "release"
              ? "Release is terminal and rechecks current G6 readiness. QC PASS alone is not release."
              : decision === "reject"
                ? "Reject is terminal. This decision does not return inventory or change Production Batch truth."
                : "Hold records a QC decision. It does not change inventory or Production Batch truth."}
          </p>
          {decision !== "release" ? (
            <label>
              Decision reason
              <textarea
                aria-label="Decision reason"
                value={reason}
                disabled={decisionState !== "CONFIRM"}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          ) : null}
          {decisionState === "PENDING" ? <p role="status">Submitting decision…</p> : null}
          {decisionState === "UNKNOWN" ? (
            <>
              <p role="alert">
                Outcome unknown. Do not resubmit. Read current batch state before further action.
              </p>
              <p>Last read disposition: {value.disposition}</p>
              <button type="button" onClick={load}>
                Read current batch state
              </button>
            </>
          ) : null}
          {decisionState === "CONFIRM" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setDecision(undefined);
                  setReason("");
                }}
              >
                Cancel decision
              </button>
              <button type="button" onClick={() => void decide()}>
                Confirm decision
              </button>
            </>
          ) : null}
        </NoxDialog>
      ) : null}
      {error ? <p role="alert">{message(error)}</p> : null}
      <dl className="nox-detail-list">
        <dt>FormulaVersion</dt>
        <dd>
          <code>{value.batch.formulaVersionId}</code>
        </dd>
        <dt>Bundle Hash</dt>
        <dd>
          <code>{value.batch.formulaBundleHash}</code>
        </dd>
        <dt>Actual output</dt>
        <dd>{value.batch.actualOutputMassMg} mg</dd>
        <dt>Current G6</dt>
        <dd>
          {value.currentReadiness.status === "RESOLVED"
            ? value.currentReadiness.decision
            : value.currentReadiness.status}
        </dd>
      </dl>
      {value.currentInspection ? (
        <p>
          <Link to={`/quality-control/inspections/${value.currentInspection.id}`}>
            Open {value.currentInspection.inspectionNumber}
          </Link>
        </p>
      ) : allowed(modulePermissions, permissions.createInspection) ? (
        <form
          aria-label="Start inspection"
          ref={inspectionForm}
          onChange={() => setInspectionDraft(true)}
          onSubmit={(event) => void createInspection(event)}
        >
          {inspectionCreation === "PENDING" ? <p role="status">Creating inspection…</p> : null}
          {inspectionCreation === "UNKNOWN" ? (
            <p role="alert">
              Inspection creation outcome unknown. Sample reference retained; do not resubmit until
              current batch inspections are reconciled.
            </p>
          ) : null}
          <fieldset
            className="nox-design-panel nox-qc-creation"
            disabled={Boolean(decision) || inspectionCreation !== "IDLE"}
          >
            <h2>Start inspection</h2>
            <label>
              Active specification
              <select name="specificationId" required>
                <option value="">Select…</option>
                {specifications
                  .filter(
                    (spec) =>
                      spec.status === "ACTIVE" &&
                      spec.formulaVersionId === value.batch.formulaVersionId &&
                      spec.formulaBundleHash === value.batch.formulaBundleHash
                  )
                  .map((spec) => (
                    <option key={spec.id} value={spec.id}>
                      {spec.specificationCode} v{spec.versionNumber}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Sample reference
              <input name="sampleReference" />
            </label>
            <button type="submit">Create inspection</button>
            {inspectionDraft ? (
              <button type="button" onClick={() => setDiscardInspection(true)}>
                Discard draft
              </button>
            ) : null}
          </fieldset>
          {discardInspection ? (
            <NoxDialog title="Discard inspection draft" onClose={() => setDiscardInspection(false)}>
              <p>
                Discard the selected specification and sample reference? No inspection will be
                created.
              </p>
              <button type="button" onClick={() => setDiscardInspection(false)}>
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => {
                  if (inspectionCreation !== "IDLE") return;
                  inspectionForm.current?.reset();
                  setInspectionDraft(false);
                  setDiscardInspection(false);
                }}
              >
                Discard unsaved fields
              </button>
            </NoxDialog>
          ) : null}
        </form>
      ) : null}
      <h2>Consumed input provenance</h2>
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Lot</th>
              <th>Location</th>
              <th>Consumed</th>
              <th>Movement</th>
            </tr>
          </thead>
          <tbody>
            {value.batch.allocations.map((row) => (
              <tr key={row.inventoryConsumptionMovementId}>
                <td>
                  <code>{row.materialId}</code>
                </td>
                <td>
                  <code>{row.inventoryLotId}</code>
                </td>
                <td>
                  <code>{row.inventoryLocationId}</code>
                </td>
                <td>{row.consumedMassMg} mg</td>
                <td>
                  <code>{row.inventoryConsumptionMovementId}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InspectionDetail({ api, tenantId, modulePermissions = [] }: Props) {
  const navigate = useNavigate();
  const { inspectionId = "" } = useParams();
  const [value, setValue] = useState<BatchInspection>();
  const [specification, setSpecification] = useState<BatchSpecification>();
  const [error, setError] = useState<unknown>();
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"IDLE" | "PENDING" | "UNKNOWN" | "REFRESH_REQUIRED">(
    "IDLE"
  );
  const saveLock = useRef(false);
  const [intent, setIntent] = useState<"finalize" | "cancel" | "reinspect">();
  const [retestReason, setRetestReason] = useState("");
  const [actionState, setActionState] = useState<"CONFIRM" | "PENDING" | "UNKNOWN">("CONFIRM");
  const actionLock = useRef(false);
  const current = useRef(true);
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  useUnsavedChanges(dirty || saveState !== "IDLE" || Boolean(intent));
  const workspaceObject = useMemo(
    () =>
      !error && value?.id === inspectionId && value.tenantId === tenantId
        ? {
            id: value.id,
            objectType: "QCInspection",
            title: value.inspectionNumber,
            route: `/quality-control/inspections/${value.id}`,
            readOnly: value.status !== "DRAFT",
            properties: [
              { label: "Status", value: value.status },
              { label: "QC outcome (not Batch Release)", value: value.outcome ?? "Not assessed" },
              { label: "Batch", value: value.batchId },
              { label: "Specification", value: value.specificationId }
            ]
          }
        : undefined,
    [value, inspectionId, tenantId, error]
  );
  useWorkspaceObject(workspaceObject);
  const load = useCallback(() => {
    if (!tenantId) return;
    return api<{ inspection: BatchInspection }>(`/quality-control/inspections/${inspectionId}`, {
      tenantId
    }).then(async (result) => {
      if (
        !result.inspection ||
        result.inspection.id !== inspectionId ||
        result.inspection.tenantId !== tenantId ||
        !Array.isArray(result.inspection.results)
      )
        throw new Error("Invalid inspection response");
      const spec = await api<{ specification: BatchSpecification }>(
        `/quality-control/specifications/${result.inspection.specificationId}`,
        { tenantId }
      );
      if (
        !spec.specification ||
        spec.specification.id !== result.inspection.specificationId ||
        spec.specification.tenantId !== tenantId ||
        !Array.isArray(spec.specification.items)
      )
        throw new Error("Invalid specification response");
      if (!current.current) return;
      setError(undefined);
      setValue(result.inspection);
      setSpecification(spec.specification);
    });
  }, [api, tenantId, inspectionId]);
  useEffect(() => {
    void load()?.catch(setError);
  }, [load]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !tenantId ||
      saveLock.current ||
      Boolean(intent) ||
      !specification ||
      value?.status !== "DRAFT" ||
      !allowed(modulePermissions, permissions.editInspection) ||
      !event.currentTarget.reportValidity()
    )
      return;
    const data = new FormData(event.currentTarget);
    const results = specification.items.map((item) =>
      item.checkType === "NUMERIC_RANGE"
        ? {
            checkType: item.checkType,
            specificationItemId: item.id,
            observedNumericValue: String(data.get(item.id) ?? "")
          }
        : item.checkType === "BOOLEAN"
          ? {
              checkType: item.checkType,
              specificationItemId: item.id,
              observedBooleanValue: data.get(item.id) === "true"
            }
          : {
              checkType: item.checkType,
              specificationItemId: item.id,
              observedText: String(data.get(`${item.id}-text`) ?? ""),
              judgement: data.get(item.id)
            }
    );
    saveLock.current = true;
    setSaveState("PENDING");
    try {
      await api(`/quality-control/inspections/${inspectionId}/results`, {
        method: "PUT",
        tenantId,
        body: { results }
      });
    } catch (result) {
      if (!current.current) return;
      setError(result);
      if (result instanceof NoxApiError && result.status >= 400 && result.status < 500) {
        saveLock.current = false;
        setSaveState("IDLE");
      } else setSaveState("UNKNOWN");
      return;
    }
    if (!current.current) return;
    setDirty(false);
    setError(undefined);
    try {
      await load();
      if (current.current) {
        saveLock.current = false;
        setSaveState("IDLE");
      }
    } catch {
      if (current.current) setSaveState("REFRESH_REQUIRED");
    }
  }
  async function action() {
    if (!tenantId || saveLock.current || dirty || !intent || actionLock.current) return;
    const name = intent;
    const permission = {
      finalize: permissions.finalizeInspection,
      cancel: permissions.cancelInspection,
      reinspect: permissions.createInspection
    }[name];
    if (
      !allowed(modulePermissions, permission) ||
      value?.status !== (name === "reinspect" ? "FINAL" : "DRAFT")
    ) {
      setError(new Error("Action unavailable"));
      return;
    }
    const body = name === "reinspect" ? { retestReason: retestReason.trim() } : undefined;
    if (name === "reinspect" && !body?.retestReason) return;
    actionLock.current = true;
    setActionState("PENDING");
    try {
      const result = await api<{ inspection: BatchInspection }>(
        `/quality-control/inspections/${inspectionId}/${name}`,
        { method: "POST", tenantId, body }
      );
      if (!current.current) return;
      if (name === "reinspect") {
        if (!result.inspection?.id) throw new Error("Invalid response");
        navigate(`/quality-control/inspections/${encodeURIComponent(result.inspection.id)}`);
      } else {
        try {
          await load();
        } catch {
          setSaveState("REFRESH_REQUIRED");
          saveLock.current = true;
        }
      }
      if (current.current) {
        setIntent(undefined);
        setRetestReason("");
        setActionState("CONFIRM");
        actionLock.current = false;
      }
    } catch (result) {
      if (!current.current) return;
      setError(result);
      if (result instanceof NoxApiError && result.status >= 400 && result.status < 500) {
        actionLock.current = false;
        setActionState("CONFIRM");
      } else setActionState("UNKNOWN");
    }
  }
  if (!value || !specification)
    return (
      <section>
        <h1>QC Inspection</h1>
        <NoxReadFeedback
          state={error ? "ERROR" : "LOADING"}
          subject="Inspection"
          retry={() => {
            setError(undefined);
            void load()?.catch(setError);
          }}
        />
      </section>
    );
  return (
    <section aria-labelledby="qc-inspection-title">
      <Link to={`/quality-control/batches/${value.batchId}`}>← Batch</Link>
      <header className="nox-module-header">
        <div>
          <p className="nox-ai-context">
            {value.status}
            {value.outcome ? ` · ${value.outcome}` : ""}
          </p>
          <h1 id="qc-inspection-title">{value.inspectionNumber}</h1>
          <p>
            {specification.specificationCode} v{specification.versionNumber}
          </p>
        </div>
        <fieldset disabled={saveState !== "IDLE" || dirty || Boolean(intent)}>
          {value.status === "DRAFT" &&
          allowed(modulePermissions, permissions.finalizeInspection) ? (
            <button type="button" onClick={() => setIntent("finalize")}>
              Finalize
            </button>
          ) : null}
          {value.status === "DRAFT" && allowed(modulePermissions, permissions.cancelInspection) ? (
            <button type="button" onClick={() => setIntent("cancel")}>
              Cancel
            </button>
          ) : null}
          {value.status === "FINAL" && allowed(modulePermissions, permissions.createInspection) ? (
            <button type="button" onClick={() => setIntent("reinspect")}>
              Reinspect
            </button>
          ) : null}
        </fieldset>
      </header>
      {intent ? (
        <NoxDialog
          title="Confirm inspection action"
          onClose={() => {
            if (actionState === "CONFIRM") {
              setIntent(undefined);
              setRetestReason("");
            }
          }}
        >
          <p>
            {intent.toUpperCase()} · {value.inspectionNumber} · {inspectionId}
          </p>
          <p>
            {intent === "finalize"
              ? "Finalize saved inspection evidence. QC PASS does not release this batch."
              : intent === "cancel"
                ? "Cancel this draft inspection. This does not change Batch Release or inventory."
                : "Create a new linked inspection. Existing finalized evidence remains unchanged."}
          </p>
          {intent === "reinspect" ? (
            <label>
              Retest reason
              <textarea
                aria-label="Retest reason"
                value={retestReason}
                disabled={actionState !== "CONFIRM"}
                onChange={(event) => setRetestReason(event.target.value)}
              />
            </label>
          ) : null}
          {actionState === "CONFIRM" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setIntent(undefined);
                  setRetestReason("");
                }}
              >
                Cancel action
              </button>
              <button type="button" onClick={() => void action()}>
                Confirm action
              </button>
            </>
          ) : (
            <p role="status">
              {actionState === "PENDING"
                ? "Submitting inspection action…"
                : "Outcome unknown. Do not resubmit; review current inspection evidence."}
            </p>
          )}
        </NoxDialog>
      ) : null}
      {error ? <p role="alert">{message(error)}</p> : null}
      {dirty ? (
        <p role="status">Unsaved observations. Save before changing inspection status.</p>
      ) : null}
      {saveState === "PENDING" ? <p role="status">Saving observations…</p> : null}
      {saveState === "UNKNOWN" ? (
        <p role="alert">
          Save outcome unknown. Draft retained; do not resubmit until current inspection evidence is
          reconciled.
        </p>
      ) : null}
      {saveState === "REFRESH_REQUIRED" ? (
        <p role="alert">
          Change saved, but current inspection could not be refreshed.{" "}
          <button
            type="button"
            onClick={() => {
              void load()
                ?.then(() => {
                  if (current.current) {
                    saveLock.current = false;
                    setSaveState("IDLE");
                  }
                })
                .catch(setError);
            }}
          >
            Retry inspection read
          </button>
        </p>
      ) : null}
      <form onChange={() => setDirty(true)} onSubmit={(event) => void save(event)}>
        <fieldset disabled={saveState !== "IDLE" || Boolean(intent)}>
          <div className="nox-table-wrap" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Criteria</th>
                  <th>Observation</th>
                  <th>Judgement</th>
                </tr>
              </thead>
              <tbody>
                {specification.items.map((item) => {
                  const existing = value.results.find(
                    (result) => result.specificationItemId === item.id
                  );
                  return (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>
                        {item.checkType === "NUMERIC_RANGE"
                          ? `${item.minValue ?? "—"}–${item.maxValue ?? "—"} ${item.unitCode}`
                          : item.checkType === "BOOLEAN"
                            ? String(item.expectedBoolean)
                            : item.acceptanceCriteriaText}
                      </td>
                      <td>
                        {item.checkType === "NUMERIC_RANGE" ? (
                          <input
                            name={item.id}
                            aria-label={`${item.name} observation`}
                            defaultValue={existing?.observedNumericValue ?? ""}
                            disabled={
                              value.status !== "DRAFT" ||
                              !allowed(modulePermissions, permissions.editInspection)
                            }
                            required
                          />
                        ) : item.checkType === "BOOLEAN" ? (
                          <select
                            name={item.id}
                            aria-label={`${item.name} observation`}
                            defaultValue={
                              existing?.observedBooleanValue == null
                                ? ""
                                : String(existing.observedBooleanValue)
                            }
                            disabled={
                              value.status !== "DRAFT" ||
                              !allowed(modulePermissions, permissions.editInspection)
                            }
                            required
                          >
                            <option value="">Select observation…</option>
                            <option value="true">True</option>
                            <option value="false">False</option>
                          </select>
                        ) : (
                          <textarea
                            name={`${item.id}-text`}
                            aria-label={`${item.name} observation`}
                            defaultValue={existing?.observedText ?? ""}
                            disabled={
                              value.status !== "DRAFT" ||
                              !allowed(modulePermissions, permissions.editInspection)
                            }
                            required
                          />
                        )}
                      </td>
                      <td>
                        {item.checkType === "QUALITATIVE" && value.status === "DRAFT" ? (
                          <select
                            name={item.id}
                            aria-label={`${item.name} judgement`}
                            defaultValue={existing?.judgement ?? ""}
                            required
                            disabled={!allowed(modulePermissions, permissions.editInspection)}
                          >
                            <option value="">Select judgement…</option>
                            <option>PASS</option>
                            <option>REVIEW_REQUIRED</option>
                            <option>FAIL</option>
                          </select>
                        ) : (
                          (existing?.judgement ?? "Server derived")
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {value.status === "DRAFT" && allowed(modulePermissions, permissions.editInspection) ? (
            <button type="submit">Save observations</button>
          ) : null}
        </fieldset>
      </form>
    </section>
  );
}

export function QualityControlExperience(props: Props) {
  const location = useLocation();
  if (!props.tenantId)
    return (
      <section>
        <h1>Quality Control</h1>
        <p>Select a tenant workspace to continue.</p>
      </section>
    );
  if (!allowed(props.modulePermissions ?? [], permissions.read))
    return (
      <section>
        <h1>Quality Control</h1>
        <p role="alert">Permission denied.</p>
      </section>
    );
  return (
    <Routes key={`${props.tenantId}:${location.pathname}`}>
      <Route index element={<Registry {...props} />} />
      <Route path="specifications" element={<Specifications {...props} />} />
      <Route path="specifications/:specificationId" element={<SpecificationDetail {...props} />} />
      <Route path="batches/:batchId" element={<BatchDetail {...props} />} />
      <Route path="inspections/:inspectionId" element={<InspectionDetail {...props} />} />
    </Routes>
  );
}
