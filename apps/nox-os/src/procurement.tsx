import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { InventoryLocation } from "@nox-os/inventory/browser";
import type {
  GoodsReceipt,
  PurchaseOrder,
  Supplier,
  SupplierMaterialOffer
} from "@nox-os/procurement/browser";
import { formatMassMg } from "@nox-os/trial-sensory/browser";
import type { ApiClient } from "./platform-control";

const permissions = {
  read: "module.procurement.read",
  supplier: "module.procurement.supplier.manage",
  offer: "module.procurement.offer.manage",
  poCreate: "module.procurement.purchase-order.create",
  poApprove: "module.procurement.purchase-order.approve",
  poClose: "module.procurement.purchase-order.close",
  poCancel: "module.procurement.purchase-order.cancel",
  receiptCreate: "module.procurement.receipt.create",
  receiptPost: "module.procurement.receipt.post",
  receiptCancel: "module.procurement.receipt.cancel"
} as const;

type Tab = "purchase-orders" | "goods-receipts" | "suppliers" | "supplier-offers";

function has(values: readonly string[], permission: string): boolean {
  return values.includes(permission);
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Procurement operation failed.";
}

function totalMass(
  order: PurchaseOrder,
  field: "orderedQuantityMg" | "receivedQuantityMg" | "remainingQuantityMg"
) {
  return order.lines.reduce((sum, line) => sum + BigInt(line[field]), 0n).toString();
}

