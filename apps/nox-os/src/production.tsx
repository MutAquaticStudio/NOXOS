import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import {
  useWorkspaceObject,
  NoxReadFeedback,
  NoxDialog,
  useUnsavedChanges,
  type NoxReadState
} from "@nox-os/ui";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { ApiClient } from "./platform-control";
import { NoxApiError } from "./api-client";
import { formatMassMg } from "@nox-os/design-studio/browser";

type ProductionOrder = {
  id: string;
  tenantId: string;
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
  tenantId: string;
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
type BatchDraft = {
  key: string;
  actualOutputMassMg: string;
  processNotes: string;
  abortReason: string;
};

function formatMass(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const raw = String(value);
  if (!/^-?(0|[1-9][0-9]*)$/.test(raw)) return "Invalid mass";
  return raw.startsWith("-") ? `−${formatMassMg(raw.slice(1))}` : formatMassMg(raw);
}

function ErrorMessage({ error }: { error?: unknown }) {
  return error ? (
    <p role="alert">
      Production request could not be completed. Review current state and permissions before further
      action.
    </p>
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

// Local Production confirmation only; server lifecycle and transactions stay authoritative.
function useProductionCommand(
  api: ApiClient,
  tenantId: string,
  permissions: string[],
  onSuccess: (payload: { batch?: ProductionBatch }) => void,
  onRefresh: () => void
) {
  const [intent, setIntent] = useState<{
    path: string;
    permission: string;
    body?: unknown;
    summary: string;
    phase: "CONFIRM" | "PENDING" | "UNKNOWN" | "REJECTED";
  }>();
  const locked = useRef(false);
  const sending = useRef(false);
  const current = useRef(true);
  const grants = useRef(permissions);
  grants.current = permissions;
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  useUnsavedChanges(Boolean(intent));
  const start = (path: string, permission: string, summary: string, body?: unknown) => {
    if (locked.current || !grants.current.includes(permission)) return;
    locked.current = true;
    setIntent({ path, permission, body, summary, phase: "CONFIRM" });
  };
  const dismiss = () => {
    if (intent?.phase === "CONFIRM" || intent?.phase === "REJECTED") {
      setIntent(undefined);
      locked.current = false;
    }
  };
  const send = async () => {
    if (!intent || intent.phase !== "CONFIRM" || sending.current) return;
    if (!grants.current.includes(intent.permission)) {
      setIntent({ ...intent, phase: "REJECTED" });
      return;
    }
    sending.current = true;
    setIntent({ ...intent, phase: "PENDING" });
    try {
      const result = await api<{ batch?: ProductionBatch }>(intent.path, {
        method: "POST",
        tenantId,
        body: intent.body
      });
      if (current.current) onSuccess(result);
    } catch (error) {
      if (current.current)
        setIntent({
          ...intent,
          phase:
            error instanceof NoxApiError && error.status >= 400 && error.status < 500
              ? "REJECTED"
              : "UNKNOWN"
        });
    } finally {
      sending.current = false;
    }
  };
  const dialog = intent ? (
    <NoxDialog title="Confirm Production action" onClose={dismiss}>
      <p>{intent.summary}</p>
      <p>
        Server rechecks current permissions, readiness and lifecycle. No optimistic state update.
      </p>
      {intent.phase === "PENDING" ? <p role="status">Submitting Production action…</p> : null}
      {intent.phase === "REJECTED" ? (
        <p role="alert">
          Action rejected. Review current state, values and permissions. No retry was sent.
        </p>
      ) : null}
      {intent.phase === "UNKNOWN" ? (
        <>
          <p role="alert">
            Outcome unknown. Read current records before deciding on another action; this command
            will not be resubmitted.
          </p>
          <button type="button" onClick={onRefresh}>
            Read current Production state
          </button>
        </>
      ) : null}
      {intent.phase === "CONFIRM" || intent.phase === "REJECTED" ? (
        <button type="button" onClick={dismiss}>
          Cancel action
        </button>
      ) : null}
      {intent.phase === "CONFIRM" ? (
        <button type="button" onClick={() => void send()}>
          Confirm action
        </button>
      ) : null}
    </NoxDialog>
  ) : null;
  return { start, blocked: Boolean(intent), dialog };
}

type ProductionExperienceProps = {
  api: ApiClient;
  tenantId?: string;
  modulePermissions?: string[];
};

export function ProductionExperience(props: ProductionExperienceProps) {
  const location = useLocation();
  return <ProductionWorkspace key={`${props.tenantId}:${location.pathname}`} {...props} />;
}

function ProductionWorkspace({ api, tenantId, modulePermissions = [] }: ProductionExperienceProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ orderId?: string; batchId?: string }>();
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [order, setOrder] = useState<ProductionOrder>();
  const [batch, setBatch] = useState<ProductionBatch>();
  const [error, setError] = useState<unknown>();
  const [readState, setReadState] = useState<NoxReadState>("LOADING");
  const batchDraft = useRef<BatchDraft | undefined>(undefined);
  const [reload, setReload] = useState(0);
  const canRead = modulePermissions.includes(READ);
  const isNew = location.pathname === "/production/new";
  const isBatch = location.pathname.startsWith("/production/batches/");
  const isOrder = location.pathname.startsWith("/production/orders/");
  const workspaceObject = useMemo(() => {
    if (error || readState !== "READY" || !tenantId || !modulePermissions.includes(READ))
      return undefined;
    if (isBatch && batch && batch.id === params.batchId)
      return {
        id: batch.id,
        objectType: "ProductionBatch",
        title: batch.batchNumber,
        route: `/production/batches/${batch.id}`,
        readOnly: Boolean(batch.completedAt || batch.abortedAt),
        properties: [
          { label: "Production order", value: batch.productionOrderId },
          { label: "FormulaVersion", value: batch.formulaVersionId },
          { label: "Target mass", value: `${batch.targetMassMg} mg` },
          {
            label: "Actual output",
            value:
              batch.actualOutputMassMg === null ? "Not recorded" : `${batch.actualOutputMassMg} mg`
          }
        ]
      };
    if (isOrder && order && order.id === params.orderId)
      return {
        id: order.id,
        objectType: "ProductionOrder",
        title: order.orderNumber,
        route: `/production/orders/${order.id}`,
        properties: [
          { label: "Status", value: order.status },
          { label: "FormulaVersion", value: order.formulaVersionId },
          { label: "Target mass", value: `${order.targetMassMg} mg` },
          { label: "Bundle hash", value: order.formulaBundleHash }
        ]
      };
    return undefined;
  }, [
    error,
    readState,
    tenantId,
    modulePermissions,
    isBatch,
    isOrder,
    batch,
    order,
    params.batchId,
    params.orderId
  ]);
  useWorkspaceObject(workspaceObject);

  useEffect(() => {
    let current = true;
    setError(undefined);
    setReadState("LOADING");
    setOrders([]);
    setOrder(undefined);
    setBatch(undefined);
    if (!tenantId || !canRead || isNew) return;
    void (async () => {
      if (isBatch && params.batchId) {
        const payload = await api<{ batch: ProductionBatch }>(
          `/production/batches/${params.batchId}`,
          { tenantId }
        );
        if (
          !payload.batch ||
          payload.batch.id !== params.batchId ||
          payload.batch.tenantId !== tenantId ||
          !Array.isArray(payload.batch.allocations)
        )
          throw new Error("Invalid batch response");
        if (current) setBatch(payload.batch);
      } else if (isOrder && params.orderId) {
        const payload = await api<{ order: ProductionOrder }>(
          `/production/orders/${params.orderId}`,
          { tenantId }
        );
        if (
          !payload.order ||
          payload.order.id !== params.orderId ||
          payload.order.tenantId !== tenantId ||
          !Array.isArray(payload.order.lines) ||
          !Array.isArray(payload.order.allocations)
        )
          throw new Error("Invalid order response");
        if (current) setOrder(payload.order);
      } else {
        const payload = await api<{ orders: ProductionOrder[] }>("/production", { tenantId });
        if (
          !Array.isArray(payload.orders) ||
          payload.orders.some((item) => !item || item.tenantId !== tenantId)
        )
          throw new Error("Invalid registry response");
        if (current) setOrders(payload.orders);
      }
      if (current) setReadState("READY");
    })().catch(() => {
      if (current) setReadState("ERROR");
    });
    return () => {
      current = false;
    };
  }, [api, tenantId, canRead, isNew, isBatch, isOrder, params.batchId, params.orderId, reload]);

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
      <NewOrder
        key={tenantId}
        api={api}
        tenantId={tenantId}
        permissions={modulePermissions}
        navigate={navigate}
      />
    );
  if ((isBatch || isOrder) && readState !== "READY")
    return (
      <section>
        <h1>Production</h1>
        <NoxReadFeedback
          state={readState}
          subject="Production"
          retry={() => setReload((value) => value + 1)}
        />
      </section>
    );
  if (isBatch && batch)
    return (
      <BatchDetail
        key={`${tenantId}:${batch.id}:${reload}`}
        draftCache={batchDraft}
        api={api}
        tenantId={tenantId}
        batch={batch}
        permissions={modulePermissions}
        onRefresh={() => setReload((value) => value + 1)}
      />
    );
  if (isOrder && order)
    return (
      <OrderDetail
        key={`${tenantId}:${order.id}:${reload}`}
        api={api}
        tenantId={tenantId}
        order={order}
        permissions={modulePermissions}
        navigate={navigate}
        onRefresh={() => setReload((value) => value + 1)}
      />
    );
  return (
    <section aria-labelledby="production-title">
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
      <NoxReadFeedback
        state={readState}
        subject="Production"
        retry={() => setReload((value) => value + 1)}
      />
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
            ) : readState === "READY" ? (
              <tr>
                <td colSpan={8}>No production orders found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
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
  const sending = useRef(false);
  const current = useRef(true);
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  const [uncertain, setUncertain] = useState(false);
  useUnsavedChanges(
    Boolean(orderNumber || formulaVersionId || targetMassMg || notes || working || uncertain)
  );
  if (!permissions.includes(CREATE)) return <p role="alert">Permission denied.</p>;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current || uncertain || !permissions.includes(CREATE)) return;
    sending.current = true;
    setWorking(true);
    setError(undefined);
    try {
      const payload = await api<{ order: ProductionOrder }>("/production/orders", {
        method: "POST",
        tenantId,
        body: { orderNumber, formulaVersionId, targetMassMg, notes: notes.trim() || null }
      });
      if (!current.current) return;
      if (!payload?.order?.id) throw new Error("Unconfirmed order identity");
      setOrderNumber("");
      setFormulaVersionId("");
      setTargetMassMg("");
      setNotes("");
      navigate(`/production/orders/${encodeURIComponent(payload.order.id)}`);
    } catch (reason) {
      setError(reason);
      setUncertain(!(reason instanceof NoxApiError && reason.status >= 400 && reason.status < 500));
    } finally {
      sending.current = false;
      setWorking(false);
    }
  };
  return (
    <section aria-labelledby="new-production-title">
      <p className="nox-ai-context">OPERATIONS / PRODUCTION</p>
      <h1 id="new-production-title">New production order</h1>
      <p>Requirements are generated from the frozen, approved FULL_FORMULA on the server.</p>
      <ErrorMessage error={error} />
      {uncertain ? (
        <p role="status">
          Outcome unknown. Draft is retained and locked. Review the order registry before submitting
          another order; no automatic retry is available.
        </p>
      ) : null}
      <fieldset disabled={working || uncertain}>
        <form className="nox-control-form" onSubmit={submit} aria-label="Create production order">
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
      </fieldset>
    </section>
  );
}

