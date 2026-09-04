import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
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
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Quality Control is unavailable.";

function Registry({ api, tenantId, modulePermissions = [] }: Props) {
  const [batches, setBatches] = useState<QualityBatchView[]>([]);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    if (!tenantId || !allowed(modulePermissions, permissions.read)) return;
    void api<{ batches: QualityBatchView[] }>("/quality-control", { tenantId })
      .then((value) => setBatches(value.batches ?? []))
      .catch(setError);
  }, [api, tenantId, modulePermissions]);
  return (
    <main aria-labelledby="qc-title">
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
      {error ? <p role="alert">{message(error)}</p> : null}
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
            ) : (
              <tr>
                <td colSpan={9}>No completed Production Batches found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Specifications({ api, tenantId, modulePermissions = [] }: Props) {
  const navigate = useNavigate();
  const [values, setValues] = useState<BatchSpecification[]>([]);
  const [error, setError] = useState<unknown>();
  const load = useCallback(() => {
    if (!tenantId) return;
    void api<{ specifications: BatchSpecification[] }>("/quality-control/specifications", {
      tenantId
    })
      .then((value) => setValues(value.specifications ?? []))
      .catch(setError);
  }, [api, tenantId]);
  useEffect(load, [load]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) return;
    const data = new FormData(event.currentTarget);
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
      navigate(`/quality-control/specifications/${response.specification.id}`);
    } catch (value) {
      setError(value);
    }
  }
  return (
    <main aria-labelledby="qc-specifications-title">
      <header className="nox-module-header">
        <div>
          <Link to="/quality-control">← Quality Control</Link>
          <h1 id="qc-specifications-title">Batch Specifications</h1>
          <p>Versioned criteria for exact approved Formula lineage.</p>
        </div>
      </header>
      {error ? <p role="alert">{message(error)}</p> : null}
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
        <form className="nox-form-grid" onSubmit={(event) => void submit(event)}>
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
        </form>
      ) : null}
    </main>
  );
}

function SpecificationDetail({ api, tenantId, modulePermissions = [] }: Props) {
  const { specificationId = "" } = useParams();
  const [value, setValue] = useState<BatchSpecification>();
  const [error, setError] = useState<unknown>();
  const load = useCallback(() => {
    if (!tenantId) return;
    void api<{ specification: BatchSpecification }>(
      `/quality-control/specifications/${specificationId}`,
      { tenantId }
    )
      .then((result) => setValue(result.specification))
      .catch(setError);
  }, [api, tenantId, specificationId]);
  useEffect(load, [load]);
  async function setDefaultItems() {
    if (!tenantId) return;
    try {
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
      load();
    } catch (result) {
      setError(result);
    }
  }
  async function action(name: "activate" | "retire") {
    if (!tenantId) return;
    try {
      await api(`/quality-control/specifications/${specificationId}/${name}`, {
        method: "POST",
        tenantId
      });
      load();
    } catch (result) {
      setError(result);
    }
  }
  if (!value)
    return (
      <main>
        <Link to="/quality-control/specifications">← Specifications</Link>
        {error ? <p role="alert">{message(error)}</p> : <p>Loading specification…</p>}
      </main>
    );
  return (
    <main aria-labelledby="qc-spec-title">
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
          <div>
            {value.status === "DRAFT" ? (
              <>
                <button type="button" onClick={() => void setDefaultItems()}>
                  Load baseline items
                </button>
                <button type="button" onClick={() => void action("activate")}>
                  Activate
                </button>
              </>
            ) : value.status === "ACTIVE" ? (
              <button type="button" onClick={() => void action("retire")}>
                Retire
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
      {error ? <p role="alert">{message(error)}</p> : null}
      <div className="nox-table-wrap">
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
    </main>
  );
}

function BatchDetail({ api, tenantId, modulePermissions = [] }: Props) {
  const navigate = useNavigate();
  const { batchId = "" } = useParams();
  const [value, setValue] = useState<QualityBatchView>();
  const [specifications, setSpecifications] = useState<BatchSpecification[]>([]);
  const [error, setError] = useState<unknown>();
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
    if (!tenantId) return;
    const data = new FormData(event.currentTarget);
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
      navigate(`/quality-control/inspections/${response.inspection.id}`);
    } catch (result) {
      setError(result);
    }
  }
  async function decide(action: "hold" | "release" | "reject") {
    if (!tenantId) return;
    const reason =
      action === "release"
        ? undefined
        : window.prompt(action === "hold" ? "Hold reason" : "Reject reason");
    if (action !== "release" && !reason) return;
    try {
      await api(`/quality-control/batches/${batchId}/${action}`, {
        method: "POST",
        tenantId,
        body: reason ? { reason } : undefined
      });
      load();
    } catch (result) {
      setError(result);
    }
  }
  if (!value)
    return (
      <main>
        <Link to="/quality-control">← Quality Control</Link>
        {error ? <p role="alert">{message(error)}</p> : <p>Loading Batch…</p>}
      </main>
    );
  return (
    <main aria-labelledby="qc-batch-title">
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
        <div>
          {allowed(modulePermissions, permissions.holdBatch) ? (
            <button type="button" onClick={() => void decide("hold")}>
              Hold
            </button>
          ) : null}
          {allowed(modulePermissions, permissions.releaseBatch) ? (
            <button type="button" onClick={() => void decide("release")}>
              Release
            </button>
          ) : null}
          {allowed(modulePermissions, permissions.rejectBatch) ? (
            <button
              type="button"
              className="nox-danger-action"
              onClick={() => void decide("reject")}
            >
              Reject
            </button>
          ) : null}
        </div>
      </header>
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
        <form onSubmit={(event) => void createInspection(event)}>
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
        </form>
      ) : null}
      <h2>Consumed input provenance</h2>
      <div className="nox-table-wrap">
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
    </main>
  );
}

