import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { ApiClient } from "./platform-control";

type ProductionOrder = {
  id: string;
  orderNumber: string;
  formulaVersionId: string;
  formulaBundleHash: string;
  targetMassMg: string;
  status: string;
  releaseReadinessAssessmentId: string | null;
  notes: string | null;
  lines: Array<{
    id: string;
    materialId: string;
    requiredMassMg: string;
    materialSnapshotHash: string;
  }>;
  allocations: Array<{
    id: string;
    productionOrderLineId: string;
    materialId: string;
    inventoryLotId: string;
    inventoryLocationId: string;
    allocatedMassMg: string;
    inventoryReservationId: string | null;
    inventoryConsumptionMovementId: string | null;
  }>;
};

type ProductionBatch = {
  id: string;
  batchNumber: string;
  productionOrderId: string;
  formulaVersionId: string;
  formulaBundleHash: string;
  releaseReadinessAssessmentId: string;
  startReadinessAssessmentId: string;
  targetMassMg: string;
  actualOutputMassMg: string | null;
  processNotes: string | null;
  abortReason: string | null;
  startedAt: string;
  completedAt: string | null;
  abortedAt: string | null;
  allocations: ProductionOrder["allocations"];
};

const READ = "module.production.read";
const CREATE = "module.production.order.create";
const RELEASE = "module.production.order.release";
const CANCEL = "module.production.order.cancel";
const START = "module.production.batch.start";
const COMPLETE = "module.production.batch.complete";
const ABORT = "module.production.batch.abort";

function formatMass(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const mg = BigInt(String(value));
  if (mg >= 1_000_000n) return `${mg / 1_000_000n} kg ${(mg % 1_000_000n) / 1_000n} g`;
  if (mg >= 1_000n) return `${mg / 1_000n} g ${mg % 1_000n} mg`;
  return `${mg} mg`;
}

function ErrorMessage({ error }: { error?: unknown }) {
  return error ? (
    <p role="alert">{error instanceof Error ? error.message : "Production unavailable."}</p>
  ) : null;
}

function ActionButton({
  label,
  permission,
  permissions,
  onClick,
  dangerous = false
}: {
  label: string;
  permission: string;
  permissions: string[];
  onClick: () => void;
  dangerous?: boolean;
}) {
  if (!permissions.includes(permission)) return null;
  return (
    <button type="button" className={dangerous ? "nox-danger-action" : undefined} onClick={onClick}>
      {label}
    </button>
  );
}