function OrderDetail({
  api,
  tenantId,
  order,
  permissions,
  navigate,
  onRefresh
}: {
  api: ApiClient;
  tenantId: string;
  order: ProductionOrder;
  permissions: string[];
  navigate: ReturnType<typeof useNavigate>;
  onRefresh: () => void;
}) {
  const guarded = useProductionCommand(
    api,
    tenantId,
    permissions,
    (payload) => {
      if (payload?.batch) navigate(`/production/batches/${encodeURIComponent(payload.batch.id)}`);
      else onRefresh();
    },
    onRefresh
  );
  const command = (path: string, permission: string) =>
    guarded.start(
      path,
      permission,
      `${order.orderNumber} · FormulaVersion ${order.formulaVersionId} · ${order.targetMassMg} mg. ${permission === START ? "START consumes exact reserved stock and creates a batch; current G6 readiness is rechecked." : permission === RELEASE ? "RELEASE reserves stock; On Hand stays unchanged." : "CANCEL follows current order and reservation rules; no stock consumption."}`
    );
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
        <fieldset disabled={guarded.blocked} className="nox-table-actions">
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
        </fieldset>
      </header>
      {guarded.dialog}
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
    </section>
  );
}

function BatchDetail({
  draftCache,
  api,
  tenantId,
  batch,
  permissions,
  onRefresh
}: {
  draftCache: RefObject<BatchDraft | undefined>;
  api: ApiClient;
  tenantId: string;
  batch: ProductionBatch;
  permissions: string[];
  onRefresh: () => void;
}) {
  const key = `${tenantId}:${batch.id}`;
  const initial = draftCache.current?.key === key ? draftCache.current : undefined;
  const [actualOutputMassMg, setActualOutputMassMg] = useState(initial?.actualOutputMassMg ?? "");
  const [processNotes, setProcessNotes] = useState(initial?.processNotes ?? "");
  const [abortReason, setAbortReason] = useState(initial?.abortReason ?? "");
  useEffect(() => {
    draftCache.current = { key, actualOutputMassMg, processNotes, abortReason };
  }, [draftCache, key, actualOutputMassMg, processNotes, abortReason]);
  const terminal = Boolean(batch.completedAt || batch.abortedAt);
  useUnsavedChanges(Boolean(actualOutputMassMg || processNotes || abortReason));
  const guarded = useProductionCommand(
    api,
    tenantId,
    permissions,
    () => {
      draftCache.current = undefined;
      setActualOutputMassMg("");
      setProcessNotes("");
      setAbortReason("");
      onRefresh();
    },
    onRefresh
  );
  const command = (path: string, body: unknown, permission: string) => {
    if (terminal) return;
    guarded.start(
      path,
      permission,
      `${batch.batchNumber} · FormulaVersion ${batch.formulaVersionId}. ${permission === COMPLETE ? `COMPLETE records ${actualOutputMassMg} mg actual output only; it does not release QC or create finished goods.` : `ABORT: ${abortReason}. Consumed stock is not automatically returned.`}`,
      body
    );
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
      {guarded.dialog}
      {!terminal ? (
        <fieldset disabled={guarded.blocked} className="nox-control-form">
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
              aria-label="Process notes"
              value={processNotes}
              onChange={(event) => setProcessNotes(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!actualOutputMassMg || !permissions.includes(COMPLETE)}
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
            disabled={!abortReason.trim() || !permissions.includes(ABORT)}
            onClick={() =>
              void command(`/production/batches/${batch.id}/abort`, { reason: abortReason }, ABORT)
            }
          >
            Abort batch
          </button>
        </fieldset>
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