function PurchaseOrdersTab({
  api,
  tenantId,
  modulePermissions,
  suppliers,
  purchaseOrders,
  reload,
  setError
}: {
  api: ApiClient;
  tenantId: string;
  modulePermissions: readonly string[];
  suppliers: readonly Supplier[];
  purchaseOrders: readonly PurchaseOrder[];
  reload: () => Promise<void>;
  setError: (value?: string) => void;
}) {
  const [poNumber, setPoNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [materialId, setMaterialId] = useState("");
  const [materialName, setMaterialName] = useState("");
  const [quantityMg, setQuantityMg] = useState("");
  const [unitPricePerKg, setUnitPricePerKg] = useState("0");

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      await api("/procurement/purchase-orders", {
        method: "POST",
        tenantId,
        body: {
          poNumber,
          supplierId,
          orderType: unitPricePerKg === "0" ? "SAMPLE" : "STANDARD",
          currencyCode,
          supplierQuoteReference: null,
          expectedDeliveryAt: null,
          incoterm: null,
          freightAmount: null,
          notes: null,
          lines: [
            {
              materialId,
              supplierOfferId: null,
              supplierSkuSnapshot: null,
              supplierMaterialNameSnapshot: materialName,
              orderedQuantityMg: quantityMg,
              unitPricePerKg,
              expectedDeliveryAt: null,
              notes: null
            }
          ]
        }
      });
      setPoNumber("");
      setMaterialId("");
      setMaterialName("");
      setQuantityMg("");
      await reload();
    } catch (reason) {
      setError(message(reason));
    }
  };

  const transition = async (id: string, action: "approve" | "cancel" | "close") => {
    setError(undefined);
    try {
      await api(`/procurement/purchase-orders/${id}/${action}`, { method: "POST", tenantId });
      await reload();
    } catch (reason) {
      setError(message(reason));
    }
  };

  return (
    <section aria-labelledby="procurement-po-title">
      <h2 id="procurement-po-title">Purchase Orders</h2>
      <div className="nox-table-wrap">
        <table>
          <thead>
            <tr>
              <th>PO</th>
              <th>Supplier</th>
              <th>Status</th>
              <th>Ordered</th>
              <th>Received</th>
              <th>Remaining</th>
              <th>Currency</th>
              <th>Expected Delivery</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.map((order) => (
              <tr key={order.id} data-testid={`purchase-order-${order.poNumber}`}>
                <td>{order.poNumber}</td>
                <td>{order.supplierDisplayName}</td>
                <td>{order.status}</td>
                <td>{formatMassMg(totalMass(order, "orderedQuantityMg"))}</td>
                <td>{formatMassMg(totalMass(order, "receivedQuantityMg"))}</td>
                <td>{formatMassMg(totalMass(order, "remainingQuantityMg"))}</td>
                <td>{order.currencyCode}</td>
                <td>
                  {order.expectedDeliveryAt
                    ? new Date(order.expectedDeliveryAt).toLocaleDateString()
                    : "—"}
                </td>
                <td>{new Date(order.updatedAt).toLocaleString()}</td>
                <td>
                  {order.status === "DRAFT" && has(modulePermissions, permissions.poApprove) ? (
                    <button type="button" onClick={() => void transition(order.id, "approve")}>
                      Approve
                    </button>
                  ) : null}
                  {["DRAFT", "APPROVED"].includes(order.status) &&
                  has(modulePermissions, permissions.poCancel) ? (
                    <button type="button" onClick={() => void transition(order.id, "cancel")}>
                      Cancel
                    </button>
                  ) : null}
                  {["PARTIALLY_RECEIVED", "RECEIVED"].includes(order.status) &&
                  has(modulePermissions, permissions.poClose) ? (
                    <button type="button" onClick={() => void transition(order.id, "close")}>
                      Close
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {purchaseOrders.length === 0 ? (
        <p className="nox-design-empty">No Purchase Orders recorded.</p>
      ) : null}

      {has(modulePermissions, permissions.poCreate) ? (
        <form className="nox-design-form" onSubmit={create} aria-label="Create Purchase Order">
          <h3>Create Purchase Order</h3>
          <label>
            PO Number
            <input
              required
              value={poNumber}
              onChange={(event) => setPoNumber(event.target.value)}
            />
          </label>
          <label>
            Supplier
            <select
              required
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
            >
              <option value="">Select Supplier</option>
              {suppliers
                .filter((item) => item.status !== "ARCHIVED")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} · {item.status}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Currency
            <input
              required
              pattern="[A-Z]{3}"
              value={currencyCode}
              onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            Material ID
            <input
              required
              value={materialId}
              onChange={(event) => setMaterialId(event.target.value)}
            />
          </label>
          <label>
            Supplier Material Name
            <input
              required
              value={materialName}
              onChange={(event) => setMaterialName(event.target.value)}
            />
          </label>
          <label>
            Ordered Quantity (mg)
            <input
              required
              inputMode="numeric"
              value={quantityMg}
              onChange={(event) => setQuantityMg(event.target.value)}
            />
          </label>
          <label>
            Unit Price / kg
            <input
              required
              inputMode="decimal"
              value={unitPricePerKg}
              onChange={(event) => setUnitPricePerKg(event.target.value)}
            />
          </label>
          <button type="submit">Create Draft</button>
        </form>
      ) : null}
    </section>
  );
}

function GoodsReceiptsTab({
  api,
  tenantId,
  modulePermissions,
  purchaseOrders,
  goodsReceipts,
  locations,
  reload,
  setError
}: {
  api: ApiClient;
  tenantId: string;
  modulePermissions: readonly string[];
  purchaseOrders: readonly PurchaseOrder[];
  goodsReceipts: readonly GoodsReceipt[];
  locations: readonly InventoryLocation[];
  reload: () => Promise<void>;
  setError: (value?: string) => void;
}) {
  const [receiptNumber, setReceiptNumber] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [purchaseOrderLineId, setPurchaseOrderLineId] = useState("");
  const [quantityMg, setQuantityMg] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [supplierLotCode, setSupplierLotCode] = useState("");
  const [locationId, setLocationId] = useState("");
  const order = purchaseOrders.find((item) => item.id === purchaseOrderId);
  const line = order?.lines.find((item) => item.id === purchaseOrderLineId);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!line) return;
    setError(undefined);
    try {
      await api("/procurement/goods-receipts", {
        method: "POST",
        tenantId,
        body: {
          receiptNumber,
          purchaseOrderId,
          supplierDeliveryReference: null,
          receivedAt: new Date().toISOString(),
          lines: [
            {
              purchaseOrderLineId: line.id,
              materialId: line.materialId,
              receivedQuantityMg: quantityMg,
              lotCode,
              supplierLotCode: supplierLotCode || null,
              manufacturedAt: null,
              expiresAt: null,
              retestAt: null,
              destinationLocationId: locationId
            }
          ]
        }
      });
      setReceiptNumber("");
      setQuantityMg("");
      setLotCode("");
      setSupplierLotCode("");
      await reload();
    } catch (reason) {
      setError(message(reason));
    }
  };

  const transition = async (id: string, action: "post" | "cancel") => {
    setError(undefined);
    try {
      await api(`/procurement/goods-receipts/${id}/${action}`, { method: "POST", tenantId });
      await reload();
    } catch (reason) {
      setError(message(reason));
    }
  };

  return (
    <section aria-labelledby="procurement-receipt-title">
      <h2 id="procurement-receipt-title">Goods Receipts</h2>
      <div className="nox-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Receipt</th>
              <th>PO</th>
              <th>Supplier</th>
              <th>Status</th>
              <th>Received</th>
              <th>Trace</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {goodsReceipts.map((receipt) => (
              <tr key={receipt.id} data-testid={`goods-receipt-${receipt.receiptNumber}`}>
                <td>{receipt.receiptNumber}</td>
                <td>{receipt.purchaseOrderNumber}</td>
                <td>{receipt.supplierDisplayName}</td>
                <td>{receipt.status}</td>
                <td>
                  {receipt.lines.map((item) => formatMassMg(item.receivedQuantityMg)).join(" + ")}
                </td>
                <td>
                  {receipt.status === "POSTED"
                    ? receipt.lines.map((item) => (
                        <span key={item.id}>
                          <a href={`/inventory/lots/${item.inventoryLotId}`}>Lot</a> · Movement{" "}
                          {item.inventoryMovementId?.slice(0, 8)}{" "}
                        </span>
                      ))
                    : "No stock change"}
                </td>
                <td>
                  {receipt.status === "DRAFT" && has(modulePermissions, permissions.receiptPost) ? (
                    <button type="button" onClick={() => void transition(receipt.id, "post")}>
                      Post
                    </button>
                  ) : null}
                  {receipt.status === "DRAFT" &&
                  has(modulePermissions, permissions.receiptCancel) ? (
                    <button type="button" onClick={() => void transition(receipt.id, "cancel")}>
                      Cancel
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {goodsReceipts.length === 0 ? (
        <p className="nox-design-empty">No Goods Receipts recorded.</p>
      ) : null}
      {has(modulePermissions, permissions.receiptCreate) ? (
        <form className="nox-design-form" onSubmit={create} aria-label="Create Goods Receipt">
          <h3>Create Goods Receipt</h3>
          <label>
            Receipt Number
            <input
              required
              value={receiptNumber}
              onChange={(event) => setReceiptNumber(event.target.value)}
            />
          </label>
          <label>
            Purchase Order
            <select
              required
              value={purchaseOrderId}
              onChange={(event) => {
                setPurchaseOrderId(event.target.value);
                setPurchaseOrderLineId("");
              }}
            >
              <option value="">Select approved PO</option>
              {purchaseOrders
                .filter((item) => ["APPROVED", "PARTIALLY_RECEIVED"].includes(item.status))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.poNumber} · {item.supplierDisplayName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            PO Line
            <select
              required
              value={purchaseOrderLineId}
              onChange={(event) => setPurchaseOrderLineId(event.target.value)}
            >
              <option value="">Select line</option>
              {order?.lines.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.materialDisplayName} · remaining {formatMassMg(item.remainingQuantityMg)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Received Quantity (mg)
            <input
              required
              inputMode="numeric"
              value={quantityMg}
              onChange={(event) => setQuantityMg(event.target.value)}
            />
          </label>
          <label>
            Internal Lot Code
            <input required value={lotCode} onChange={(event) => setLotCode(event.target.value)} />
          </label>
          <label>
            Supplier Lot Code
            <input
              value={supplierLotCode}
              onChange={(event) => setSupplierLotCode(event.target.value)}
            />
          </label>
          <label>
            Destination Location
            <select
              required
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">Select active location</option>
              {locations
                .filter((item) => item.status === "ACTIVE")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.locationCode} · {item.name}
                  </option>
                ))}
            </select>
          </label>
          <button type="submit">Save Draft</button>
        </form>
      ) : null}
    </section>
  );
}

function SuppliersTab({
  api,
  tenantId,
  modulePermissions,
  suppliers,
  reload,
  setError
}: {
  api: ApiClient;
  tenantId: string;
  modulePermissions: readonly string[];
  suppliers: readonly Supplier[];
  reload: () => Promise<void>;
  setError: (value?: string) => void;
}) {
  const [supplierCode, setSupplierCode] = useState("");
  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      await api("/procurement/suppliers", {
        method: "POST",
        tenantId,
        body: {
          supplierCode,
          legalName,
          displayName,
          countryCode: null,
          primaryEmail: null,
          primaryPhone: null,
          website: null,
          taxIdentifier: null,
          defaultCurrency: null,
          defaultIncoterm: null,
          notes: null
        }
      });
      setSupplierCode("");
      setLegalName("");
      setDisplayName("");
      await reload();
    } catch (reason) {
      setError(message(reason));
    }
  };
  const setStatus = async (supplier: Supplier, status: Supplier["status"]) => {
    setError(undefined);
    try {
      await api(`/procurement/suppliers/${supplier.id}`, {
        method: "PUT",
        tenantId,
        body: { status }
      });
      await reload();
    } catch (reason) {
      setError(message(reason));
    }
  };
  return (
    <section aria-labelledby="procurement-supplier-title">
      <h2 id="procurement-supplier-title">Suppliers</h2>
      <div className="nox-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Supplier</th>
              <th>Legal Name</th>
              <th>Status</th>
              <th>Currency</th>
              <th>Contact</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((item) => (
              <tr key={item.id}>
                <td>{item.supplierCode}</td>
                <td>{item.displayName}</td>
                <td>{item.legalName}</td>
                <td>{item.status}</td>
                <td>{item.defaultCurrency ?? "—"}</td>
                <td>{item.primaryEmail ?? "—"}</td>
                <td>
                  {has(modulePermissions, permissions.supplier) && item.status === "ACTIVE" ? (
                    <button type="button" onClick={() => void setStatus(item, "HOLD")}>
                      Hold
                    </button>
                  ) : null}
                  {has(modulePermissions, permissions.supplier) && item.status === "HOLD" ? (
                    <button type="button" onClick={() => void setStatus(item, "ACTIVE")}>
                      Activate
                    </button>
                  ) : null}
                  {has(modulePermissions, permissions.supplier) && item.status !== "ARCHIVED" ? (
                    <button type="button" onClick={() => void setStatus(item, "ARCHIVED")}>
                      Archive
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {suppliers.length === 0 ? <p className="nox-design-empty">No Suppliers recorded.</p> : null}
      {has(modulePermissions, permissions.supplier) ? (
        <form className="nox-design-form" onSubmit={create} aria-label="Create Supplier">
          <h3>Create Supplier</h3>
          <label>
            Supplier Code
            <input
              required
              value={supplierCode}
              onChange={(event) => setSupplierCode(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            Legal Name
            <input
              required
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
            />
          </label>
          <label>
            Display Name
            <input
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <button type="submit">Create Supplier</button>
        </form>
      ) : null}
    </section>
  );
}

function OffersTab({
  api,
  tenantId,
  modulePermissions,
  suppliers,
  offers,
  reload,
  setError
}: {
  api: ApiClient;
  tenantId: string;
  modulePermissions: readonly string[];
  suppliers: readonly Supplier[];
  offers: readonly SupplierMaterialOffer[];
  reload: () => Promise<void>;
  setError: (value?: string) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("0");
  const [currency, setCurrency] = useState("USD");
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      await api("/procurement/supplier-offers", {
        method: "POST",
        tenantId,
        body: {
          supplierId,
          materialId,
          supplierSku: sku || null,
          supplierMaterialName: name,
          packSizeMg: null,
          minimumOrderQuantityMg: null,
          unitPricePerKg: price,
          currencyCode: currency,
          leadTimeDays: null,
          lastQuotedAt: new Date().toISOString(),
          sourceReference: null
        }
      });
      setMaterialId("");
      setName("");
      setSku("");
      await reload();
    } catch (reason) {
      setError(message(reason));
    }
  };
  return (
    <section aria-labelledby="procurement-offer-title">
      <h2 id="procurement-offer-title">Supplier Offers</h2>
      <div className="nox-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Supplier Material</th>
              <th>SKU</th>
              <th>NØX Material</th>
              <th>Approval</th>
              <th>Price / kg</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((item) => (
              <tr key={item.id}>
                <td>
                  {suppliers.find((supplier) => supplier.id === item.supplierId)?.displayName ??
                    item.supplierId}
                </td>
                <td>{item.supplierMaterialName}</td>
                <td>{item.supplierSku ?? "—"}</td>
                <td>{item.materialDisplayName}</td>
                <td>{item.materialApprovalStatus}</td>
                <td>
                  {item.unitPricePerKg ?? "—"} {item.currencyCode ?? ""}
                </td>
                <td>{item.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {offers.length === 0 ? (
        <p className="nox-design-empty">No Supplier Offers recorded.</p>
      ) : null}
      {has(modulePermissions, permissions.offer) ? (
        <form className="nox-design-form" onSubmit={create} aria-label="Create Supplier Offer">
          <h3>Create Supplier Offer</h3>
          <label>
            Supplier
            <select
              required
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
            >
              <option value="">Select Supplier</option>
              {suppliers
                .filter((item) => item.status !== "ARCHIVED")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Material ID
            <input
              required
              value={materialId}
              onChange={(event) => setMaterialId(event.target.value)}
            />
          </label>
          <label>
            Supplier Material Name
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Supplier SKU
            <input value={sku} onChange={(event) => setSku(event.target.value)} />
          </label>
          <label>
            Unit Price / kg
            <input
              required
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
          <label>
            Currency
            <input
              required
              pattern="[A-Z]{3}"
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </label>
          <button type="submit">Create Offer</button>
        </form>
      ) : null}
    </section>
  );
}

export function ProcurementExperience({
  api,
  tenantId,
  modulePermissions
}: {
  api: ApiClient;
  tenantId?: string;
  modulePermissions: readonly string[];
}) {
  const [tab, setTab] = useState<Tab>("purchase-orders");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [offers, setOffers] = useState<SupplierMaterialOffer[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [goodsReceipts, setGoodsReceipts] = useState<GoodsReceipt[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!tenantId) return;
    const [supplierPayload, offerPayload, poPayload, receiptPayload, locationPayload] =
      await Promise.all([
        api<{ suppliers: Supplier[] }>("/procurement/suppliers", { tenantId }),
        api<{ offers: SupplierMaterialOffer[] }>("/procurement/supplier-offers", { tenantId }),
        api<{ purchaseOrders: PurchaseOrder[] }>("/procurement/purchase-orders", { tenantId }),
        api<{ goodsReceipts: GoodsReceipt[] }>("/procurement/goods-receipts", { tenantId }),
        api<{ locations: InventoryLocation[] }>("/inventory/locations", { tenantId })
      ]);
    setSuppliers(supplierPayload.suppliers);
    setOffers(offerPayload.offers);
    setPurchaseOrders(poPayload.purchaseOrders);
    setGoodsReceipts(receiptPayload.goodsReceipts);
    setLocations(locationPayload.locations);
  }, [api, tenantId]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    load()
      .catch((reason) => current && setError(message(reason)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [load]);
  const tabs = useMemo(
    () =>
      [
        { id: "purchase-orders", label: "Purchase Orders" },
        { id: "goods-receipts", label: "Goods Receipts" },
        { id: "suppliers", label: "Suppliers" },
        { id: "supplier-offers", label: "Supplier Offers" }
      ] as const,
    []
  );
  if (!tenantId || !has(modulePermissions, permissions.read))
    return (
      <section>
        <h1>Procurement</h1>
        <p role="alert">Procurement access requires an active tenant and permission.</p>
      </section>
    );
  return (
    <section aria-labelledby="procurement-title">
      <header className="nox-section-heading">
        <div>
          <p className="nox-ai-context">PROCUREMENT & SUPPLIER OPERATIONS</p>
          <h1 id="procurement-title">Procurement</h1>
          <p>Commercial commitments linked atomically to physical Inventory receipts.</p>
        </div>
      </header>
      <div role="tablist" aria-label="Procurement views" className="nox-workspace-tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="nox-design-warning">
          {error}
        </p>
      ) : null}
      {loading ? <p className="nox-ai-context">Loading procurement registry…</p> : null}
      {!loading && tab === "purchase-orders" ? (
        <PurchaseOrdersTab
          api={api}
          tenantId={tenantId}
          modulePermissions={modulePermissions}
          suppliers={suppliers}
          purchaseOrders={purchaseOrders}
          reload={load}
          setError={setError}
        />
      ) : null}
      {!loading && tab === "goods-receipts" ? (
        <GoodsReceiptsTab
          api={api}
          tenantId={tenantId}
          modulePermissions={modulePermissions}
          purchaseOrders={purchaseOrders}
          goodsReceipts={goodsReceipts}
          locations={locations}
          reload={load}
          setError={setError}
        />
      ) : null}
      {!loading && tab === "suppliers" ? (
        <SuppliersTab
          api={api}
          tenantId={tenantId}
          modulePermissions={modulePermissions}
          suppliers={suppliers}
          reload={load}
          setError={setError}
        />
      ) : null}
      {!loading && tab === "supplier-offers" ? (
        <OffersTab
          api={api}
          tenantId={tenantId}
          modulePermissions={modulePermissions}
          suppliers={suppliers}
          offers={offers}
          reload={load}
          setError={setError}
        />
      ) : null}
    </section>
  );
}
