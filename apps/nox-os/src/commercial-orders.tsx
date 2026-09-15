import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useWorkspaceObject, useUnsavedChanges } from "@nox-os/ui";
import { CommercialAction } from "./commercial-action";
import { FulfillmentLines } from "./commercial-fulfillment-lines";
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
      <Route
        path="new"
        element={
          permission(modulePermissions, "module.commercial-orders.order.create") ? (
            <OrderComposer api={scopedApi} />
          ) : (
            <p role="alert">Permission denied: creating Commercial Orders is not available.</p>
          )
        }
      />
      <Route
        path="quotes"
        element={
          <QuoteRegistry
            api={scopedApi}
            canCreate={permission(modulePermissions, "module.commercial-orders.quote.create")}
          />
        }
      />
      <Route
        path="quotes/new"
        element={
          permission(modulePermissions, "module.commercial-orders.quote.create") ? (
            <QuoteComposer api={scopedApi} />
          ) : (
            <p role="alert">Permission denied: creating Quotes is not available.</p>
          )
        }
      />
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
// Plain semantic table, using the OS table chrome; no parallel grid/state framework.
function CommercialTable({
  name,
  children,
  columns
}: {
  name: string;
  children: ReactNode;
  columns?: readonly string[];
}) {
  const id = useId();
  const [hidden, setHidden] = useState<number[]>([]);
  const [widths, setWidths] = useState<Record<number, number>>({});
  return (
    <>
      {columns ? (
        <details className="nox-commercial-columns">
          <summary>
            Columns · {columns.length - hidden.length} of {columns.length}
          </summary>
          <fieldset>
            <legend>{name} columns</legend>
            <p>Identity stays visible. Widths and visibility apply to this view only.</p>
            {columns.map((column, index) => (
              <div className="nox-commercial-column-choice" key={column}>
                <label>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(index)}
                    disabled={index === 0}
                    onChange={(event) =>
                      setHidden((old) =>
                        event.target.checked ? old.filter((i) => i !== index) : [...old, index]
                      )
                    }
                  />
                  Show {column}
                  {index === 0 ? " (identity)" : ""}
                </label>
                <label>
                  Width for {column}
                  <select
                    value={widths[index] ?? 0}
                    disabled={hidden.includes(index)}
                    onChange={(event) =>
                      setWidths((old) => ({ ...old, [index]: Number(event.target.value) }))
                    }
                  >
                    <option value={0}>Fit content</option>
                    <option value={160}>160 px</option>
                    <option value={240}>240 px</option>
                    <option value={320}>320 px</option>
                  </select>
                </label>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                setHidden([]);
                setWidths({});
              }}
            >
              Reset columns
            </button>
          </fieldset>
        </details>
      ) : null}
      <style>
        {columns
          ?.map(
            (_, index) =>
              `[data-commercial-table="${id}"] table tr > :nth-child(${index + 1}) { ${hidden.includes(index) ? "display:none;" : ""} ${widths[index] ? `min-width:${widths[index]}px;max-width:${widths[index]}px;width:${widths[index]}px;white-space:normal;overflow-wrap:anywhere;` : ""} }`
          )
          .join("\n")}
      </style>
      <p id={`${id}-keys`} className="nox-table-key-help">
        Arrow keys navigate cells. Tab reaches actions and links.
      </p>
      <div
        className="nox-table-wrap nox-commercial-table"
        data-commercial-table={id}
        role="region"
        aria-label={`${name} scroll area`}
        aria-describedby={`${id}-keys`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (
            !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
          )
            return;
          const target = event.target as HTMLElement;
          // Native editors and action controls retain their own keyboard semantics.
          if (target.closest("input,select,textarea,button")) return;
          const rows = Array.from(event.currentTarget.querySelectorAll("tbody tr"));
          const cell = target.closest("td");
          const rowIndex = rows.indexOf(cell?.parentElement as HTMLTableRowElement);
          const cells = (row: Element) =>
            Array.from(row.querySelectorAll<HTMLTableCellElement>("td")).filter(
              (item) => item.getClientRects().length > 0
            );
          let nextRow = rowIndex;
          let nextCol = cell && rowIndex >= 0 ? cells(rows[rowIndex]!).indexOf(cell) : 0;
          if (rowIndex < 0) nextRow = 0;
          else if (event.key === "ArrowDown") nextRow++;
          else if (event.key === "ArrowUp") nextRow--;
          else if (event.key === "ArrowRight") nextCol++;
          else if (event.key === "ArrowLeft") nextCol--;
          else if (event.key === "Home") nextCol = 0;
          else if (event.key === "End") nextCol = cells(rows[rowIndex]!).length - 1;
          const row = rows[Math.max(0, Math.min(nextRow, rows.length - 1))];
          if (!row) return;
          const visible = cells(row);
          const next = visible[Math.max(0, Math.min(nextCol, visible.length - 1))];
          if (!next) return;
          event.preventDefault();
          const link = next.querySelector<HTMLAnchorElement>("a[href]");
          if (link) link.focus();
          else {
            next.tabIndex = -1;
            next.focus();
          }
        }}
      >
        <table aria-label={name}>{children}</table>
      </div>
    </>
  );
}
function RegistryPage({
  page,
  count,
  onPage
}: {
  page: number;
  count: number;
  onPage: (page: number) => void;
}) {
  return (
    <nav className="nox-table-actions" aria-label="Registry pagination">
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)}>
        Previous page
      </button>
      <span role="status">
        {count ? `${page * 25 + 1}–${Math.min((page + 1) * 25, count)} of ${count}` : "0 results"}
      </span>
      <button type="button" disabled={(page + 1) * 25 >= count} onClick={() => onPage(page + 1)}>
        Next page
      </button>
    </nav>
  );
}
const amountLabel = (value: string | null | undefined, currency: string) =>
  value == null ? "—" : `${value} ${currency} minor units`;