export function ProductionExperience({
  api,
  tenantId,
  modulePermissions = []
}: {
  api: ApiClient;
  tenantId?: string;
  modulePermissions?: string[];
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ orderId?: string; batchId?: string }>();
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [order, setOrder] = useState<ProductionOrder>();
  const [batch, setBatch] = useState<ProductionBatch>();
  const [error, setError] = useState<unknown>();
  const [working, setWorking] = useState(false);
  const isNew = location.pathname === "/production/new";
  const isBatch = location.pathname.startsWith("/production/batches/");
  const isOrder = location.pathname.startsWith("/production/orders/");

  useEffect(() => {
    if (!tenantId || !modulePermissions.includes(READ)) return;
    setError(undefined);
    if (isNew) return;
    if (isBatch && params.batchId) {
      void api<{ batch: ProductionBatch }>(`/production/batches/${params.batchId}`, { tenantId })
        .then((payload) => setBatch(payload.batch))
        .catch(setError);
      return;
    }
    if (isOrder && params.orderId) {
      void api<{ order: ProductionOrder }>(`/production/orders/${params.orderId}`, { tenantId })
        .then((payload) => setOrder(payload.order))
        .catch(setError);
      return;
    }
    void api<{ orders: ProductionOrder[] }>("/production", { tenantId })
      .then((payload) => setOrders(payload.orders ?? []))
      .catch(setError);
  }, [api, tenantId, modulePermissions, isNew, isBatch, isOrder, params.batchId, params.orderId]);

  if (!tenantId)
    return (
      <section>
        <h1>Production</h1>
        <p>Select a tenant workspace to continue.</p>
      </section>
    );
  if (!modulePermissions.includes(READ))
    return (
      <section>
        <h1>Production</h1>
        <p role="alert">Permission denied.</p>
      </section>
    );
  if (isNew)
    return (
      <NewOrder api={api} tenantId={tenantId} permissions={modulePermissions} navigate={navigate} />
    );
  if (isBatch && batch)
    return (
      <BatchDetail
        api={api}
        tenantId={tenantId}
        batch={batch}
        permissions={modulePermissions}
        onRefresh={() => {
          if (params.batchId)
            void api<{ batch: ProductionBatch }>(`/production/batches/${params.batchId}`, {
              tenantId
            })
              .then((payload) => setBatch(payload.batch))
              .catch(setError);
        }}
      />
    );
  if (isOrder && order)
    return (
      <OrderDetail
        api={api}
        tenantId={tenantId}
        order={order}
        permissions={modulePermissions}
        navigate={navigate}
        working={working}
        setWorking={setWorking}
        onRefresh={() => {
          if (params.orderId)
            void api<{ order: ProductionOrder }>(`/production/orders/${params.orderId}`, {
              tenantId
            })
              .then((payload) => setOrder(payload.order))
              .catch(setError);
        }}
      />
    );
  return (
    <main aria-labelledby="production-title">
      <header className="nox-module-header">
        <div>
          <p className="nox-ai-context">OPERATIONS / PRODUCTION</p>
          <h1 id="production-title">Production</h1>
          <p>Manufacturing orders and batch traceability.</p>
        </div>
        {modulePermissions.includes(CREATE) ? (
          <button type="button" onClick={() => navigate("/production/new")}>
            + New order
          </button>
        ) : null}
      </header>
      <ErrorMessage error={error} />
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <caption className="sr-only">Production orders</caption>
          <thead>
            <tr>
              <th>Order</th>
              <th>Formula / version</th>
              <th>Target</th>
              <th>Status</th>
              <th>Readiness</th>
              <th>Allocation</th>
              <th>Started</th>
              <th>Completed</th>
            </tr>
          </thead>
          <tbody>
            {orders.length ? (
              orders.map((item) => (
                <tr key={item.id} onClick={() => navigate(`/production/orders/${item.id}`)}>
                  <td>
                    <button
                      type="button"
                      className="nox-table-link"
                      onClick={() => navigate(`/production/orders/${item.id}`)}
                    >
                      {item.orderNumber}
                    </button>
                  </td>
                  <td>
                    <code>{item.formulaVersionId}</code>
                  </td>
                  <td>{formatMass(item.targetMassMg)}</td>
                  <td>{item.status}</td>
                  <td>{item.releaseReadinessAssessmentId ? "Resolved" : "Pending"}</td>
                  <td>
                    {item.allocations.length}/{item.lines.length} lines
                  </td>
                  <td>
                    {item.status === "IN_PROGRESS" ||
                    item.status === "COMPLETED" ||
                    item.status === "ABORTED"
                      ? "Yes"
                      : "—"}
                  </td>
                  <td>{item.status === "COMPLETED" ? "Yes" : "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8}>No production orders found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function NewOrder({
  api,
  tenantId,
  permissions,
  navigate
}: {
  api: ApiClient;
  tenantId: string;
  permissions: string[];
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [orderNumber, setOrderNumber] = useState("");
  const [formulaVersionId, setFormulaVersionId] = useState("");
  const [targetMassMg, setTargetMassMg] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<unknown>();
  const [working, setWorking] = useState(false);
  if (!permissions.includes(CREATE)) return <p role="alert">Permission denied.</p>;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError(undefined);
    try {
      const payload = await api<{ order: ProductionOrder }>("/production/orders", {
        method: "POST",
        tenantId,
        body: { orderNumber, formulaVersionId, targetMassMg, notes: notes.trim() || null }
      });
      navigate(`/production/orders/${payload.order.id}`);
    } catch (reason) {
      setError(reason);
    } finally {
      setWorking(false);
    }
  };
  return (
    <section aria-labelledby="new-production-title">
      <p className="nox-ai-context">OPERATIONS / PRODUCTION</p>
      <h1 id="new-production-title">New production order</h1>
      <p>Requirements are generated from the frozen, approved FULL_FORMULA on the server.</p>
      <ErrorMessage error={error} />
      <form className="nox-control-form" onSubmit={submit}>
        <label>
          Order number
          <input
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value)}
            required
            maxLength={80}
          />
        </label>
        <label>
          Frozen FormulaVersion ID
          <input
            value={formulaVersionId}
            onChange={(event) => setFormulaVersionId(event.target.value)}
            required
          />
        </label>
        <label>
          Target mass (mg)
          <input
            inputMode="numeric"
            value={targetMassMg}
            onChange={(event) => setTargetMassMg(event.target.value)}
            pattern="[1-9][0-9]*"
            required
          />
        </label>
        <label>
          Notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={4000}
          />
        </label>
        <button type="submit" disabled={working}>
          {working ? "Creating…" : "Create draft order"}
        </button>
      </form>
    </section>
  );
}

function OrderDetail({
  api,
  tenantId,
  order,
  permissions,
  navigate,
  working,
  setWorking,
  onRefresh
}: {
  api: ApiClient;
  tenantId: string;
  order: ProductionOrder;
  permissions: string[];
  navigate: ReturnType<typeof useNavigate>;
  working: boolean;
  setWorking: (value: boolean) => void;
  onRefresh: () => void;
}) {
  const [error, setError] = useState<unknown>();
  const command = async (path: string, permission: string) => {
    if (!permissions.includes(permission)) return;
    setWorking(true);
    setError(undefined);
    try {
      const payload = await api<{ order?: ProductionOrder; batch?: ProductionBatch }>(path, {
        method: "POST",
        tenantId
      });
      if (payload.batch) navigate(`/production/batches/${payload.batch.id}`);
      else onRefresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setWorking(false);
    }
  };
  return (
    <section aria-labelledby="production-order-title">
      <button type="button" onClick={() => navigate("/production")}>
        ← Production
      </button>
      <header className="nox-module-header">
        <div>
          <p className="nox-ai-context">PRODUCTION ORDER</p>
          <h1 id="production-order-title">{order.orderNumber}</h1>
          <p>
            {order.status} · FormulaVersion <code>{order.formulaVersionId}</code>
          </p>
        </div>
        <div className="nox-table-actions">
          {order.status === "DRAFT" ? (
            <ActionButton
              label="Release"
              permission={RELEASE}
              permissions={permissions}
              onClick={() => void command(`/production/orders/${order.id}/release`, RELEASE)}
            />
          ) : null}
          {order.status === "DRAFT" || order.status === "RELEASED" ? (
            <ActionButton
              label="Cancel"
              permission={CANCEL}
              permissions={permissions}
              dangerous
              onClick={() => void command(`/production/orders/${order.id}/cancel`, CANCEL)}
            />
          ) : null}
          {order.status === "RELEASED" ? (
            <ActionButton
              label="Start batch"
              permission={START}
              permissions={permissions}
              onClick={() => void command(`/production/orders/${order.id}/start`, START)}
            />
          ) : null}
        </div>
      </header>
      <ErrorMessage error={error} />
      <dl className="nox-detail-grid">
        <div>
          <dt>Bundle Hash</dt>
          <dd>
            <code>{order.formulaBundleHash}</code>
          </dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{formatMass(order.targetMassMg)}</dd>
        </div>
        <div>
          <dt>G6 readiness</dt>
          <dd>{order.releaseReadinessAssessmentId ?? "Not resolved"}</dd>
        </div>
      </dl>
      <h2>Requirements &amp; allocations</h2>
      <div className="nox-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Required</th>
              <th>Allocated</th>
              <th>Remaining</th>
              <th>Lots</th>
              <th>Reservation</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => {
              const allocations = order.allocations.filter(
                (item) => item.productionOrderLineId === line.id
              );
              const allocated = allocations.reduce(
                (total, item) => total + BigInt(item.allocatedMassMg),
                0n
              );
              return (
                <tr key={line.id}>
                  <td>
                    <code>{line.materialId}</code>
                  </td>
                  <td>{formatMass(line.requiredMassMg)}</td>
                  <td>{formatMass(String(allocated))}</td>
                  <td>{formatMass(String(BigInt(line.requiredMassMg) - allocated))}</td>
                  <td>{allocations.map((item) => item.inventoryLotId).join(", ") || "—"}</td>
                  <td>
                    {allocations.length && allocations.every((item) => item.inventoryReservationId)
                      ? "Reserved"
                      : "Planning"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {working ? <p>Updating production order…</p> : null}
    </section>
  );
}

function BatchDetail({
  api,
  tenantId,
  batch,
  permissions,
  onRefresh
}: {
  api: ApiClient;
  tenantId: string;
  batch: ProductionBatch;
  permissions: string[];
  onRefresh: () => void;
}) {
  const [actualOutputMassMg, setActualOutputMassMg] = useState("");
  const [processNotes, setProcessNotes] = useState("");
  const [abortReason, setAbortReason] = useState("");
  const [error, setError] = useState<unknown>();
  const [working, setWorking] = useState(false);
  const terminal = Boolean(batch.completedAt || batch.abortedAt);
  const command = async (path: string, body: unknown, permission: string) => {
    if (!permissions.includes(permission)) return;
    setWorking(true);
    setError(undefined);
    try {
      await api(path, { method: "POST", tenantId, body });
      onRefresh();
    } catch (reason) {
      setError(reason);
    } finally {
      setWorking(false);
    }
  };
  return (
    <section aria-labelledby="production-batch-title">
      <p className="nox-ai-context">OPERATIONS / PRODUCTION / BATCH</p>
      <h1 id="production-batch-title">{batch.batchNumber}</h1>
      <p>
        FormulaVersion <code>{batch.formulaVersionId}</code> · Target{" "}
        {formatMass(batch.targetMassMg)}
      </p>
      <p className="nox-warning-banner" role="status">
        <strong>QC NOT ASSESSED</strong> — Gate 10 is required for Batch Release.
      </p>
      <ErrorMessage error={error} />
      <dl className="nox-detail-grid">
        <div>
          <dt>Release assessment</dt>
          <dd>
            <code>{batch.releaseReadinessAssessmentId}</code>
          </dd>
        </div>
        <div>
          <dt>Start assessment</dt>
          <dd>
            <code>{batch.startReadinessAssessmentId}</code>
          </dd>
        </div>
        <div>
          <dt>Actual output</dt>
          <dd>{formatMass(batch.actualOutputMassMg)}</dd>
        </div>
      </dl>
      {!terminal ? (
        <div className="nox-control-form">
          <label>
            Actual output (mg)
            <input
              inputMode="numeric"
              value={actualOutputMassMg}
              onChange={(event) => setActualOutputMassMg(event.target.value)}
              pattern="[1-9][0-9]*"
            />
          </label>
          <label>
            Process notes
            <textarea
              value={processNotes}
              onChange={(event) => setProcessNotes(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={working || !actualOutputMassMg || !permissions.includes(COMPLETE)}
            onClick={() =>
              void command(
                `/production/batches/${batch.id}/complete`,
                { actualOutputMassMg, processNotes: processNotes.trim() || null },
                COMPLETE
              )
            }
          >
            Complete batch
          </button>
          <label>
            Abort reason
            <input value={abortReason} onChange={(event) => setAbortReason(event.target.value)} />
          </label>
          <button
            type="button"
            className="nox-danger-action"
            disabled={working || !abortReason.trim() || !permissions.includes(ABORT)}
            onClick={() =>
              void command(`/production/batches/${batch.id}/abort`, { reason: abortReason }, ABORT)
            }
          >
            Abort batch
          </button>
        </div>
      ) : null}
      <h2>Input trace</h2>
      <div className="nox-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Lot</th>
              <th>Location</th>
              <th>Consumed</th>
              <th>Inventory movement</th>
            </tr>
          </thead>
          <tbody>
            {batch.allocations.map((allocation) => (
              <tr key={allocation.id}>
                <td>
                  <code>{allocation.materialId}</code>
                </td>
                <td>
                  <code>{allocation.inventoryLotId}</code>
                </td>
                <td>
                  <code>{allocation.inventoryLocationId}</code>
                </td>
                <td>{formatMass(allocation.allocatedMassMg)}</td>
                <td>
                  <code>{allocation.inventoryConsumptionMovementId ?? "—"}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
