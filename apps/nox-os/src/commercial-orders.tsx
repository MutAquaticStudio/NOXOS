import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import type { ApiClient } from "./platform-control";

type Props = { api: ApiClient; tenantId?: string; modulePermissions: string[] };
type ScopedApi = <T>(path: string, options?: Parameters<ApiClient>[1]) => Promise<T>;
const permission = (all: string[], key: string) => all.includes(key);

type DraftLine = {
  lineKind: "MATERIAL" | "SERVICE_SCOPE" | "MANUFACTURED_PRODUCT";
  titleSnapshot: string;
  quantityValue: string;
  unitPriceMinor: string;
  priceBasisQuantity: string;
  discountMinor: string;
  materialId: string;
  serviceOrderLineId: string;
  formulaVersionId: string;
  notes: string;
};

const newDraftLine = (): DraftLine => ({
  lineKind: "MATERIAL",
  titleSnapshot: "",
  quantityValue: "",
  unitPriceMinor: "0",
  priceBasisQuantity: "1",
  discountMinor: "0",
  materialId: "",
  serviceOrderLineId: "",
  formulaVersionId: "",
  notes: ""
});

export function CommercialOrdersExperience({ api, tenantId, modulePermissions }: Props) {
  const scopedApi = useCallback<ScopedApi>(
    (path, options = {}) => {
      if (!tenantId) return Promise.reject(new Error("An active tenant is required."));
      return api(path, { ...options, tenantId });
    },
    [api, tenantId]
  );
  return (
    <Routes>
      <Route
        index
        element={
          <OrderRegistry
            api={scopedApi}
            canCreate={permission(modulePermissions, "module.commercial-orders.order.create")}
          />
        }
      />
      <Route path="new" element={<OrderComposer api={scopedApi} />} />
      <Route
        path="quotes"
        element={
          <QuoteRegistry
            api={scopedApi}
            canCreate={permission(modulePermissions, "module.commercial-orders.quote.create")}
          />
        }
      />
      <Route path="quotes/new" element={<QuoteComposer api={scopedApi} />} />
      <Route
        path="quotes/:quoteId"
        element={<QuoteDetail api={scopedApi} permissions={modulePermissions} />}
      />
      <Route
        path=":orderId"
        element={<OrderDetail api={scopedApi} permissions={modulePermissions} />}
      />
    </Routes>
  );
}

