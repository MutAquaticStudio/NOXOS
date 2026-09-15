import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  useWorkspaceObject,
  NoxReadFeedback,
  NoxDialog,
  useUnsavedChanges,
  type NoxReadState
} from "@nox-os/ui";
import { Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  InventoryLocation,
  MaterialLot,
  StockMovement,
  StockReservation
} from "@nox-os/inventory/browser";
import { formatMassMg } from "@nox-os/trial-sensory/browser";
import type { ApiClient } from "./platform-control";
import { NoxApiError } from "./api-client";

const permissions = {
  read: "module.inventory.read",
  location: "module.inventory.location.manage",
  lotCreate: "module.inventory.lot.create",
  lotManage: "module.inventory.lot.manage",
  receive: "module.inventory.stock.receive",
  transfer: "module.inventory.stock.transfer",
  consume: "module.inventory.stock.consume",
  adjust: "module.inventory.stock.adjust",
  dispose: "module.inventory.stock.dispose",
  reservation: "module.inventory.reservation.manage"
} as const;

const movementPermissions = {
  receive: permissions.receive,
  transfer: permissions.transfer,
  consume: permissions.consume,
  "adjust-in": permissions.adjust,
  "adjust-out": permissions.adjust,
  dispose: permissions.dispose,
  reserve: permissions.reservation
} as const;

function has(values: readonly string[], permission: string): boolean {
  return values.includes(permission);
}

function total(lot: MaterialLot, field: "onHandMg" | "reservedMg" | "availableMg"): string {
  return lot.balances.reduce((sum, item) => sum + BigInt(item[field]), 0n).toString();
}

function issue(reason: unknown): string {
  return "Inventory operation could not be confirmed. Review current state before retrying.";
}

function operationKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function InventoryRegistry({
  api,
  tenantId,
  modulePermissions
}: {
  api: ApiClient;
  tenantId: string;
  modulePermissions: readonly string[];
}) {
  const navigate = useNavigate();
  const [lots, setLots] = useState<MaterialLot[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [error, setError] = useState<string>();
  const [locationCode, setLocationCode] = useState("");
  const [locationName, setLocationName] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [supplierLotCode, setSupplierLotCode] = useState("");
  const [readState, setReadState] = useState<NoxReadState>("LOADING");
  const request = useRef(0);
  const commandLock = useRef(false);
  const [commandState, setCommandState] = useState<"IDLE" | "PENDING" | "UNKNOWN">("IDLE");
  const [archiveTarget, setArchiveTarget] = useState<InventoryLocation>();
  useUnsavedChanges(
    Boolean(
      locationCode ||
      locationName ||
      materialId ||
      lotCode ||
      supplierLotCode ||
      commandState !== "IDLE"
    )
  );
  const runCommand = async (permission: string, action: () => Promise<void>) => {
    if (commandLock.current || readState !== "READY" || !has(modulePermissions, permission)) return;
    commandLock.current = true;
    setCommandState("PENDING");
    setError(undefined);
    try {
      await action();
      commandLock.current = false;
      setCommandState("IDLE");
    } catch (reason) {
      const rejected = reason instanceof NoxApiError && reason.status >= 400 && reason.status < 500;
      commandLock.current = !rejected;
      setCommandState(rejected ? "IDLE" : "UNKNOWN");
      setError(
        rejected
          ? "Server rejected the command. Review values and current permissions."
          : issue(reason)
      );
    }
  };

  const load = useCallback(async () => {
    const generation = ++request.current;
    setReadState("LOADING");
    setLots([]);
    setLocations([]);
    try {
      const [lotPayload, locationPayload] = await Promise.all([
        api<{ lots: MaterialLot[] }>("/inventory/lots", { tenantId }),
        api<{ locations: InventoryLocation[] }>("/inventory/locations", { tenantId })
      ]);
      if (!Array.isArray(lotPayload.lots) || !Array.isArray(locationPayload.locations))
        throw new Error("Invalid registry response");
      if (request.current !== generation) return;
      setLots(lotPayload.lots);
      setLocations(locationPayload.locations);
      setReadState("READY");
    } catch (reason) {
      if (request.current === generation) setReadState("ERROR");
      throw reason;
    }
  }, [api, tenantId]);

  useEffect(() => {
    void load().catch(() => {});
    return () => {
      request.current += 1;
    };
  }, [load]);

  const createLocation = async (event: FormEvent) => {
    event.preventDefault();
    if (archiveTarget) return;
    await runCommand(permissions.location, async () => {
      await api("/inventory/locations", {
        method: "POST",
        tenantId,
        body: { locationCode, name: locationName, description: null }
      });
      setLocationCode("");
      setLocationName("");
      await load().catch(() => setError("Location saved; current records could not be refreshed."));
    });
  };

  const createLot = async (event: FormEvent) => {
    event.preventDefault();
    if (archiveTarget) return;
    await runCommand(permissions.lotCreate, async () => {
      const response = await api<{ lot: MaterialLot }>("/inventory/lots", {
        method: "POST",
        tenantId,
        body: {
          materialId,
          lotCode,
          supplierLotCode: supplierLotCode || null,
          manufacturedAt: null,
          expiresAt: null,
          retestAt: null,
          notes: null
        }
      });
      if (!response?.lot?.id) throw new Error("Unconfirmed created lot identity");
      setMaterialId("");
      setLotCode("");
      setSupplierLotCode("");
      navigate(`/inventory/lots/${encodeURIComponent(response.lot.id)}`);
    });
  };

  const archiveLocation = async (locationId: string) => {
    setArchiveTarget(undefined);
    await runCommand(permissions.location, async () => {
      await api(`/inventory/locations/${locationId}/archive`, { method: "POST", tenantId });
      await load().catch(() =>
        setError("Archive confirmed; current records could not be refreshed.")
      );
    });
  };

  const materialSummary = useMemo(() => {
    const values = new Map<
      string,
      {
        name: string;
        onHand: bigint;
        reserved: bigint;
        available: bigint;
        lots: number;
        locations: Set<string>;
        lastMovementAt: Date | null;
        warnings: Set<string>;
      }
    >();
    for (const lot of lots) {
      const current = values.get(lot.materialId) ?? {
        name: lot.materialDisplayName,
        onHand: 0n,
        reserved: 0n,
        available: 0n,
        lots: 0,
        locations: new Set<string>(),
        lastMovementAt: null,
        warnings: new Set<string>()
      };
      current.onHand += BigInt(total(lot, "onHandMg"));
      current.reserved += BigInt(total(lot, "reservedMg"));
      current.available += BigInt(total(lot, "availableMg"));
      if (lot.lifecycleStatus === "OPEN") current.lots += 1;
      for (const balance of lot.balances) current.locations.add(balance.locationId);
      if (
        lot.lastMovementAt &&
        (!current.lastMovementAt || new Date(lot.lastMovementAt) > current.lastMovementAt)
      )
        current.lastMovementAt = new Date(lot.lastMovementAt);
      if (lot.availabilityStatus === "HOLD") current.warnings.add("HOLD");
      if (lot.expiresAt && new Date(lot.expiresAt) <= new Date()) current.warnings.add("EXPIRED");
      else if (lot.retestAt && new Date(lot.retestAt) <= new Date())
        current.warnings.add("RETEST DUE");
      values.set(lot.materialId, current);
    }
    return [...values.entries()];
  }, [lots]);

  return (
    <section aria-labelledby="inventory-title">
      <header className="nox-section-heading">
        <div>
          <p className="nox-ai-context">INVENTORY & LOT TRACEABILITY</p>
          <h1 id="inventory-title">Inventory Registry</h1>
          <p>Immutable physical stock movements with exact milligram balances.</p>
        </div>
      </header>
      {error ? (
        <p role="alert" className="nox-design-warning">
          {error}
        </p>
      ) : null}
      <NoxReadFeedback
        state={readState}
        subject="Inventory"
        retry={load}
        disabled={
          commandState === "PENDING" ||
          (commandState !== "UNKNOWN" &&
            Boolean(locationCode || locationName || materialId || lotCode || supplierLotCode))
        }
      />
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>On Hand</th>
              <th>Reserved</th>
              <th>Available</th>
              <th>Open Lots</th>
              <th>Locations</th>
              <th>Last Movement</th>
              <th>Hold / Expiry</th>
            </tr>
          </thead>
          <tbody>
            {materialSummary.map(([id, item]) => (
              <tr key={id}>
                <td>
                  <a href={`/materials/${id}`}>{item.name}</a>
                </td>
                <td>{formatMassMg(item.onHand.toString())}</td>
                <td>{formatMassMg(item.reserved.toString())}</td>
                <td>{formatMassMg(item.available.toString())}</td>
                <td>{item.lots}</td>
                <td>{item.locations.size}</td>
                <td>{item.lastMovementAt?.toLocaleString() ?? "—"}</td>
                <td>{[...item.warnings].join(" · ") || "Clear"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {readState === "READY" && materialSummary.length === 0 ? (
        <p className="nox-design-empty">No physical stock has been registered.</p>
      ) : null}

      <h2>Lots</h2>
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Lot</th>
              <th>Material</th>
              <th>Supplier Lot</th>
              <th>On Hand</th>
              <th>Reserved</th>
              <th>Available</th>
              <th>Locations</th>
              <th>State</th>
              <th>Expiry / Retest</th>
              <th>Last Movement</th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <tr
                key={lot.id}
                tabIndex={0}
                onClick={() => navigate(`/inventory/lots/${lot.id}`)}
                onKeyDown={(event) =>
                  event.key === "Enter" && navigate(`/inventory/lots/${lot.id}`)
                }
              >
                <td>
                  <button type="button" onClick={() => navigate(`/inventory/lots/${lot.id}`)}>
                    {lot.lotCode}
                  </button>
                </td>
                <td>{lot.materialDisplayName}</td>
                <td>{lot.supplierLotCode ?? "—"}</td>
                <td>{formatMassMg(total(lot, "onHandMg"))}</td>
                <td>{formatMassMg(total(lot, "reservedMg"))}</td>
                <td>{formatMassMg(total(lot, "availableMg"))}</td>
                <td>{lot.balances.length}</td>
                <td>
                  {lot.lifecycleStatus} · {lot.availabilityStatus}
                </td>
                <td>
                  {lot.expiresAt ? new Date(lot.expiresAt).toLocaleDateString() : "—"} /{" "}
                  {lot.retestAt ? new Date(lot.retestAt).toLocaleDateString() : "—"}
                </td>
                <td>{lot.lastMovementAt ? new Date(lot.lastMovementAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {commandState !== "IDLE" ? (
        <p role="status">
          {commandState === "PENDING"
            ? "Submitting inventory command…"
            : "Outcome unknown. Writes remain locked; read current records before leaving this workspace. Do not resubmit blindly."}
        </p>
      ) : null}
      {archiveTarget ? (
        <NoxDialog title="Archive inventory location" onClose={() => setArchiveTarget(undefined)}>
          <p>
            {archiveTarget.locationCode} · {archiveTarget.name}
          </p>
          <p>
            Archives this location under server stock and reservation rules. No stock movement is
            created.
          </p>
          <button type="button" onClick={() => setArchiveTarget(undefined)}>
            Cancel archive
          </button>
          <button type="button" onClick={() => void archiveLocation(archiveTarget.id)}>
            Confirm archive
          </button>
        </NoxDialog>
      ) : null}
      <fieldset
        disabled={commandState !== "IDLE" || Boolean(archiveTarget) || readState !== "READY"}
        className="nox-trial-form-grid"
      >
        {has(modulePermissions, permissions.location) ? (
          <form
            className="nox-design-panel"
            onSubmit={createLocation}
            aria-label="Create inventory location"
          >
            <h2>Add Location</h2>
            <label>
              Code
              <input
                value={locationCode}
                onChange={(event) => setLocationCode(event.target.value.toUpperCase())}
                required
              />
            </label>
            <label>
              Name
              <input
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                required
              />
            </label>
            <button type="submit">Create Location</button>
          </form>
        ) : null}
        {has(modulePermissions, permissions.lotCreate) ? (
          <form className="nox-design-panel" onSubmit={createLot} aria-label="Create inventory lot">
            <h2>Register Material Lot</h2>
            <label>
              Material UUID
              <input
                value={materialId}
                onChange={(event) => setMaterialId(event.target.value)}
                required
              />
            </label>
            <label>
              Lot code
              <input
                value={lotCode}
                onChange={(event) => setLotCode(event.target.value)}
                required
              />
            </label>
            <label>
              Supplier lot (optional)
              <input
                value={supplierLotCode}
                onChange={(event) => setSupplierLotCode(event.target.value)}
              />
            </label>
            <button type="submit">Create Lot</button>
          </form>
        ) : null}
      </fieldset>

      <h2>Locations</h2>
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Status</th>
              {has(modulePermissions, permissions.location) ? <th>Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {locations.map((item) => (
              <tr key={item.id}>
                <td>{item.locationCode}</td>
                <td>{item.name}</td>
                <td>{item.status}</td>
                {has(modulePermissions, permissions.location) ? (
                  <td>
                    <button
                      type="button"
                      disabled={
                        item.status === "ARCHIVED" ||
                        commandState !== "IDLE" ||
                        Boolean(archiveTarget) ||
                        readState !== "READY"
                      }
                      onClick={() => setArchiveTarget(item)}
                    >
                      Archive
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type DetailPayload = {
  lot: MaterialLot;
  movements: StockMovement[];
  reservations: StockReservation[];
};

function LotDetail({
  api,
  tenantId,
  modulePermissions
}: {
  api: ApiClient;
  tenantId: string;
  modulePermissions: readonly string[];
}) {
  const { lotId = "" } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<DetailPayload>();
  const [readState, setReadState] = useState<NoxReadState>("LOADING");
  const readGeneration = useRef(0);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [locationId, setLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [quantityMg, setQuantityMg] = useState("1000");
  const [operation, setOperation] = useState<
    "receive" | "transfer" | "consume" | "adjust-in" | "adjust-out" | "dispose" | "reserve"
  >("receive");
  const [error, setError] = useState<string>();
  const [movement, setMovement] = useState<{
    path: string;
    body: unknown;
    permission: string;
    summary: string;
    replayable?: boolean;
    state: "CONFIRM" | "PENDING" | "UNKNOWN";
  }>();
  const movementLock = useRef(false);
  const movementSending = useRef(false);
  const [movementDraftDirty, setMovementDraftDirty] = useState(false);
  const livePermissions = useRef(modulePermissions);
  livePermissions.current = modulePermissions;
  useUnsavedChanges(Boolean(movement) || movementDraftDirty);
  useEffect(() => {
    if (movement || has(modulePermissions, movementPermissions[operation])) return;
    const first = (
      Object.keys(movementPermissions) as Array<keyof typeof movementPermissions>
    ).find((value) => has(modulePermissions, movementPermissions[value]));
    if (first) setOperation(first);
  }, [modulePermissions, operation, movement]);
  const workspaceObject = useMemo(
    () =>
      !error && detail?.lot.id === lotId && detail.lot.tenantId === tenantId
        ? {
            id: detail.lot.id,
            objectType: "MaterialLot",
            title: detail.lot.lotCode,
            route: `/inventory/lots/${detail.lot.id}`,
            properties: [
              { label: "Material", value: detail.lot.materialId },
              { label: "On hand", value: `${total(detail.lot, "onHandMg")} mg` },
              { label: "Reserved", value: `${total(detail.lot, "reservedMg")} mg` },
              { label: "Available", value: `${total(detail.lot, "availableMg")} mg` }
            ]
          }
        : undefined,
    [detail, lotId, tenantId, error]
  );
  useWorkspaceObject(workspaceObject);

  const load = useCallback(async () => {
    const generation = ++readGeneration.current;
    setReadState("LOADING");
    setDetail(undefined);
    setLocations([]);
    try {
      const [value, locationPayload] = await Promise.all([
        api<DetailPayload>(`/inventory/lots/${lotId}`, { tenantId }),
        api<{ locations: InventoryLocation[] }>("/inventory/locations", { tenantId })
      ]);
      if (
        value?.lot?.id !== lotId ||
        value.lot.tenantId !== tenantId ||
        !Array.isArray(value.lot.balances) ||
        !Array.isArray(value.movements) ||
        !Array.isArray(value.reservations) ||
        !Array.isArray(locationPayload.locations) ||
        value.lot.balances.some(
          (balance) =>
            !balance ||
            ![balance.onHandMg, balance.reservedMg, balance.availableMg].every(
              (mass) => typeof mass === "string" && /^\d+$/.test(mass)
            )
        )
      )
        throw new Error("Invalid lot response");
      if (generation !== readGeneration.current) return;
      setDetail(value);
      const active = locationPayload.locations.filter((item) => item.status === "ACTIVE");
      setLocations(active);
      setLocationId((current) => current || active[0]?.id || "");
      setToLocationId((current) => current || active[1]?.id || active[0]?.id || "");
      setReadState("READY");
    } catch (reason) {
      if (generation === readGeneration.current) setReadState("ERROR");
      throw reason;
    }
  }, [api, tenantId, lotId]);

  useEffect(() => {
    void load().catch(() => {});
    return () => {
      readGeneration.current += 1;
    };
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (movementLock.current || !detail) return;
    setError(undefined);
    const key = operationKey(`inventory:${operation}:${lotId}`);
    const routes = {
      receive: {
        path: "receive",
        body: { quantityMg, toLocationId: locationId, reasonCode: null, operationKey: key }
      },
      transfer: {
        path: "transfer",
        body: {
          quantityMg,
          fromLocationId: locationId,
          toLocationId,
          reasonCode: null,
          operationKey: key
        }
      },
      consume: {
        path: "consume",
        body: { quantityMg, fromLocationId: locationId, reasonCode: null, operationKey: key }
      },
      "adjust-in": {
        path: "adjust",
        body: { direction: "IN", quantityMg, locationId, reasonCode: null, operationKey: key }
      },
      "adjust-out": {
        path: "adjust",
        body: { direction: "OUT", quantityMg, locationId, reasonCode: null, operationKey: key }
      },
      dispose: {
        path: "dispose",
        body: { quantityMg, fromLocationId: locationId, reasonCode: null, operationKey: key }
      },
      reserve: {
        path: "reservations",
        body: { quantityMg, locationId, sourceReferenceId: null, operationKey: key }
      }
    } as const;
    const permission = movementPermissions[operation];
    if (!has(modulePermissions, permission)) {
      setError("This operation is not permitted.");
      return;
    }
    const target = routes[operation];
    movementLock.current = true;
    setMovement({
      path: `/inventory/lots/${lotId}/${target.path}`,
      body: target.body,
      permission,
      summary: `${operation} · Lot ${detail.lot.lotCode} · ${quantityMg} mg · Location ${locationId}${operation === "transfer" ? " → " + toLocationId : ""}. ${operation === "reserve" ? "Reduces Available only; On Hand is unchanged." : "Records a physical stock movement."}`,
      state: "CONFIRM"
    });
  };

  const sendMovement = async () => {
    if (!movement || movement.state === "PENDING") return;
    if (movement.state === "UNKNOWN" && movement.replayable === false) return;
    // Ref prevents two synchronous confirmations/retries before React rerenders.
    if (movementSending.current) return;
    if (!livePermissions.current.includes(movement.permission)) {
      setError("Permission changed. No further request was sent.");
      return;
    }
    movementSending.current = true;
    setMovement({ ...movement, state: "PENDING" });
    try {
      await api(movement.path, { method: "POST", tenantId, body: movement.body });
    } catch (reason) {
      const rejected = reason instanceof NoxApiError && reason.status >= 400 && reason.status < 500;
      if (rejected && movement.state === "CONFIRM") {
        setMovement(undefined);
        movementLock.current = false;
      } else setMovement({ ...movement, state: "UNKNOWN" });
      setError(
        rejected
          ? "Server rejected the operation. Review current state and permissions."
          : movement.replayable === false
            ? "Outcome unknown. Read current state before further action."
            : "Outcome unknown. Retry only the same recorded request."
      );
      movementSending.current = false;
      return;
    }
    if (movement.replayable !== false) setMovementDraftDirty(false);
    setMovement(undefined);
    setError(undefined);
    try {
      await load();
    } catch {
      setError("Operation saved; current lot could not be reloaded.");
    }
    movementLock.current = false;
    movementSending.current = false;
  };

  const changeLotState = async (action: "hold" | "release-hold" | "close") => {
    if (movementLock.current || !detail || !has(modulePermissions, permissions.lotManage)) return;
    setError(undefined);
    movementLock.current = true;
    setMovement({
      path: `/inventory/lots/${lotId}/${action}`,
      body: undefined,
      permission: permissions.lotManage,
      replayable: false,
      state: "CONFIRM",
      summary: `${action} · Lot ${detail.lot.lotCode}. ${action === "close" ? "Closes this lot under server balance and reservation rules." : "Changes lot availability; does not create or reverse stock movements."}`
    });
  };

  const transitionReservation = async (
    reservationId: string,
    action: "release" | "cancel" | "consume"
  ) => {
    if (movementLock.current || !detail || !has(modulePermissions, permissions.reservation)) return;
    const reservation = detail.reservations.find(
      (item) =>
        item.id === reservationId && item.status === "ACTIVE" && item.sourceModule === "MANUAL"
    );
    if (!reservation) return;
    setError(undefined);
    movementLock.current = true;
    setMovement({
      path: `/inventory/reservations/${reservationId}/${action}`,
      body: { operationKey: operationKey(`inventory:reservation:${action}:${reservationId}`) },
      permission: permissions.reservation,
      replayable: false,
      state: "CONFIRM",
      summary: `${action} reservation ${reservationId} · Lot ${detail.lot.lotCode} · ${reservation.quantityMg} mg · Location ${reservation.locationId}. ${action === "consume" ? "Consumes reserved physical stock." : "Ends the reservation without consuming physical stock."}`
    });
  };

  if (!detail) return <NoxReadFeedback state={readState} subject="Material Lot" retry={load} />;
  const { lot, movements, reservations } = detail;
  const allowedOperations = [
    ...(has(modulePermissions, permissions.receive) ? ["receive"] : []),
    ...(has(modulePermissions, permissions.transfer) ? ["transfer"] : []),
    ...(has(modulePermissions, permissions.consume) ? ["consume"] : []),
    ...(has(modulePermissions, permissions.adjust) ? ["adjust-in", "adjust-out"] : []),
    ...(has(modulePermissions, permissions.dispose) ? ["dispose"] : []),
    ...(has(modulePermissions, permissions.reservation) ? ["reserve"] : [])
  ] as Array<typeof operation>;

  return (
    <section aria-labelledby="lot-title">
      <header className="nox-design-header">
        <div>
          <button type="button" className="nox-design-back" onClick={() => navigate("/inventory")}>
            ← Inventory
          </button>
          <p className="nox-ai-context">
            {lot.lifecycleStatus} · {lot.availabilityStatus}
          </p>
          <h1 id="lot-title">Lot {lot.lotCode}</h1>
          <p>
            <a href={`/materials/${lot.materialId}`}>{lot.materialDisplayName}</a>
          </p>
        </div>
        <div className="nox-design-reference-mass">
          <span>Available</span>
          <strong>{formatMassMg(total(lot, "availableMg"))}</strong>
          {has(modulePermissions, permissions.lotManage) && lot.lifecycleStatus === "OPEN" ? (
            <div className="nox-design-actions">
              <button
                type="button"
                disabled={Boolean(movement)}
                onClick={() =>
                  void changeLotState(lot.availabilityStatus === "HOLD" ? "release-hold" : "hold")
                }
              >
                {lot.availabilityStatus === "HOLD" ? "Release hold" : "Place on hold"}
              </button>
              <button
                type="button"
                disabled={Boolean(movement)}
                onClick={() => void changeLotState("close")}
              >
                Close lot
              </button>
            </div>
          ) : null}
        </div>
      </header>
      {error ? (
        <p role="alert" className="nox-design-warning">
          {error}
        </p>
      ) : null}
      <dl className="nox-design-intent-list">
        {movement ? (
          <NoxDialog
            title="Confirm inventory movement"
            onClose={() => {
              if (movement.state === "CONFIRM") {
                setMovement(undefined);
                movementLock.current = false;
              }
            }}
          >
            <p>{movement.summary}</p>
            <p>Server permissions, stock and lot state remain authoritative.</p>
            {movement.state === "PENDING" ? <p role="status">Recording movement…</p> : null}
            {movement.state === "UNKNOWN" ? (
              <p role="alert">
                {movement.replayable === false
                  ? "Outcome unknown. Read current lot and reservation state before deciding on another action; no automatic retry."
                  : "Outcome unknown. Inputs are locked; retry preserves the exact operation key and payload."}
              </p>
            ) : null}
            {movement.state === "CONFIRM" ? (
              <button
                type="button"
                onClick={() => {
                  setMovement(undefined);
                  movementLock.current = false;
                }}
              >
                Cancel movement
              </button>
            ) : null}
            {movement.state === "UNKNOWN" && movement.replayable === false ? (
              <button
                type="button"
                onClick={() =>
                  void load()
                    .then(() => {
                      setMovement(undefined);
                      movementLock.current = false;
                      setError(
                        "Current records reloaded. Review state; the previous action was not resubmitted."
                      );
                    })
                    .catch(() => {})
                }
              >
                Read current lot without resubmitting
              </button>
            ) : (
              <button
                type="button"
                disabled={movement.state === "PENDING"}
                onClick={() => void sendMovement()}
              >
                {movement.state === "UNKNOWN" ? "Retry same movement" : "Confirm movement"}
              </button>
            )}
          </NoxDialog>
        ) : null}
        <div>
          <dt>Supplier lot</dt>
          <dd>{lot.supplierLotCode ?? "—"}</dd>
        </div>
        <div>
          <dt>Expiry</dt>
          <dd>{lot.expiresAt ? new Date(lot.expiresAt).toLocaleString() : "—"}</dd>
        </div>
        <div>
          <dt>Retest</dt>
          <dd>{lot.retestAt ? new Date(lot.retestAt).toLocaleString() : "—"}</dd>
        </div>
      </dl>
      <h2>Balances by Location</h2>
      {lot.balances.length === 0 ? <p>No location balances recorded for this lot.</p> : null}
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Location</th>
              <th>On Hand</th>
              <th>Reserved</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            {lot.balances.map((item) => (
              <tr key={item.locationId}>
                <td>
                  {locations.find((value) => value.id === item.locationId)?.locationCode ??
                    item.locationId}
                </td>
                <td>{formatMassMg(item.onHandMg)}</td>
                <td>{formatMassMg(item.reservedMg)}</td>
                <td>{formatMassMg(item.availableMg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {allowedOperations.length > 0 && lot.lifecycleStatus === "OPEN" ? (
        <form
          className="nox-design-panel"
          onSubmit={submit}
          onChange={() => setMovementDraftDirty(true)}
          aria-label="Inventory movement"
        >
          <h2>Operational Movement / Reservation</h2>
          <fieldset disabled={Boolean(movement)} className="nox-trial-form-grid">
            <label>
              Operation
              <select
                value={operation}
                onChange={(event) => setOperation(event.target.value as typeof operation)}
              >
                {allowedOperations.map((item) => (
                  <option key={item} value={item}>
                    {item.replace("-", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quantity (mg)
              <input
                inputMode="numeric"
                pattern="[1-9][0-9]*"
                value={quantityMg}
                onChange={(event) => setQuantityMg(event.target.value)}
                required
              />
            </label>
            <label>
              Location
              <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                {locations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.locationCode}
                  </option>
                ))}
              </select>
            </label>
            {operation === "transfer" ? (
              <label>
                Destination
                <select
                  value={toLocationId}
                  onChange={(event) => setToLocationId(event.target.value)}
                >
                  {locations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.locationCode}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </fieldset>
          <button type="submit" disabled={Boolean(movement)}>
            Record {operation.replace("-", " ")}
          </button>
        </form>
      ) : null}
      <h2>Append-only Movement Ledger</h2>
      {movements.length === 0 ? <p>No stock movements recorded for this lot.</p> : null}
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Quantity</th>
              <th>From</th>
              <th>To</th>
              <th>Source</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((item) => (
              <tr key={item.id}>
                <td>{new Date(item.createdAt).toLocaleString()}</td>
                <td>{item.movementType}</td>
                <td>{formatMassMg(item.quantityMg)}</td>
                <td>{item.fromLocationId ?? "—"}</td>
                <td>{item.toLocationId ?? "—"}</td>
                <td>{item.sourceModule}</td>
                <td>{item.sourceReferenceId ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Reservations</h2>
      {reservations.length === 0 ? <p>No reservations recorded for this lot.</p> : null}
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Quantity</th>
              <th>Location</th>
              <th>Source</th>
              <th>Reference</th>
              <th>Movement</th>
              {has(modulePermissions, permissions.reservation) ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {reservations.map((item) => (
              <tr key={item.id}>
                <td>{item.status}</td>
                <td>{formatMassMg(item.quantityMg)}</td>
                <td>{item.locationId}</td>
                <td>{item.sourceModule}</td>
                <td>{item.sourceReferenceId ?? "—"}</td>
                <td>{item.consumedMovementId ?? "—"}</td>
                {has(modulePermissions, permissions.reservation) ? (
                  <td>
                    {item.status === "ACTIVE" && item.sourceModule === "MANUAL" ? (
                      <div className="nox-design-actions">
                        {(["release", "cancel", "consume"] as const).map((action) => (
                          <button
                            key={action}
                            type="button"
                            disabled={Boolean(movement)}
                            onClick={() => void transitionReservation(item.id, action)}
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function InventoryExperience({
  api,
  tenantId,
  modulePermissions
}: {
  api: ApiClient;
  tenantId?: string;
  modulePermissions: readonly string[];
}) {
  const { pathname } = useLocation();
  if (!tenantId || !has(modulePermissions, permissions.read))
    return (
      <section>
        <h1>Inventory</h1>
        <p role="alert">Inventory access requires an active tenant and permission.</p>
      </section>
    );
  return (
    <Routes>
      <Route
        index
        element={
          <InventoryRegistry
            key={tenantId}
            api={api}
            tenantId={tenantId}
            modulePermissions={modulePermissions}
          />
        }
      />
      <Route
        path="lots/:lotId"
        element={
          <LotDetail
            key={`${tenantId}:${pathname}`}
            api={api}
            tenantId={tenantId}
            modulePermissions={modulePermissions}
          />
        }
      />
    </Routes>
  );
}