function InspectionDetail({ api, tenantId, modulePermissions = [] }: Props) {
  const navigate = useNavigate();
  const { inspectionId = "" } = useParams();
  const [value, setValue] = useState<BatchInspection>();
  const [specification, setSpecification] = useState<BatchSpecification>();
  const [error, setError] = useState<unknown>();
  const load = useCallback(() => {
    if (!tenantId) return;
    void api<{ inspection: BatchInspection }>(`/quality-control/inspections/${inspectionId}`, {
      tenantId
    })
      .then(async (result) => {
        setValue(result.inspection);
        const spec = await api<{ specification: BatchSpecification }>(
          `/quality-control/specifications/${result.inspection.specificationId}`,
          { tenantId }
        );
        setSpecification(spec.specification);
      })
      .catch(setError);
  }, [api, tenantId, inspectionId]);
  useEffect(load, [load]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId || !specification) return;
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
    try {
      await api(`/quality-control/inspections/${inspectionId}/results`, {
        method: "PUT",
        tenantId,
        body: { results }
      });
      load();
    } catch (result) {
      setError(result);
    }
  }
  async function action(name: "finalize" | "cancel" | "reinspect") {
    if (!tenantId) return;
    try {
      const body =
        name === "reinspect" ? { retestReason: window.prompt("Retest reason") } : undefined;
      if (name === "reinspect" && !body?.retestReason) return;
      const result = await api<{ inspection: BatchInspection }>(
        `/quality-control/inspections/${inspectionId}/${name}`,
        { method: "POST", tenantId, body }
      );
      name === "reinspect"
        ? navigate(`/quality-control/inspections/${result.inspection.id}`)
        : load();
    } catch (result) {
      setError(result);
    }
  }
  if (!value || !specification)
    return <main>{error ? <p role="alert">{message(error)}</p> : <p>Loading inspection…</p>}</main>;
  return (
    <main aria-labelledby="qc-inspection-title">
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
        <div>
          {value.status === "DRAFT" &&
          allowed(modulePermissions, permissions.finalizeInspection) ? (
            <button type="button" onClick={() => void action("finalize")}>
              Finalize
            </button>
          ) : null}
          {value.status === "DRAFT" && allowed(modulePermissions, permissions.cancelInspection) ? (
            <button type="button" onClick={() => void action("cancel")}>
              Cancel
            </button>
          ) : null}
          {value.status === "FINAL" && allowed(modulePermissions, permissions.createInspection) ? (
            <button type="button" onClick={() => void action("reinspect")}>
              Reinspect
            </button>
          ) : null}
        </div>
      </header>
      {error ? <p role="alert">{message(error)}</p> : null}
      <form onSubmit={(event) => void save(event)}>
        <div className="nox-table-wrap">
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
                          defaultValue={existing?.observedNumericValue ?? ""}
                          disabled={value.status !== "DRAFT"}
                          required
                        />
                      ) : item.checkType === "BOOLEAN" ? (
                        <select
                          name={item.id}
                          defaultValue={String(existing?.observedBooleanValue ?? true)}
                          disabled={value.status !== "DRAFT"}
                        >
                          <option value="true">True</option>
                          <option value="false">False</option>
                        </select>
                      ) : (
                        <textarea
                          name={`${item.id}-text`}
                          defaultValue={existing?.observedText ?? ""}
                          disabled={value.status !== "DRAFT"}
                          required
                        />
                      )}
                    </td>
                    <td>
                      {item.checkType === "QUALITATIVE" && value.status === "DRAFT" ? (
                        <select name={item.id} defaultValue={existing?.judgement ?? "PASS"}>
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
      </form>
    </main>
  );
}

export function QualityControlExperience(props: Props) {
  if (!props.tenantId)
    return (
      <main>
        <h1>Quality Control</h1>
        <p>Select a tenant workspace to continue.</p>
      </main>
    );
  if (!allowed(props.modulePermissions ?? [], permissions.read))
    return (
      <main>
        <h1>Quality Control</h1>
        <p role="alert">Permission denied.</p>
      </main>
    );
  return (
    <Routes>
      <Route index element={<Registry {...props} />} />
      <Route path="specifications" element={<Specifications {...props} />} />
      <Route path="specifications/:specificationId" element={<SpecificationDetail {...props} />} />
      <Route path="batches/:batchId" element={<BatchDetail {...props} />} />
      <Route path="inspections/:inspectionId" element={<InspectionDetail {...props} />} />
    </Routes>
  );
}
