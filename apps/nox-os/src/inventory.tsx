import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Route, Routes, useNavigate, useParams } from "react-router-dom";
import type {
  InventoryLocation,
  MaterialLot,
  StockMovement,
  StockReservation
} from "@nox-os/inventory/browser";
import { formatMassMg } from "@nox-os/trial-sensory/browser";
import type { ApiClient } from "./platform-control";

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

function has(values: readonly string[], permission: string): boolean {
  return values.includes(permission);
}

function total(lot: MaterialLot, field: "onHandMg" | "reservedMg" | "availableMg"): string {
  return lot.balances.reduce((sum, item) => sum + BigInt(item[field]), 0n).toString();
}

function issue(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Inventory operation failed.";
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

  const load = async () => {
    const [lotPayload, locationPayload] = await Promise.all([
      api<{ lots: MaterialLot[] }>("/inventory/lots", { tenantId }),
      api<{ locations: InventoryLocation[] }>("/inventory/locations", { tenantId })
    ]);
    setLots(lotPayload.lots);
    setLocations(locationPayload.locations);
  };

  useEffect(() => {
    let current = true;
    Promise.all([
      api<{ lots: MaterialLot[] }>("/inventory/lots", { tenantId }),
      api<{ locations: InventoryLocation[] }>("/inventory/locations", { tenantId })
    ])
      .then(([lotPayload, locationPayload]) => {
        if (!current) return;
        setLots(lotPayload.lots);
        setLocations(locationPayload.locations);
      })
      .catch((reason) => current && setError(issue(reason)));
    return () => {
      current = false;
    };
  }, [api, tenantId]);

  const createLocation = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      await api("/inventory/locations", {
        method: "POST",
        tenantId,
        body: { locationCode, name: locationName, description: null }
      });
      setLocationCode("");
      setLocationName("");
      await load();
    } catch (reason) {
      setError(issue(reason));
    }
  };

  const createLot = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
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
      navigate(`/inventory/lots/${response.lot.id}`);
    } catch (reason) {
      setError(issue(reason));
    }
  };

  const archiveLocation = async (locationId: string) => {
    setError(undefined);
    try {
      await api(`/inventory/locations/${locationId}/archive`, { method: "POST", tenantId });
      await load();
    } catch (reason) {
      setError(issue(reason));
    }
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
      <div className="nox-table-wrap">
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
      {materialSummary.length === 0 ? (
        <p className="nox-design-empty">No physical stock has been registered.</p>
      ) : null}

      <h2>Lots</h2>
      <div className="nox-table-wrap">
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

      <div className="nox-trial-form-grid">
        {has(modulePermissions, permissions.location) ? (
          <form className="nox-design-panel" onSubmit={createLocation}>
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
          <form className="nox-design-panel" onSubmit={createLot}>
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
      </div>

      <h2>Locations</h2>
      <div className="nox-table-wrap">
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
                      disabled={item.status === "ARCHIVED"}
                      onClick={() => void archiveLocation(item.id)}
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
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [locationId, setLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [quantityMg, setQuantityMg] = useState("1000");
  const [operation, setOperation] = useState<
    "receive" | "transfer" | "consume" | "adjust-in" | "adjust-out" | "dispose" | "reserve"
  >("receive");
  const [error, setError] = useState<string>();

  const load = async () => {
    const [value, locationPayload] = await Promise.all([
      api<DetailPayload>(`/inventory/lots/${lotId}`, { tenantId }),
      api<{ locations: InventoryLocation[] }>("/inventory/locations", { tenantId })
    ]);
    setDetail(value);
    const active = locationPayload.locations.filter((item) => item.status === "ACTIVE");
    setLocations(active);
    setLocationId((current) => current || active[0]?.id || "");
    setToLocationId((current) => current || active[1]?.id || active[0]?.id || "");
  };

  useEffect(() => {
    void load().catch((reason) => setError(issue(reason)));
  }, [api, tenantId, lotId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
    try {
      const target = routes[operation];
      await api(`/inventory/lots/${lotId}/${target.path}`, {
        method: "POST",
        tenantId,
        body: target.body
      });
      await load();
    } catch (reason) {
      setError(issue(reason));
    }
  };

  const changeLotState = async (action: "hold" | "release-hold" | "close") => {
    setError(undefined);
    try {
      await api(`/inventory/lots/${lotId}/${action}`, { method: "POST", tenantId });
      await load();
    } catch (reason) {
      setError(issue(reason));
    }
  };

  const transitionReservation = async (
    reservationId: string,
    action: "release" | "cancel" | "consume"
  ) => {
    setError(undefined);
    try {
      await api(`/inventory/reservations/${reservationId}/${action}`, {
        method: "POST",
        tenantId,
        body: { operationKey: operationKey(`inventory:reservation:${action}:${reservationId}`) }
      });
      await load();
    } catch (reason) {
      setError(issue(reason));
    }
  };

  if (!detail) return <p aria-busy="true">Loading Material Lot…</p>;
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
                onClick={() =>
                  void changeLotState(lot.availabilityStatus === "HOLD" ? "release-hold" : "hold")
                }
              >
                {lot.availabilityStatus === "HOLD" ? "Release hold" : "Place on hold"}
              </button>
              <button type="button" onClick={() => void changeLotState("close")}>
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
      <div className="nox-table-wrap">
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
        <form className="nox-design-panel" onSubmit={submit}>
          <h2>Operational Movement / Reservation</h2>
          <div className="nox-trial-form-grid">
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
          </div>
          <button type="submit">Record {operation.replace("-", " ")}</button>
        </form>
      ) : null}
      <h2>Append-only Movement Ledger</h2>
      <div className="nox-table-wrap">
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
      <div className="nox-table-wrap">
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
          <InventoryRegistry api={api} tenantId={tenantId} modulePermissions={modulePermissions} />
        }
      />
      <Route
        path="lots/:lotId"
        element={<LotDetail api={api} tenantId={tenantId} modulePermissions={modulePermissions} />}
      />
    </Routes>
  );
}