function Problem({ error }: { error?: string }) {
  return error ? <p role="alert">{error}</p> : null;
}
function OrderRegistry({ api, canCreate }: { api: ScopedApi; canCreate: boolean }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [fulfillment, setFulfillment] = useState("");
  const [shipping, setShipping] = useState("");
  const [customer, setCustomer] = useState("");
  const [error, setError] = useState<string>();
  const refresh = useCallback(
    () =>
      void api<any>("/commercial-orders")
        .then((x) => {
          setOrders(x.orders ?? []);
          setError(undefined);
        })
        .catch(() => setError("Commercial Orders could not be loaded.")),
    [api]
  );
  useEffect(refresh, [refresh]);
  const filtered = useMemo(
    () =>
      orders.filter(
        (order) =>
          (!status || order.status === status) &&
          (!fulfillment || order.fulfillmentStatus === fulfillment) &&
          (!shipping || order.shippingStatus === shipping) &&
          (!customer ||
            String(order.customer_display_name_snapshot ?? order.customer_id)
              .toLocaleLowerCase()
              .includes(customer.toLocaleLowerCase()))
      ),
    [customer, fulfillment, orders, shipping, status]
  );
  return (
    <section>
      <p className="nox-ai-context">COMMERCIAL OPERATIONS</p>
      <header>
        <h1>Commercial Orders</h1>
        <p>
          Commercial status, allocation, fulfillment and shipment are distinct operational truths.
        </p>
        <p>
          <Link to="quotes">Quotes</Link>
          {canCreate ? (
            <>
              {" "}
              · <Link to="new">New Commercial Order</Link>
            </>
          ) : null}
        </p>
      </header>
      <Problem error={error} />
      <fieldset>
        <legend>Filter Commercial Orders</legend>
        <label>
          Commercial status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option>
            {["DRAFT", "CONFIRMED", "CANCELLED", "CLOSED"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          Fulfillment
          <select value={fulfillment} onChange={(event) => setFulfillment(event.target.value)}>
            <option value="">All</option>
            {["NOT_STARTED", "PARTIAL", "FULFILLED"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          Shipment
          <select value={shipping} onChange={(event) => setShipping(event.target.value)}>
            <option value="">All</option>
            {["NOT_REQUIRED", "NOT_STARTED", "PARTIAL", "SHIPPED", "DELIVERED"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          Customer
          <input value={customer} onChange={(event) => setCustomer(event.target.value)} />
        </label>
      </fieldset>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Source Project</th>
            <th>Commercial amount</th>
            <th>Currency</th>
            <th>Commercial status</th>
            <th>Allocation</th>
            <th>Fulfillment</th>
            <th>Shipment</th>
            <th>Confirmed</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((order) => (
            <tr key={order.id}>
              <td>
                <Link to={`/commercial-orders/${order.id}`}>{order.order_number}</Link>
              </td>
              <td>{order.customer_display_name_snapshot ?? order.customer_id}</td>
              <td>{order.source_project_id ?? "—"}</td>
              <td>{order.commercialAmountMinor}</td>
              <td>{order.currency_code}</td>
              <td>{order.status}</td>
              <td>{order.allocationStatus}</td>
              <td>{order.fulfillmentStatus}</td>
              <td>{order.shippingStatus}</td>
              <td>{order.confirmed_at ? new Date(order.confirmed_at).toLocaleString() : "—"}</td>
              <td>{new Date(order.updated_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 ? <p>No Commercial Orders match these filters.</p> : null}
    </section>
  );
}
function QuoteRegistry({ api, canCreate }: { api: ScopedApi; canCreate: boolean }) {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [customer, setCustomer] = useState("");
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<any>("/commercial-orders/quotes")
      .then((x) => setQuotes(x.quotes ?? []))
      .catch(() => setError("Quotes could not be loaded."));
  }, [api]);
  const filtered = useMemo(
    () =>
      quotes.filter(
        (quote) =>
          (!status || quote.status === status) &&
          (!customer ||
            String(quote.customer_display_name_snapshot ?? quote.customer_id)
              .toLocaleLowerCase()
              .includes(customer.toLocaleLowerCase()))
      ),
    [customer, quotes, status]
  );
  return (
    <section>
      <p className="nox-ai-context">COMMERCIAL OFFER</p>
      <h1>Quotes</h1>
      <p>
        <Link to="/commercial-orders">Orders</Link>
        {canCreate ? (
          <>
            {" "}
            · <Link to="new">New Quote</Link>
          </>
        ) : null}
      </p>
      <Problem error={error} />
      <fieldset>
        <legend>Filter Quotes</legend>
        <label>
          Effective status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option>
            {["DRAFT", "ISSUED", "ACCEPTED", "DECLINED", "CANCELLED"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          Customer
          <input value={customer} onChange={(event) => setCustomer(event.target.value)} />
        </label>
      </fieldset>
      <table>
        <thead>
          <tr>
            <th>Quote</th>
            <th>Revision</th>
            <th>Customer</th>
            <th>Source</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Currency</th>
            <th>Valid until</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((q) => (
            <tr key={q.id}>
              <td>
                <Link to={`/commercial-orders/quotes/${q.id}`}>{q.quote_number}</Link>
              </td>
              <td>{q.revision_number}</td>
              <td>{q.customer_display_name_snapshot ?? q.customer_id}</td>
              <td>{q.source_project_id ?? q.source_service_order_id ?? "—"}</td>
              <td>{q.commercialAmountMinor}</td>
              <td>
                {q.status}
                {q.status === "ISSUED" && q.valid_until && new Date(q.valid_until) < new Date()
                  ? " · Expired"
                  : ""}
              </td>
              <td>{q.currency_code}</td>
              <td>{q.valid_until ? new Date(q.valid_until).toLocaleString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 ? <p>No Quotes match these filters.</p> : null}
    </section>
  );
}
function Composer({ kind, api }: { kind: "quote" | "order"; api: ScopedApi }) {
  const nav = useNavigate();
  const [customerId, setCustomerId] = useState("");
  const [sourceServiceOrderId, setSourceServiceOrderId] = useState("");
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [number, setNumber] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [commercialTerms, setCommercialTerms] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [shippingTerms, setShippingTerms] = useState("");
  const [shipToCountry, setShipToCountry] = useState("");
  const [shipToLocality, setShipToLocality] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [draftLine, setDraftLine] = useState<DraftLine>(newDraftLine);
  const [customers, setCustomers] = useState<any[]>([]);
  const [serviceOrders, setServiceOrders] = useState<any[]>([]);
  const [serviceLines, setServiceLines] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api<any>("/lab-services/customers"),
      api<any>("/lab-services/service-orders"),
      api<any>("/materials"),
      api<any>("/project-operations/projects")
    ])
      .then(([customerData, serviceData, materialData, projectData]) => {
        if (!active) return;
        setCustomers(customerData.customers ?? []);
        setServiceOrders(serviceData.serviceOrders ?? []);
        setMaterials(materialData.materials ?? []);
        setProjects(projectData.projects ?? []);
      })
      .catch(() => {
        if (active)
          setError(
            "Commercial source lookup is unavailable. Refresh after the required source Modules are available."
          );
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    let active = true;
    if (!sourceServiceOrderId) {
      setServiceLines([]);
      return;
    }
    void api<any>(`/lab-services/service-orders/${sourceServiceOrderId}`)
      .then((data) => {
        if (active) setServiceLines(data.lines ?? []);
      })
      .catch(() => {
        if (active) setServiceLines([]);
      });
    return () => {
      active = false;
    };
  }, [api, sourceServiceOrderId]);

  const matchingServices = useMemo(
    () => serviceOrders.filter((order) => order.customerId === customerId),
    [customerId, serviceOrders]
  );
  const currentCustomer = customers.find((customer) => customer.id === customerId);
  const setLine = <K extends keyof DraftLine>(key: K, value: DraftLine[K]) =>
    setDraftLine((current) => ({ ...current, [key]: value }));
  const addLine = () => {
    const quantityValue = draftLine.lineKind === "SERVICE_SCOPE" ? "1" : draftLine.quantityValue;
    const priceBasisQuantity =
      draftLine.lineKind === "SERVICE_SCOPE" ? "1" : draftLine.priceBasisQuantity;
    const requiresSource =
      draftLine.lineKind === "MATERIAL"
        ? draftLine.materialId
        : draftLine.lineKind === "SERVICE_SCOPE"
          ? draftLine.serviceOrderLineId
          : draftLine.formulaVersionId;
    if (
      !draftLine.titleSnapshot.trim() ||
      !requiresSource ||
      !quantityValue ||
      !draftLine.unitPriceMinor ||
      !priceBasisQuantity
    ) {
      setError("Add a title, exact source, quantity and exact price before adding a line.");
      return;
    }
    setLines((current) => [
      ...current,
      {
        ...draftLine,
        quantityValue,
        priceBasisQuantity
      }
    ]);
    setDraftLine(newDraftLine());
    setError(undefined);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lines.length === 0) {
      setError("Add at least one commercial line before creating a draft.");
      return;
    }
    setWorking(true);
    try {
      const mappedLines = lines.map((line, index) => ({
        lineOrder: index + 1,
        lineKind: line.lineKind,
        titleSnapshot: line.titleSnapshot.trim(),
        descriptionSnapshot: null,
        quantityValue: line.quantityValue,
        unitPriceMinor: line.unitPriceMinor,
        priceBasisQuantity: line.priceBasisQuantity,
        discountMinor: line.discountMinor || "0",
        notes: line.notes.trim() || null,
        materialId: line.lineKind === "MATERIAL" ? line.materialId : null,
        serviceOrderLineId: line.lineKind === "SERVICE_SCOPE" ? line.serviceOrderLineId : null,
        formulaVersionId: line.lineKind === "MANUFACTURED_PRODUCT" ? line.formulaVersionId : null
      }));
      const common = {
        customerId,
        customerContactId: null,
        sourceServiceOrderId: sourceServiceOrderId || null,
        sourceProjectId: sourceProjectId || null,
        currencyCode: currency,
        commercialTerms: commercialTerms.trim() || null,
        paymentTermsText: paymentTerms.trim() || null,
        shippingTermsText: shippingTerms.trim() || null,
        shipToSnapshot:
          shipToCountry.trim() || shipToLocality.trim()
            ? { country: shipToCountry.trim(), locality: shipToLocality.trim() }
            : null,
        lines: mappedLines
      };
      const body =
        kind === "quote" ? { quoteNumber: number, ...common } : { orderNumber: number, ...common };
      const result = await api<any>(
        kind === "quote" ? "/commercial-orders/quotes" : "/commercial-orders/orders",
        { method: "POST", body }
      );
      nav(
        kind === "quote"
          ? `/commercial-orders/quotes/${result.quote.quote.id}`
          : `/commercial-orders/${result.order.order.id}`
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Commercial authoring failed.");
    } finally {
      setWorking(false);
    }
  };
  return (
    <section>
      <p className="nox-ai-context">{kind === "quote" ? "NEW QUOTE" : "NEW COMMERCIAL ORDER"}</p>
      <h1>{kind === "quote" ? "Create Quote" : "Create Draft Commercial Order"}</h1>
      <p>
        Source truth remains in Customer, Service, Material and Formula domains. Amounts use integer
        minor units; quantities use integer mg except SERVICE_SCOPE, which is one unit.
      </p>
      <form onSubmit={submit}>
        <label>
          {kind === "quote" ? "Quote number" : "Order number"}
          <input required value={number} onChange={(e) => setNumber(e.target.value)} />
        </label>
        <label>
          Customer
          <select
            required
            value={customerId}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setSourceServiceOrderId("");
              setDraftLine(newDraftLine());
            }}
          >
            <option value="">Select an existing Customer</option>
            {customers
              .filter((customer) => customer.status !== "ARCHIVED")
              .map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.displayName ?? customer.display_name} · {customer.status}
                </option>
              ))}
          </select>
        </label>
        <label>
          Source Service Order
          <select
            value={sourceServiceOrderId}
            onChange={(event) => setSourceServiceOrderId(event.target.value)}
            disabled={!customerId}
          >
            <option value="">None</option>
            {matchingServices.map((service) => (
              <option key={service.id} value={service.id}>
                {service.serviceOrderNumber ?? service.service_order_number ?? service.id} ·{" "}
                {service.status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source Operational Project
          <select
            value={sourceProjectId}
            onChange={(event) => setSourceProjectId(event.target.value)}
          >
            <option value="">None</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.project_code ?? project.id} · {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Currency
          <input
            required
            pattern="[A-Z]{3}"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
        <fieldset>
          <legend>Commercial lines</legend>
          <label>
            Line type
            <select
              value={draftLine.lineKind}
              onChange={(event) =>
                setDraftLine({
                  ...newDraftLine(),
                  lineKind: event.target.value as DraftLine["lineKind"]
                })
              }
            >
              <option value="MATERIAL">Material</option>
              <option value="SERVICE_SCOPE">Service Scope</option>
              <option value="MANUFACTURED_PRODUCT">Manufactured Product</option>
            </select>
          </label>
          <label>
            Title
            <input
              required
              value={draftLine.titleSnapshot}
              onChange={(event) => setLine("titleSnapshot", event.target.value)}
            />
          </label>
          {draftLine.lineKind === "MATERIAL" ? (
            <label>
              Approved accessible Material
              <select
                value={draftLine.materialId}
                onChange={(event) => setLine("materialId", event.target.value)}
              >
                <option value="">Select Material</option>
                {materials.map((entry) => {
                  const material = entry.material ?? entry;
                  return (
                    <option key={material.id} value={material.id}>
                      {material.displayName ?? material.display_name ?? material.id}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}
          {draftLine.lineKind === "SERVICE_SCOPE" ? (
            <label>
              Service Order Line
              <select
                value={draftLine.serviceOrderLineId}
                onChange={(event) => setLine("serviceOrderLineId", event.target.value)}
                disabled={!sourceServiceOrderId}
              >
                <option value="">Select Service Order first</option>
                {serviceLines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.title ?? line.service_type ?? line.id}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {draftLine.lineKind === "MANUFACTURED_PRODUCT" ? (
            <label>
              Approved frozen FormulaVersion ID
              <input
                required
                value={draftLine.formulaVersionId}
                onChange={(event) => setLine("formulaVersionId", event.target.value)}
              />
            </label>
          ) : null}
          <label>
            Quantity {draftLine.lineKind === "SERVICE_SCOPE" ? "(one service)" : "(mg)"}
            <input
              required
              disabled={draftLine.lineKind === "SERVICE_SCOPE"}
              inputMode="numeric"
              value={draftLine.lineKind === "SERVICE_SCOPE" ? "1" : draftLine.quantityValue}
              onChange={(event) => setLine("quantityValue", event.target.value)}
            />
          </label>
          <label>
            Unit price (minor units)
            <input
              required
              inputMode="numeric"
              value={draftLine.unitPriceMinor}
              onChange={(event) => setLine("unitPriceMinor", event.target.value)}
            />
          </label>
          <label>
            Price basis quantity
            <input
              required
              disabled={draftLine.lineKind === "SERVICE_SCOPE"}
              inputMode="numeric"
              value={draftLine.lineKind === "SERVICE_SCOPE" ? "1" : draftLine.priceBasisQuantity}
              onChange={(event) => setLine("priceBasisQuantity", event.target.value)}
            />
          </label>
          <label>
            Discount (minor units)
            <input
              inputMode="numeric"
              value={draftLine.discountMinor}
              onChange={(event) => setLine("discountMinor", event.target.value)}
            />
          </label>
          <label>
            Line notes
            <input
              value={draftLine.notes}
              onChange={(event) => setLine("notes", event.target.value)}
            />
          </label>
          <button type="button" onClick={addLine}>
            Add line
          </button>
          <LineDraftTable
            lines={lines}
            onRemove={(index) => setLines((current) => current.filter((_, item) => item !== index))}
          />
        </fieldset>
        <label>
          Commercial terms
          <textarea
            value={commercialTerms}
            onChange={(event) => setCommercialTerms(event.target.value)}
          />
        </label>
        <label>
          Payment terms text
          <textarea
            value={paymentTerms}
            onChange={(event) => setPaymentTerms(event.target.value)}
          />
        </label>
        <label>
          Shipping terms text
          <textarea
            value={shippingTerms}
            onChange={(event) => setShippingTerms(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>Ship-to snapshot</legend>
          <label>
            Country
            <input
              value={shipToCountry}
              onChange={(event) => setShipToCountry(event.target.value)}
            />
          </label>
          <label>
            Locality
            <input
              value={shipToLocality}
              onChange={(event) => setShipToLocality(event.target.value)}
            />
          </label>
        </fieldset>
        {currentCustomer ? (
          <p>Selected Customer: {currentCustomer.displayName ?? currentCustomer.display_name}</p>
        ) : null}
        <button disabled={working} type="submit">
          {working ? "Creating…" : kind === "quote" ? "Create Draft Quote" : "Create Draft Order"}
        </button>
      </form>
      <Problem error={error} />
    </section>
  );
}

function LineDraftTable({
  lines,
  onRemove
}: {
  lines: DraftLine[];
  onRemove: (index: number) => void;
}) {
  return lines.length ? (
    <table>
      <thead>
        <tr>
          <th>Line</th>
          <th>Type</th>
          <th>Quantity</th>
          <th>Unit price</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={`${line.lineKind}-${line.titleSnapshot}-${index}`}>
            <td>{line.titleSnapshot}</td>
            <td>{line.lineKind}</td>
            <td>{line.lineKind === "SERVICE_SCOPE" ? "1 service" : `${line.quantityValue} mg`}</td>
            <td>{line.unitPriceMinor}</td>
            <td>
              <button type="button" onClick={() => onRemove(index)}>
                Remove
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p>No commercial lines added.</p>
  );
}
function QuoteComposer({ api }: { api: ScopedApi }) {
  return <Composer kind="quote" api={api} />;
}
function OrderComposer({ api }: { api: ScopedApi }) {
  return <Composer kind="order" api={api} />;
}
function QuoteDetail({ api, permissions }: { api: ScopedApi; permissions: string[] }) {
  const { quoteId = "" } = useParams();
  const [data, setData] = useState<any>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  const nav = useNavigate();
  const refresh = useCallback(
    () =>
      void api<any>(`/commercial-orders/quotes/${quoteId}`)
        .then((value) => {
          setData(value);
          setError(undefined);
        })
        .catch(() => setError("Quote was not found or is not accessible.")),
    [api, quoteId]
  );
  useEffect(refresh, [refresh]);
  const action = async (name: string, body?: unknown) => {
    setWorking(true);
    try {
      const value = await api<any>(`/commercial-orders/quotes/${quoteId}/${name}`, {
        method: "POST",
        body: body ?? {}
      });
      if (name === "create-order") nav(`/commercial-orders/${value.order.order.id}`);
      else refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Quote action failed.");
    } finally {
      setWorking(false);
    }
  };
  if (!data) return <Problem error={error} />;
  const quote = data.quote;
  return (
    <section>
      <p className="nox-ai-context">QUOTE · {quote.status}</p>
      <h1>
        {quote.quote_number} · Rev {quote.revision_number}
      </h1>
      <p>
        {quote.customer_display_name_snapshot ?? quote.customer_id} · {quote.currency_code}
      </p>
      <LineTable lines={data.lines} />
      <p>
        Commercial amount: {quote.commercialAmountMinor} {quote.currency_code} minor units.
      </p>
      <p>{quote.commercial_terms ?? "No commercial terms recorded."}</p>
      <div className="nox-actions">
        {quote.status === "DRAFT" &&
        permission(permissions, "module.commercial-orders.quote.issue") ? (
          <button disabled={working} onClick={() => action("issue")}>
            Issue Quote
          </button>
        ) : null}
        {quote.status === "ISSUED" &&
        permission(permissions, "module.commercial-orders.quote.accept") ? (
          <button disabled={working} onClick={() => action("accept")}>
            Mark Accepted
          </button>
        ) : null}
        {quote.status === "ISSUED" &&
        permission(permissions, "module.commercial-orders.quote.revise") ? (
          <button
            disabled={working}
            onClick={() => void action("revise", { quoteNumber: quote.quote_number })}
          >
            Create Revision
          </button>
        ) : null}
        {quote.status === "ISSUED" &&
        permission(permissions, "module.commercial-orders.quote.decline") ? (
          <button disabled={working} onClick={() => action("decline")}>
            Decline
          </button>
        ) : null}
        {quote.status === "ACCEPTED" &&
        permission(permissions, "module.commercial-orders.order.create") ? (
          <button
            disabled={working}
            onClick={() => {
              const orderNumber = window.prompt("Order number");
              if (orderNumber) void action("create-order", { orderNumber });
            }}
          >
            Create Order
          </button>
        ) : null}
        {["DRAFT", "ISSUED"].includes(quote.status) &&
        permission(permissions, "module.commercial-orders.quote.cancel") ? (
          <button disabled={working} onClick={() => action("cancel")}>
            Cancel
          </button>
        ) : null}
      </div>
      <Problem error={error} />
    </section>
  );
}
function OrderDetail({ api, permissions }: { api: ScopedApi; permissions: string[] }) {
  const { orderId = "" } = useParams();
  const [data, setData] = useState<any>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  const refresh = useCallback(
    () =>
      void api<any>(`/commercial-orders/orders/${orderId}`)
        .then((value) => {
          setData(value);
          setError(undefined);
        })
        .catch(() => setError("Commercial Order was not found or is not accessible.")),
    [api, orderId]
  );
  useEffect(refresh, [refresh]);
  const action = async (name: string, body?: unknown) => {
    setWorking(true);
    try {
      await api(`/commercial-orders/orders/${orderId}/${name}`, {
        method: "POST",
        body: body ?? {}
      });
      refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Order action failed.");
    } finally {
      setWorking(false);
    }
  };
  if (!data) return <Problem error={error} />;
  const order = data.order;
  return (
    <section>
      <p className="nox-ai-context">COMMERCIAL ORDER · {order.status}</p>
      <h1>{order.order_number}</h1>
      <p>
        {order.customer_display_name_snapshot ?? order.customer_id} · {order.currency_code}
      </p>
      <dl>
        <dt>Commercial status</dt>
        <dd>{order.status}</dd>
        <dt>Allocation status</dt>
        <dd>{data.allocations.some((x: any) => x.state === "ACTIVE") ? "ALLOCATED" : "NONE"}</dd>
        <dt>Fulfillment status</dt>
        <dd>{order.fulfillmentStatus}</dd>
        <dt>Shipment status</dt>
        <dd>{order.shippingStatus}</dd>
      </dl>
      <LineTable lines={data.lines} />
      <section>
        <h2>Allocation</h2>
        <AllocationList
          api={api}
          allocations={data.allocations}
          canManage={permission(permissions, "module.commercial-orders.allocation.manage")}
          onChange={refresh}
        />
        {permission(permissions, "module.commercial-orders.allocation.manage") ? (
          <AllocationForm api={api} orderId={orderId} lines={data.lines} onChange={refresh} />
        ) : null}
      </section>
      <section>
        <h2>Fulfillment</h2>
        <FulfillmentList
          api={api}
          orderId={orderId}
          fulfillments={data.fulfillments}
          order={order}
          onChange={refresh}
          permissions={permissions}
        />
      </section>
      <section>
        <h2>Shipment</h2>
        <ShipmentList
          api={api}
          shipments={data.shipments}
          onChange={refresh}
          permissions={permissions}
        />
      </section>
      <div className="nox-actions">
        {order.status === "DRAFT" &&
        permission(permissions, "module.commercial-orders.order.confirm") ? (
          <button disabled={working} onClick={() => action("confirm")}>
            Confirm Order
          </button>
        ) : null}
        {order.status === "CONFIRMED" &&
        permission(permissions, "module.commercial-orders.order.close") ? (
          <button disabled={working} onClick={() => action("close")}>
            Close Order
          </button>
        ) : null}
        {["DRAFT", "CONFIRMED"].includes(order.status) &&
        permission(permissions, "module.commercial-orders.order.cancel") ? (
          <button
            disabled={working}
            onClick={() => {
              const reason = window.prompt("Cancellation reason") ?? "";
              if (reason) void action("cancel", { reason });
            }}
          >
            Cancel Order
          </button>
        ) : null}
      </div>
      <Problem error={error} />
    </section>
  );
}
function LineTable({ lines }: { lines: any[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Line</th>
          <th>Kind</th>
          <th>Quantity</th>
          <th>Price</th>
          <th>Discount</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id}>
            <td>{l.title_snapshot}</td>
            <td>{l.line_kind}</td>
            <td>{l.ordered_quantity ?? l.quantity_value}</td>
            <td>
              {l.unit_price_minor}/{l.price_basis_quantity}
            </td>
            <td>{l.discount_minor}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function AllocationList({
  api,
  allocations,
  canManage,
  onChange
}: {
  api: ScopedApi;
  allocations: any[];
  canManage: boolean;
  onChange: () => void;
}) {
  const release = async (allocationId: string) => {
    await api(`/commercial-orders/allocations/${allocationId}/release`, { method: "POST" });
    onChange();
  };
  return allocations.length ? (
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Quantity</th>
          <th>State</th>
          <th>Lot / Batch</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {allocations.map((a) => (
          <tr key={a.id}>
            <td>{a.allocation_type}</td>
            <td>{a.quantity_value}</td>
            <td>{a.state}</td>
            <td>{a.material_lot_id ?? a.production_batch_id}</td>
            <td>
              {canManage && a.state === "ACTIVE" ? (
                <button type="button" onClick={() => void release(a.id)}>
                  Release allocation
                </button>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p>No allocation recorded.</p>
  );
}
function AllocationForm({
  api,
  orderId,
  lines,
  onChange
}: {
  api: ScopedApi;
  orderId: string;
  lines: any[];
  onChange: () => void;
}) {
  const [type, setType] = useState<"MATERIAL_LOT" | "RELEASED_BATCH">("MATERIAL_LOT");
  const [lineId, setLineId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [lotId, setLotId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [error, setError] = useState<string>();
  const availableLines = lines.filter((line) =>
    type === "MATERIAL_LOT"
      ? line.line_kind === "MATERIAL"
      : line.line_kind === "MANUFACTURED_PRODUCT"
  );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api(`/commercial-orders/orders/${orderId}/allocations`, {
        method: "POST",
        body:
          type === "MATERIAL_LOT"
            ? {
                allocationType: type,
                orderLineId: lineId,
                materialLotId: lotId,
                locationId,
                quantityValue: quantity
              }
            : {
                allocationType: type,
                orderLineId: lineId,
                productionBatchId: batchId,
                quantityValue: quantity
              }
      });
      setQuantity("");
      setLotId("");
      setLocationId("");
      setBatchId("");
      await onChange();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Allocation could not be created.");
    }
  };
  return (
    <form onSubmit={submit} aria-label="Create commercial allocation">
      <h3>Create Allocation</h3>
      <label>
        Allocation type
        <select
          value={type}
          onChange={(event) => {
            setType(event.target.value as typeof type);
            setLineId("");
          }}
        >
          <option value="MATERIAL_LOT">Material lot</option>
          <option value="RELEASED_BATCH">Released batch</option>
        </select>
      </label>
      <label>
        Order line
        <select required value={lineId} onChange={(event) => setLineId(event.target.value)}>
          <option value="">Select a compatible order line</option>
          {availableLines.map((line) => (
            <option key={line.id} value={line.id}>
              {line.title_snapshot}
            </option>
          ))}
        </select>
      </label>
      <label>
        Quantity (mg)
        <input
          required
          inputMode="numeric"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </label>
      {type === "MATERIAL_LOT" ? (
        <>
          <label>
            G7 Lot ID
            <input required value={lotId} onChange={(event) => setLotId(event.target.value)} />
          </label>
          <label>
            G7 Location ID
            <input
              required
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            />
          </label>
        </>
      ) : (
        <label>
          G9/G10 Released Batch ID
          <input required value={batchId} onChange={(event) => setBatchId(event.target.value)} />
        </label>
      )}
      <button type="submit">Reserve exact allocation</button>
      <Problem error={error} />
    </form>
  );
}
function FulfillmentList({
  api,
  orderId,
  order,
  fulfillments,
  onChange,
  permissions
}: {
  api: ScopedApi;
  orderId: string;
  order: any;
  fulfillments: any[];
  onChange: () => void;
  permissions: string[];
}) {
  const create = async () => {
    const fulfillmentNumber = window.prompt("Fulfillment number");
    if (!fulfillmentNumber) return;
    await api(`/commercial-orders/orders/${orderId}/fulfillments`, {
      method: "POST",
      body: { fulfillmentNumber }
    });
    onChange();
  };
  const action = async (fulfillmentId: string, name: string, body?: unknown) => {
    await api(`/commercial-orders/fulfillments/${fulfillmentId}/${name}`, {
      method: "POST",
      body: body ?? {}
    });
    onChange();
  };
  const setLines = async (fulfillmentId: string) => {
    const raw = window.prompt(
      "Fulfillment lines JSON: orderLineId, allocationId (physical only), quantityValue",
      "[]"
    );
    if (!raw) return;
    await api(`/commercial-orders/fulfillments/${fulfillmentId}/lines`, {
      method: "PUT",
      body: { lines: JSON.parse(raw) }
    });
    onChange();
  };
  const createShipment = async (fulfillmentId: string) => {
    const shipmentNumber = window.prompt("Shipment number");
    if (!shipmentNumber) return;
    await api(`/commercial-orders/fulfillments/${fulfillmentId}/shipment`, {
      method: "POST",
      body: { shipmentNumber, shipToSnapshot: order.ship_to_snapshot ?? {} }
    });
    onChange();
  };
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Fulfillment</th>
            <th>Status</th>
            <th>Confirmed</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {fulfillments.map((f) => (
            <tr key={f.id}>
              <td>{f.fulfillment_number}</td>
              <td>{f.status}</td>
              <td>{f.confirmed_at ?? "—"}</td>
              <td>
                {f.status === "DRAFT" &&
                permission(permissions, "module.commercial-orders.fulfillment.edit") ? (
                  <button type="button" onClick={() => void setLines(f.id)}>
                    Set exact lines
                  </button>
                ) : null}
                {f.status === "DRAFT" &&
                permission(permissions, "module.commercial-orders.fulfillment.confirm") ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Confirm Fulfillment and consume its exact active allocations?"
                        )
                      )
                        void action(f.id, "confirm");
                    }}
                  >
                    Confirm & consume
                  </button>
                ) : null}
                {f.status === "DRAFT" &&
                permission(permissions, "module.commercial-orders.fulfillment.cancel") ? (
                  <button
                    type="button"
                    onClick={() => void action(f.id, "cancel", { reason: "Cancelled" })}
                  >
                    Cancel
                  </button>
                ) : null}
                {f.status === "CONFIRMED" &&
                permission(permissions, "module.commercial-orders.shipment.create") ? (
                  <button type="button" onClick={() => void createShipment(f.id)}>
                    Create Shipment
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {permission(permissions, "module.commercial-orders.fulfillment.create") ? (
        <button onClick={() => void create()}>Create Draft Fulfillment</button>
      ) : null}
    </>
  );
}
function ShipmentList({
  api,
  shipments,
  onChange,
  permissions
}: {
  api: ScopedApi;
  shipments: any[];
  onChange: () => void;
  permissions: string[];
}) {
  const action = async (shipmentId: string, name: string, body?: unknown) => {
    await api(`/commercial-orders/shipments/${shipmentId}/${name}`, {
      method: "POST",
      body: body ?? {}
    });
    onChange();
  };
  return shipments.length ? (
    <table>
      <thead>
        <tr>
          <th>Shipment</th>
          <th>Status</th>
          <th>Tracking</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {shipments.map((s) => (
          <tr key={s.id}>
            <td>{s.shipment_number}</td>
            <td>{s.status}</td>
            <td>{s.tracking_number ?? "—"}</td>
            <td>
              {s.status === "DRAFT" &&
              permission(permissions, "module.commercial-orders.shipment.ship") ? (
                <button type="button" onClick={() => void action(s.id, "ship")}>
                  Mark Shipped
                </button>
              ) : null}
              {s.status === "SHIPPED" &&
              permission(permissions, "module.commercial-orders.shipment.deliver") ? (
                <button type="button" onClick={() => void action(s.id, "deliver")}>
                  Mark Delivered
                </button>
              ) : null}
              {s.status === "DRAFT" &&
              permission(permissions, "module.commercial-orders.shipment.cancel") ? (
                <button
                  type="button"
                  onClick={() => void action(s.id, "cancel", { reason: "Cancelled" })}
                >
                  Cancel
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p>No Shipment recorded.</p>
  );
}