const quantityLabel = (value: string | null | undefined, kind: string) =>
  value == null ? "—" : `${value} ${kind === "SERVICE_SCOPE" ? "service" : "mg"}`;
function OrderRegistry({ api, canCreate }: { api: ScopedApi; canCreate: boolean }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [fulfillment, setFulfillment] = useState("");
  const [shipping, setShipping] = useState("");
  const [customer, setCustomer] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [descending, setDescending] = useState(false);
  const refresh = useCallback(() => {
    setLoading(true);
    return void api<any>("/commercial-orders")
      .then((x) => {
        setOrders(x.orders ?? []);
        setError(undefined);
      })
      .catch(() => setError("Commercial Orders could not be loaded."))
      .finally(() => setLoading(false));
  }, [api]);
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
  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          (descending ? -1 : 1) *
          String(a.order_number).localeCompare(String(b.order_number), undefined, { numeric: true })
      ),
    [filtered, descending]
  );
  useEffect(() => setPage(0), [customer, fulfillment, shipping, status, descending]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(sorted.length / 25) - 1));
  return (
    <section className="nox-commercial-workspace">
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
      {error ? (
        <button type="button" onClick={refresh}>
          Retry Orders
        </button>
      ) : null}
      <fieldset className="nox-commercial-filters">
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
        {customer || status || fulfillment || shipping ? (
          <button
            type="button"
            onClick={() => {
              setCustomer("");
              setStatus("");
              setFulfillment("");
              setShipping("");
            }}
          >
            Clear filters
          </button>
        ) : null}
      </fieldset>
      {loading ? (
        <p role="status" aria-busy="true">
          Loading Commercial Orders…
        </p>
      ) : error ? null : (
        <>
          <CommercialTable
            name="Commercial Orders"
            columns={[
              "Order",
              "Customer",
              "Source Project",
              "Commercial amount",
              "Currency",
              "Commercial status",
              "Allocation",
              "Fulfillment",
              "Shipment",
              "Confirmed",
              "Updated"
            ]}
          >
            <thead>
              <tr>
                <th scope="col" aria-sort={descending ? "descending" : "ascending"}>
                  <button type="button" onClick={() => setDescending(!descending)}>
                    Order {descending ? "↓" : "↑"}
                  </button>
                </th>
                <th>Customer</th>
                <th>Source Project</th>
                <th className="nox-numeric">Commercial amount</th>
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
              {sorted.slice(currentPage * 25, (currentPage + 1) * 25).map((order) => (
                <tr key={order.id}>
                  <td>
                    <Link to={`/commercial-orders/${order.id}`}>{order.order_number}</Link>
                  </td>
                  <td>{order.customer_display_name_snapshot ?? order.customer_id}</td>
                  <td>{order.source_project_id ?? "—"}</td>
                  <td className="nox-numeric">
                    {amountLabel(order.commercialAmountMinor, order.currency_code)}
                  </td>
                  <td>{order.currency_code}</td>
                  <td>{order.status}</td>
                  <td>{order.allocationStatus}</td>
                  <td>{order.fulfillmentStatus}</td>
                  <td>{order.shippingStatus}</td>
                  <td>
                    {order.confirmed_at ? new Date(order.confirmed_at).toLocaleString() : "—"}
                  </td>
                  <td>{new Date(order.updated_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </CommercialTable>
          {filtered.length === 0 ? <p>No Commercial Orders match these filters.</p> : null}
          <RegistryPage page={currentPage} count={sorted.length} onPage={setPage} />
        </>
      )}
    </section>
  );
}
function QuoteRegistry({ api, canCreate }: { api: ScopedApi; canCreate: boolean }) {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [customer, setCustomer] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [descending, setDescending] = useState(false);
  const refresh = useCallback(() => {
    setLoading(true);
    void api<any>("/commercial-orders/quotes")
      .then((x) => {
        setQuotes(x.quotes ?? []);
        setError(undefined);
      })
      .catch(() => setError("Quotes could not be loaded."))
      .finally(() => setLoading(false));
  }, [api]);
  useEffect(refresh, [refresh]);
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
  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          (descending ? -1 : 1) *
          String(a.quote_number).localeCompare(String(b.quote_number), undefined, { numeric: true })
      ),
    [filtered, descending]
  );
  useEffect(() => setPage(0), [customer, status, descending]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(sorted.length / 25) - 1));
  return (
    <section className="nox-commercial-workspace">
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
      {error ? (
        <button type="button" onClick={refresh}>
          Retry Quotes
        </button>
      ) : null}
      <fieldset className="nox-commercial-filters">
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
        {customer || status ? (
          <button
            type="button"
            onClick={() => {
              setCustomer("");
              setStatus("");
            }}
          >
            Clear filters
          </button>
        ) : null}
      </fieldset>
      {loading ? (
        <p role="status" aria-busy="true">
          Loading Quotes…
        </p>
      ) : error ? null : (
        <>
          <CommercialTable
            name="Quotes"
            columns={[
              "Quote",
              "Revision",
              "Customer",
              "Source",
              "Amount",
              "Status",
              "Currency",
              "Valid until"
            ]}
          >
            <thead>
              <tr>
                <th scope="col" aria-sort={descending ? "descending" : "ascending"}>
                  <button type="button" onClick={() => setDescending(!descending)}>
                    Quote {descending ? "↓" : "↑"}
                  </button>
                </th>
                <th>Revision</th>
                <th>Customer</th>
                <th>Source</th>
                <th className="nox-numeric">Amount</th>
                <th>Status</th>
                <th>Currency</th>
                <th>Valid until</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(currentPage * 25, (currentPage + 1) * 25).map((q) => (
                <tr key={q.id}>
                  <td>
                    <Link to={`/commercial-orders/quotes/${q.id}`}>{q.quote_number}</Link>
                  </td>
                  <td>{q.revision_number}</td>
                  <td>{q.customer_display_name_snapshot ?? q.customer_id}</td>
                  <td>{q.source_project_id ?? q.source_service_order_id ?? "—"}</td>
                  <td className="nox-numeric">
                    {amountLabel(q.commercialAmountMinor, q.currency_code)}
                  </td>
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
          </CommercialTable>
          {filtered.length === 0 ? <p>No Quotes match these filters.</p> : null}
          <RegistryPage page={currentPage} count={sorted.length} onPage={setPage} />
        </>
      )}
    </section>
  );
}
type LookupStatus = "LOADING" | "READY" | "ERROR";
type LookupName = "Customers" | "Service Orders" | "Materials" | "Projects";
function LookupFeedback({
  name,
  status,
  empty,
  retry
}: {
  name: string;
  status: LookupStatus;
  empty: boolean;
  retry: () => void;
}) {
  if (status === "LOADING")
    return (
      <p role="status" aria-busy="true">
        Loading {name}…
      </p>
    );
  if (status === "ERROR")
    return (
      <div>
        <p role="alert">{name} lookup is unavailable. Your draft is unchanged.</p>
        <button type="button" onClick={retry}>
          Retry {name}
        </button>
      </div>
    );
  return empty ? <p>No accessible {name} found.</p> : null;
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
  const [lookupStatus, setLookupStatus] = useState<Record<LookupName, LookupStatus>>({
    Customers: "LOADING",
    "Service Orders": "LOADING",
    Materials: "LOADING",
    Projects: "LOADING"
  });
  const [serviceLineStatus, setServiceLineStatus] = useState<LookupStatus>("READY");
  const [serviceLineRetry, setServiceLineRetry] = useState(0);
  const lookupGeneration = useRef(0);
  const loadSources = useCallback(
    (only?: LookupName) => {
      const generation = lookupGeneration.current;
      const sources: Array<{
        name: LookupName;
        path: string;
        field: string;
        set: (items: any[]) => void;
      }> = [
        {
          name: "Customers",
          path: "/lab-services/customers",
          field: "customers",
          set: setCustomers
        },
        {
          name: "Service Orders",
          path: "/lab-services/service-orders",
          field: "serviceOrders",
          set: setServiceOrders
        },
        { name: "Materials", path: "/materials", field: "materials", set: setMaterials },
        {
          name: "Projects",
          path: "/project-operations/projects",
          field: "projects",
          set: setProjects
        }
      ];
      for (const source of sources.filter((item) => !only || item.name === only)) {
        setLookupStatus((old) => ({ ...old, [source.name]: "LOADING" }));
        void api<any>(source.path)
          .then((data) => {
            if (generation !== lookupGeneration.current) return;
            if (!Array.isArray(data[source.field])) throw Error("Invalid source response");
            source.set(data[source.field]);
            setLookupStatus((old) => ({ ...old, [source.name]: "READY" }));
          })
          .catch(() => {
            if (generation !== lookupGeneration.current) return;
            source.set([]);
            setLookupStatus((old) => ({ ...old, [source.name]: "ERROR" }));
          });
      }
    },
    [api]
  );

  const sending = useRef(false);
  const [destination, setDestination] = useState<string>();
  const pendingLine = JSON.stringify(draftLine) !== JSON.stringify(newDraftLine());
  useUnsavedChanges(
    !destination &&
      Boolean(
        customerId ||
        sourceServiceOrderId ||
        sourceProjectId ||
        number ||
        currency !== "USD" ||
        commercialTerms ||
        paymentTerms ||
        shippingTerms ||
        shipToCountry ||
        shipToLocality ||
        lines.length ||
        pendingLine
      )
  );
  // Publish the clean state before asking the existing app navigation guard to leave.
  useEffect(() => {
    if (destination) nav(destination);
  }, [destination, nav]);

  useEffect(() => {
    lookupGeneration.current++;
    setCustomers([]);
    setServiceOrders([]);
    setMaterials([]);
    setProjects([]);
    loadSources();
    return () => {
      lookupGeneration.current++;
    };
  }, [loadSources]);

  useEffect(() => {
    let active = true;
    setServiceLines([]);
    if (!sourceServiceOrderId) {
      setServiceLineStatus("READY");
      return;
    }
    setServiceLineStatus("LOADING");
    void api<any>(`/lab-services/service-orders/${sourceServiceOrderId}`)
      .then((data) => {
        if (!active) return;
        if (!Array.isArray(data.lines)) throw Error("Invalid Service Lines response");
        setServiceLines(data.lines);
        setServiceLineStatus("READY");
      })
      .catch(() => {
        if (active) {
          setServiceLines([]);
          setServiceLineStatus("ERROR");
        }
      });
    return () => {
      active = false;
    };
  }, [api, sourceServiceOrderId, serviceLineRetry]);

  const matchingServices = useMemo(
    () => serviceOrders.filter((order) => order.customerId === customerId),
    [customerId, serviceOrders]
  );
  const currentCustomer = customers.find((customer) => customer.id === customerId);
  const setLine = <K extends keyof DraftLine>(key: K, value: DraftLine[K]) =>
    setDraftLine((current) => ({ ...current, [key]: value }));
  const addLine = () => {
    if (sending.current) return;
    if (
      (draftLine.lineKind === "MATERIAL" &&
        (lookupStatus.Materials !== "READY" ||
          !materials.some((entry) => (entry.material ?? entry).id === draftLine.materialId))) ||
      (draftLine.lineKind === "SERVICE_SCOPE" &&
        (serviceLineStatus !== "READY" ||
          !serviceLines.some((line) => line.id === draftLine.serviceOrderLineId)))
    ) {
      setError("Load the current source and select an accessible line before adding it.");
      return;
    }
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
      !/^[1-9][0-9]*$/.test(quantityValue) ||
      !/^(0|[1-9][0-9]*)$/.test(draftLine.unitPriceMinor) ||
      !/^[1-9][0-9]*$/.test(priceBasisQuantity) ||
      !/^(0|[1-9][0-9]*)$/.test(draftLine.discountMinor || "0") ||
      lines.length >= 100
    ) {
      setError(
        "Add a title and exact source. Quantity/price basis must be positive integers; price/discount must be non-negative integers. Maximum 100 lines."
      );
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
    if (sending.current) return;
    if (
      lookupStatus.Customers !== "READY" ||
      !currentCustomer ||
      currentCustomer.status === "ARCHIVED" ||
      (sourceServiceOrderId && lookupStatus["Service Orders"] !== "READY") ||
      (sourceProjectId && lookupStatus.Projects !== "READY")
    ) {
      setError("Load the selected Customer and source references before creating this draft.");
      return;
    }
    if (pendingLine) {
      setError("Finish adding the current line or explicitly clear it before creating the draft.");
      return;
    }
    if (lines.length === 0) {
      setError("Add at least one commercial line before creating a draft.");
      return;
    }
    sending.current = true;
    setWorking(true);
    setError(undefined);
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
      setDestination(
        kind === "quote"
          ? `/commercial-orders/quotes/${result.quote.quote.id}`
          : `/commercial-orders/${result.order.order.id}`
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Commercial authoring failed.");
    } finally {
      sending.current = false;
      setWorking(false);
    }
  };
  return (
    <section className="nox-commercial-workspace">
      <p className="nox-ai-context">{kind === "quote" ? "NEW QUOTE" : "NEW COMMERCIAL ORDER"}</p>
      <h1>{kind === "quote" ? "Create Quote" : "Create Draft Commercial Order"}</h1>
      <p>
        Source truth remains in Customer, Service, Material and Formula domains. Amounts use integer
        minor units; quantities use integer mg except SERVICE_SCOPE, which is one unit.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={working || Boolean(destination)} className="nox-commercial-authoring">
          <legend>Draft {kind === "quote" ? "Quote" : "Order"} details</legend>
          <label>
            {kind === "quote" ? "Quote number" : "Order number"}
            <input
              required
              maxLength={80}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </label>
          <div>
            <label>
              Customer
              <select
                required
                disabled={lookupStatus.Customers !== "READY"}
                value={customerId}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  setSourceServiceOrderId("");
                  setDraftLine((current) => ({ ...current, serviceOrderLineId: "" }));
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
            <LookupFeedback
              name="Customers"
              status={lookupStatus.Customers}
              empty={!customers.length}
              retry={() => loadSources("Customers")}
            />
          </div>
          <div>
            <label>
              Source Service Order
              <select
                value={sourceServiceOrderId}
                onChange={(event) => {
                  setSourceServiceOrderId(event.target.value);
                  setServiceLines([]);
                  setServiceLineStatus(event.target.value ? "LOADING" : "READY");
                  setLine("serviceOrderLineId", "");
                }}
                disabled={!customerId || lookupStatus["Service Orders"] !== "READY"}
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
            <LookupFeedback
              name="Service Orders"
              status={lookupStatus["Service Orders"]}
              empty={Boolean(customerId) && !matchingServices.length}
              retry={() => loadSources("Service Orders")}
            />
          </div>
          <div>
            <label>
              Source Operational Project
              <select
                disabled={lookupStatus.Projects !== "READY"}
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
            <LookupFeedback
              name="Projects"
              status={lookupStatus.Projects}
              empty={!projects.length}
              retry={() => loadSources("Projects")}
            />
          </div>
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
                  setLine("lineKind", event.target.value as DraftLine["lineKind"])
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
                maxLength={300}
                value={draftLine.titleSnapshot}
                onChange={(event) => setLine("titleSnapshot", event.target.value)}
              />
            </label>
            {draftLine.lineKind === "MATERIAL" ? (
              <div>
                <label>
                  Approved accessible Material
                  <select
                    disabled={lookupStatus.Materials !== "READY"}
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
                <LookupFeedback
                  name="Materials"
                  status={lookupStatus.Materials}
                  empty={!materials.length}
                  retry={() => loadSources("Materials")}
                />
              </div>
            ) : null}
            {draftLine.lineKind === "SERVICE_SCOPE" ? (
              <div>
                <label>
                  Service Order Line
                  <select
                    value={draftLine.serviceOrderLineId}
                    onChange={(event) => setLine("serviceOrderLineId", event.target.value)}
                    disabled={!sourceServiceOrderId || serviceLineStatus !== "READY"}
                  >
                    <option value="">Select Service Order first</option>
                    {serviceLines.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.title ?? line.service_type ?? line.id}
                      </option>
                    ))}
                  </select>
                </label>
                {sourceServiceOrderId ? (
                  <LookupFeedback
                    name="Service Lines"
                    status={serviceLineStatus}
                    empty={!serviceLines.length}
                    retry={() => setServiceLineRetry((count) => count + 1)}
                  />
                ) : (
                  <p>Select a Service Order to load its lines.</p>
                )}
              </div>
            ) : null}
            {draftLine.lineKind === "MANUFACTURED_PRODUCT" ? (
              <label>
                Approved frozen FormulaVersion ID
                <input
                  value={draftLine.formulaVersionId}
                  onChange={(event) => setLine("formulaVersionId", event.target.value)}
                />
              </label>
            ) : null}
            <label>
              Quantity {draftLine.lineKind === "SERVICE_SCOPE" ? "(one service)" : "(mg)"}
              <input
                disabled={draftLine.lineKind === "SERVICE_SCOPE"}
                inputMode="numeric"
                value={draftLine.lineKind === "SERVICE_SCOPE" ? "1" : draftLine.quantityValue}
                onChange={(event) => setLine("quantityValue", event.target.value)}
              />
            </label>
            <label>
              Unit price (minor units)
              <input
                inputMode="numeric"
                value={draftLine.unitPriceMinor}
                onChange={(event) => setLine("unitPriceMinor", event.target.value)}
              />
            </label>
            <label>
              Price basis quantity
              <input
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
            {pendingLine ? (
              <button type="button" onClick={() => setDraftLine(newDraftLine())}>
                Clear unadded line
              </button>
            ) : null}
            <LineDraftTable
              lines={lines}
              currency={currency}
              onRemove={(index) =>
                setLines((current) => current.filter((_, item) => item !== index))
              }
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
        </fieldset>
      </form>
      <Problem error={error} />
    </section>
  );
}

function LineDraftTable({
  lines,
  currency,
  onRemove
}: {
  lines: DraftLine[];
  currency: string;
  onRemove: (index: number) => void;
}) {
  return lines.length ? (
    <CommercialTable name="Draft commercial lines">
      <thead>
        <tr>
          <th>Line</th>
          <th>Type</th>
          <th className="nox-numeric">Quantity</th>
          <th className="nox-numeric">Unit price</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={`${line.lineKind}-${line.titleSnapshot}-${index}`}>
            <td>{line.titleSnapshot}</td>
            <td>{line.lineKind}</td>
            <td className="nox-numeric">{quantityLabel(line.quantityValue, line.lineKind)}</td>
            <td className="nox-numeric">{amountLabel(line.unitPriceMinor, currency)}</td>
            <td>
              <button type="button" onClick={() => onRemove(index)}>
                Remove
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </CommercialTable>
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
  const workspaceObject = useMemo(
    () =>
      !error && data?.quote?.id === quoteId
        ? {
            id: data.quote.id,
            objectType: "CommercialQuote",
            title: `${data.quote.quote_number} · Rev ${data.quote.revision_number}`,
            route: `/commercial-orders/quotes/${data.quote.id}`,
            properties: [
              { label: "Status", value: data.quote.status },
              {
                label: "Customer",
                value: data.quote.customer_display_name_snapshot ?? data.quote.customer_id
              },
              { label: "Currency", value: data.quote.currency_code }
            ]
          }
        : undefined,
    [data, quoteId, error]
  );
  useWorkspaceObject(workspaceObject);
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
    <section className="nox-commercial-workspace">
      <p className="nox-ai-context">QUOTE · {quote.status}</p>
      <h1>
        {quote.quote_number} · Rev {quote.revision_number}
      </h1>
      <p>
        {quote.customer_display_name_snapshot ?? quote.customer_id} · {quote.currency_code}
      </p>
      <LineTable lines={data.lines} currency={quote.currency_code} />
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
  const workspaceObject = useMemo(
    () =>
      !error && data?.order?.id === orderId
        ? {
            id: data.order.id,
            objectType: "CommercialOrder",
            title: data.order.order_number,
            route: `/commercial-orders/${data.order.id}`,
            properties: [
              { label: "Status", value: data.order.status },
              {
                label: "Customer",
                value: data.order.customer_display_name_snapshot ?? data.order.customer_id
              },
              { label: "Fulfillment", value: data.order.fulfillmentStatus },
              { label: "Shipping", value: data.order.shippingStatus }
            ]
          }
        : undefined,
    [data, orderId, error]
  );
  useWorkspaceObject(workspaceObject);
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
    <section className="nox-commercial-workspace">
      <p className="nox-ai-context">COMMERCIAL ORDER · {order.status}</p>
      <h1>{order.order_number}</h1>
      <p>
        {order.customer_display_name_snapshot ?? order.customer_id} · {order.currency_code}
      </p>
      <dl className="nox-commercial-facts">
        <dt>Commercial status</dt>
        <dd>{order.status}</dd>
        <dt>Allocation status</dt>
        <dd>{data.allocations.some((x: any) => x.state === "ACTIVE") ? "ALLOCATED" : "NONE"}</dd>
        <dt>Fulfillment status</dt>
        <dd>{order.fulfillmentStatus}</dd>
        <dt>Shipment status</dt>
        <dd>{order.shippingStatus}</dd>
      </dl>
      <LineTable lines={data.lines} currency={order.currency_code} />
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
          orderLines={data.lines}
          allocations={data.allocations}
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
function LineTable({ lines, currency }: { lines: any[]; currency: string }) {
  return (
    <CommercialTable name="Commercial lines">
      <thead>
        <tr>
          <th>Line</th>
          <th>Kind</th>
          <th className="nox-numeric">Quantity</th>
          <th className="nox-numeric">Price / basis</th>
          <th className="nox-numeric">Discount</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id}>
            <td>{l.title_snapshot}</td>
            <td>{l.line_kind}</td>
            <td className="nox-numeric">
              {quantityLabel(l.ordered_quantity ?? l.quantity_value, l.line_kind)}
            </td>
            <td className="nox-numeric">
              {amountLabel(l.unit_price_minor, currency)} /{" "}
              {quantityLabel(l.price_basis_quantity, l.line_kind)}
            </td>
            <td className="nox-numeric">{amountLabel(l.discount_minor, currency)}</td>
          </tr>
        ))}
        {lines.length === 0 ? (
          <tr>
            <td colSpan={5}>No commercial lines recorded.</td>
          </tr>
        ) : null}
      </tbody>
    </CommercialTable>
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
    <CommercialTable name="Allocations">
      <thead>
        <tr>
          <th>Type</th>
          <th className="nox-numeric">Quantity</th>
          <th>State</th>
          <th>Lot / Batch</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {allocations.map((a) => (
          <tr key={a.id}>
            <td>{a.allocation_type}</td>
            <td className="nox-numeric">{quantityLabel(a.quantity_value, "PHYSICAL")}</td>
            <td>{a.state}</td>
            <td>{a.material_lot_id ?? a.production_batch_id}</td>
            <td>
              {canManage && a.state === "ACTIVE" ? (
                <CommercialAction
                  label="Release allocation"
                  target={a.id}
                  state={a.state}
                  version={a.updated_at}
                  permission="module.commercial-orders.allocation.manage"
                  effect={`Release this allocation of ${a.quantity_value} mg. This is not stock disposal or shipment.`}
                  onConfirm={() => release(a.id)}
                />
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </CommercialTable>
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
  orderLines,
  allocations,
  onChange,
  permissions
}: {
  api: ScopedApi;
  orderId: string;
  order: any;
  fulfillments: any[];
  orderLines: any[];
  allocations: any[];
  onChange: () => void;
  permissions: string[];
}) {
  const [editingId, setEditingId] = useState<string>();
  const create = async (fulfillmentNumber: string) => {
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
  const createShipment = async (fulfillmentId: string, shipmentNumber: string) => {
    await api(`/commercial-orders/fulfillments/${fulfillmentId}/shipment`, {
      method: "POST",
      body: { shipmentNumber, shipToSnapshot: order.ship_to_snapshot ?? {} }
    });
    onChange();
  };
  return (
    <>
      <CommercialTable name="Fulfillments">
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
                  <button type="button" onClick={() => setEditingId(f.id)}>
                    Set exact lines
                  </button>
                ) : null}
                {f.status === "DRAFT" &&
                permission(permissions, "module.commercial-orders.fulfillment.confirm") ? (
                  <CommercialAction
                    label="Confirm & consume"
                    target={`${f.fulfillment_number} · ${f.id}`}
                    state={f.status}
                    version={f.updated_at}
                    disabled={order.status !== "CONFIRMED"}
                    permission="module.commercial-orders.fulfillment.confirm"
                    effect="Confirm the saved exact fulfillment lines and consume their active physical allocations atomically. This does not mark a Shipment delivered."
                    onConfirm={() => action(f.id, "confirm")}
                  />
                ) : null}
                {f.status === "DRAFT" &&
                permission(permissions, "module.commercial-orders.fulfillment.cancel") ? (
                  <CommercialAction
                    label="Cancel Fulfillment"
                    target={`${f.fulfillment_number} · ${f.id}`}
                    state={f.status}
                    version={f.updated_at}
                    permission="module.commercial-orders.fulfillment.cancel"
                    input={{ label: "Cancellation reason", maxLength: 2000 }}
                    effect="Cancel this draft fulfillment. No automatic stock return is performed."
                    onConfirm={(reason) => action(f.id, "cancel", { reason })}
                  />
                ) : null}
                {f.status === "CONFIRMED" &&
                permission(permissions, "module.commercial-orders.shipment.create") ? (
                  <CommercialAction
                    label="Create Shipment"
                    target={`${f.fulfillment_number} · ${f.id}`}
                    state={f.status}
                    version={f.updated_at}
                    permission="module.commercial-orders.shipment.create"
                    input={{ label: "Shipment number", maxLength: 80 }}
                    effect="Create a draft shipment for this confirmed fulfillment using the Order's shipping-address snapshot. This does not mark it shipped."
                    onConfirm={(number) => createShipment(f.id, number)}
                  />
                ) : null}
              </td>
            </tr>
          ))}
          {fulfillments.length === 0 ? (
            <tr>
              <td colSpan={4}>No fulfillment recorded.</td>
            </tr>
          ) : null}
        </tbody>
      </CommercialTable>
      {editingId && permission(permissions, "module.commercial-orders.fulfillment.edit") ? (
        <FulfillmentLines
          api={api}
          fulfillmentId={editingId}
          orderId={orderId}
          orderLines={orderLines}
          allocations={allocations}
          onClose={() => setEditingId(undefined)}
        />
      ) : null}
      {permission(permissions, "module.commercial-orders.fulfillment.create") ? (
        <CommercialAction
          label="Create Draft Fulfillment"
          target={`${order.order_number} · ${orderId}`}
          state={order.status}
          version={order.updated_at}
          disabled={order.status !== "CONFIRMED"}
          permission="module.commercial-orders.fulfillment.create"
          input={{ label: "Fulfillment number", maxLength: 80 }}
          effect="Create one draft fulfillment. Creating a draft does not consume stock; exact lines must be saved and explicitly confirmed."
          onConfirm={create}
        />
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
    <CommercialTable name="Shipments">
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
                <CommercialAction
                  label="Mark Shipped"
                  target={`${s.shipment_number} · ${s.id}`}
                  state={s.status}
                  version={s.updated_at}
                  permission="module.commercial-orders.shipment.ship"
                  effect="Record this shipment as shipped. Delivery remains a separate explicit action."
                  onConfirm={() => action(s.id, "ship")}
                />
              ) : null}
              {s.status === "SHIPPED" &&
              permission(permissions, "module.commercial-orders.shipment.deliver") ? (
                <CommercialAction
                  label="Mark Delivered"
                  target={`${s.shipment_number} · ${s.id}`}
                  state={s.status}
                  version={s.updated_at}
                  permission="module.commercial-orders.shipment.deliver"
                  effect="Record delivery of this shipped shipment. This does not approve or release a Production Batch."
                  onConfirm={() => action(s.id, "deliver")}
                />
              ) : null}
              {s.status === "DRAFT" &&
              permission(permissions, "module.commercial-orders.shipment.cancel") ? (
                <CommercialAction
                  label="Cancel Shipment"
                  target={`${s.shipment_number} · ${s.id}`}
                  state={s.status}
                  version={s.updated_at}
                  permission="module.commercial-orders.shipment.cancel"
                  input={{ label: "Cancellation reason", maxLength: 2000 }}
                  effect="Cancel this draft shipment. This does not undo its confirmed fulfillment or return stock."
                  onConfirm={(reason) => action(s.id, "cancel", { reason })}
                />
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </CommercialTable>
  ) : (
    <p>No Shipment recorded.</p>
  );
}
