import { useEffect, useState, type FormEvent } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  labServicesPermissions as permissions,
  type Customer,
  type CustomerContact,
  type CustomerInteraction,
  type CustomerRegistryEntry,
  type ServiceOrder,
  type ServiceOrderLine
} from "@nox-os/lab-services/browser";
import type { ApiClient } from "./platform-control";

type Props = {
  api: ApiClient;
  tenantId?: string;
  modulePermissions?: readonly string[];
};
const allowed = (values: readonly string[], permission: string) => values.includes(permission);
const message = (error: unknown) => (error instanceof Error ? error.message : "Request failed.");
const date = (value: Date | string | null | undefined) =>
  value ? new Date(value).toLocaleDateString() : "—";

function Registry(props: Props) {
  const [customers, setCustomers] = useState<CustomerRegistryEntry[]>([]);
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [view, setView] = useState<"customers" | "orders">("customers");
  const [error, setError] = useState<string>();
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const navigate = useNavigate();
  const load = () => {
    if (!props.tenantId) return;
    void Promise.all([
      props.api<{ customers: CustomerRegistryEntry[] }>("/lab-services/customers", {
        tenantId: props.tenantId
      }),
      props.api<{ serviceOrders: ServiceOrder[] }>("/lab-services/service-orders", {
        tenantId: props.tenantId
      })
    ])
      .then(([a, b]) => {
        setCustomers(a.customers);
        setOrders(b.serviceOrders);
      })
      .catch((reason) => setError(message(reason)));
  };
  useEffect(load, [props.tenantId]);

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.tenantId) return;
    const data = new FormData(event.currentTarget);
    try {
      const result = await props.api<{ customer: Customer }>("/lab-services/customers", {
        method: "POST",
        tenantId: props.tenantId,
        body: {
          customerCode: String(data.get("customerCode")),
          customerType: data.get("customerType"),
          displayName: String(data.get("displayName")),
          legalName: String(data.get("legalName") || "").trim() || null,
          taxIdentifier: null,
          countryCode: null,
          notes: null
        }
      });
      navigate(`/lab-services/customers/${result.customer.id}`);
    } catch (reason) {
      setError(message(reason));
    }
  }
  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.tenantId) return;
    const data = new FormData(event.currentTarget);
    try {
      const result = await props.api<{ serviceOrder: ServiceOrder }>(
        "/lab-services/service-orders",
        {
          method: "POST",
          tenantId: props.tenantId,
          body: {
            orderNumber: String(data.get("orderNumber")),
            customerId: data.get("customerId"),
            customerContactId: null,
            customerExternalReference: null,
            intakeSummary: String(data.get("intakeSummary")),
            requestedCompletionDate: null,
            notes: null,
            lines: []
          }
        }
      );
      navigate(`/lab-services/service-orders/${result.serviceOrder.id}`);
    } catch (reason) {
      setError(message(reason));
    }
  }
  return (
    <main aria-labelledby="lab-services-title">
      <header className="nox-module-header">
        <div>
          <p className="nox-ai-context">CUSTOMER & SERVICE AUTHORITY</p>
          <h1 id="lab-services-title">NØX Lab Services</h1>
          <p>Customer master, confirmed service scope, and relationship interactions.</p>
        </div>
        <div>
          {allowed(props.modulePermissions ?? [], permissions.manageCustomer) ? (
            <button type="button" onClick={() => setShowCustomerForm(!showCustomerForm)}>
              Add Customer
            </button>
          ) : null}
          {allowed(props.modulePermissions ?? [], permissions.createServiceOrder) ? (
            <button type="button" onClick={() => setShowOrderForm(!showOrderForm)}>
              New Service Order
            </button>
          ) : null}
        </div>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {showCustomerForm ? (
        <form className="nox-form-grid" onSubmit={(event) => void createCustomer(event)}>
          <label>
            Customer code
            <input name="customerCode" required />
          </label>
          <label>
            Type
            <select name="customerType">
              <option>BUSINESS</option>
              <option>INDIVIDUAL</option>
            </select>
          </label>
          <label>
            Display name
            <input name="displayName" required />
          </label>
          <label>
            Legal name
            <input name="legalName" />
          </label>
          <button type="submit">Create Customer</button>
        </form>
      ) : null}
      {showOrderForm ? (
        <form className="nox-form-grid" onSubmit={(event) => void createOrder(event)}>
          <label>
            Order number
            <input name="orderNumber" required />
          </label>
          <label>
            Customer
            <select name="customerId" required>
              <option value="">Select</option>
              {customers
                .filter((item) => item.status === "ACTIVE" || item.status === "PROSPECT")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Intake summary
            <textarea name="intakeSummary" required />
          </label>
          <button type="submit">Create DRAFT</button>
        </form>
      ) : null}
      <nav className="nox-workspace-tabs" aria-label="Lab Services registry">
        <button
          type="button"
          aria-current={view === "customers" ? "page" : undefined}
          onClick={() => setView("customers")}
        >
          Customers
        </button>
        <button
          type="button"
          aria-current={view === "orders" ? "page" : undefined}
          onClick={() => setView("orders")}
        >
          Service Orders
        </button>
      </nav>
      <div className="nox-table-wrap">
        <table>
          <thead>
            <tr>
              {view === "customers" ? (
                <>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Primary Contact</th>
                  <th>Open Orders</th>
                  <th>Last Interaction</th>
                  <th>Updated</th>
                </>
              ) : (
                <>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Scope summary</th>
                  <th>Requested completion</th>
                  <th>Status</th>
                  <th>Updated</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {view === "customers"
              ? customers.map((item) => (
                  <tr key={item.id} onClick={() => navigate(`/lab-services/customers/${item.id}`)}>
                    <td>
                      <Link to={`/lab-services/customers/${item.id}`}>{item.displayName}</Link>
                    </td>
                    <td>{item.customerType}</td>
                    <td>{item.status}</td>
                    <td>{item.primaryContactName ?? "—"}</td>
                    <td>{item.openServiceOrderCount}</td>
                    <td>{date(item.lastInteractionAt)}</td>
                    <td>{date(item.updatedAt)}</td>
                  </tr>
                ))
              : orders.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => navigate(`/lab-services/service-orders/${item.id}`)}
                  >
                    <td>
                      <Link to={`/lab-services/service-orders/${item.id}`}>{item.orderNumber}</Link>
                    </td>
                    <td>{item.customerDisplayName}</td>
                    <td>{item.contactFullName ?? "—"}</td>
                    <td>{item.intakeSummary}</td>
                    <td>{date(item.requestedCompletionDate)}</td>
                    <td>{item.status}</td>
                    <td>{date(item.updatedAt)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {view === "customers" && customers.length === 0 ? <p>No Customers found.</p> : null}
      {view === "orders" && orders.length === 0 ? <p>No Service Orders found.</p> : null}
    </main>
  );
}

function CustomerDetail(props: Props) {
  const { customerId = "" } = useParams();
  const [customer, setCustomer] = useState<Customer>();
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [interactions, setInteractions] = useState<CustomerInteraction[]>([]);
  const [serviceOrders, setServiceOrders] = useState<ServiceOrder[]>([]);
  const [error, setError] = useState<string>();
  const load = () => {
    if (!props.tenantId) return;
    void props
      .api<{
        customer: Customer;
        contacts: CustomerContact[];
        interactions: CustomerInteraction[];
        serviceOrders: ServiceOrder[];
      }>(`/lab-services/customers/${customerId}`, { tenantId: props.tenantId })
      .then((value) => {
        setCustomer(value.customer);
        setContacts(value.contacts);
        setInteractions(value.interactions);
        setServiceOrders(value.serviceOrders);
      })
      .catch((reason) => setError(message(reason)));
  };
  useEffect(load, [props.tenantId, customerId]);
  async function action(name: "activate" | "hold" | "archive") {
    if (!props.tenantId) return;
    try {
      await props.api(`/lab-services/customers/${customerId}/${name}`, {
        method: "POST",
        tenantId: props.tenantId
      });
      load();
    } catch (reason) {
      setError(message(reason));
    }
  }
  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.tenantId) return;
    const data = new FormData(event.currentTarget);
    try {
      await props.api(`/lab-services/customers/${customerId}/contacts`, {
        method: "POST",
        tenantId: props.tenantId,
        body: {
          fullName: data.get("fullName"),
          email: String(data.get("email") || "").trim() || null,
          phone: null,
          roleTitle: String(data.get("roleTitle") || "").trim() || null,
          isPrimary: data.get("isPrimary") === "on"
        }
      });
      event.currentTarget.reset();
      load();
    } catch (reason) {
      setError(message(reason));
    }
  }
  async function contactAction(id: string, action: "archive" | "make-primary") {
    if (!props.tenantId) return;
    try {
      await props.api(`/lab-services/contacts/${id}/${action}`, {
        method: "POST",
        tenantId: props.tenantId
      });
      load();
    } catch (reason) {
      setError(message(reason));
    }
  }
  async function addInteraction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.tenantId) return;
    const data = new FormData(event.currentTarget);
    try {
      await props.api(`/lab-services/customers/${customerId}/interactions`, {
        method: "POST",
        tenantId: props.tenantId,
        body: {
          serviceOrderId: null,
          interactionType: data.get("interactionType"),
          occurredAt: new Date().toISOString(),
          summary: data.get("summary"),
          nextActionText: null,
          nextActionDate: null
        }
      });
      event.currentTarget.reset();
      load();
    } catch (reason) {
      setError(message(reason));
    }
  }
  if (!customer)
    return <main>{error ? <p role="alert">{error}</p> : <p>Loading Customer…</p>}</main>;
  const manageCustomer = allowed(props.modulePermissions ?? [], permissions.manageCustomer);
  return (
    <main aria-labelledby="customer-title">
      <Link to="/lab-services">← Lab Services</Link>
      <header className="nox-module-header">
        <div>
          <p className="nox-ai-context">
            {customer.status} · {customer.customerCode}
          </p>
          <h1 id="customer-title">{customer.displayName}</h1>
          <p>
            {customer.customerType} · {customer.legalName ?? "No legal name"}
          </p>
        </div>
        {manageCustomer ? (
          <div>
            <button type="button" onClick={() => void action("activate")}>
              Activate
            </button>
            <button type="button" onClick={() => void action("hold")}>
              Hold
            </button>
            <button
              type="button"
              className="nox-danger-action"
              onClick={() => window.confirm("Archive this Customer?") && void action("archive")}
            >
              Archive
            </button>
          </div>
        ) : null}
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <section>
        <h2>Contacts</h2>
        {allowed(props.modulePermissions ?? [], permissions.manageContact) &&
        customer.status !== "ARCHIVED" ? (
          <form className="nox-form-grid" onSubmit={(event) => void addContact(event)}>
            <label>
              Full name
              <input name="fullName" required />
            </label>
            <label>
              Email
              <input name="email" type="email" />
            </label>
            <label>
              Role
              <input name="roleTitle" />
            </label>
            <label>
              <input name="isPrimary" type="checkbox" /> Primary
            </label>
            <button type="submit">Add Contact</button>
          </form>
        ) : null}
        <div className="nox-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Primary</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((item) => (
                <tr key={item.id}>
                  <td>{item.fullName}</td>
                  <td>{item.email ?? "—"}</td>
                  <td>{item.roleTitle ?? "—"}</td>
                  <td>{item.status}</td>
                  <td>{item.isPrimary ? "PRIMARY" : "—"}</td>
                  <td>
                    {item.status === "ACTIVE" &&
                    allowed(props.modulePermissions ?? [], permissions.manageContact) ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void contactAction(item.id, "make-primary")}
                        >
                          Make primary
                        </button>
                        <button
                          type="button"
                          onClick={() => void contactAction(item.id, "archive")}
                        >
                          Archive
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>Service Orders</h2>
        <div className="nox-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Contact</th>
                <th>Scope summary</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {serviceOrders.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link to={`/lab-services/service-orders/${item.id}`}>{item.orderNumber}</Link>
                  </td>
                  <td>{item.contactFullName ?? "—"}</td>
                  <td>{item.intakeSummary}</td>
                  <td>{item.status}</td>
                  <td>{date(item.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {serviceOrders.length === 0 ? <p>No Service Orders recorded.</p> : null}
      </section>
      <section>
        <h2>Interaction timeline</h2>
        {allowed(props.modulePermissions ?? [], permissions.createInteraction) &&
        customer.status !== "ARCHIVED" ? (
          <form className="nox-form-grid" onSubmit={(event) => void addInteraction(event)}>
            <label>
              Type
              <select name="interactionType">
                <option>NOTE</option>
                <option>EMAIL</option>
                <option>CALL</option>
                <option>MEETING</option>
                <option>OTHER</option>
              </select>
            </label>
            <label>
              Summary
              <textarea name="summary" required />
            </label>
            <button type="submit">Record interaction</button>
          </form>
        ) : null}
        {interactions.length === 0 ? (
          <p>No interactions recorded.</p>
        ) : (
          <ol>
            {interactions.map((item) => (
              <li key={item.id}>
                <strong>{item.interactionType}</strong> · {date(item.occurredAt)}
                <p>{item.summary}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function ServiceOrderDetail(props: Props) {
  const { serviceOrderId = "" } = useParams();
  const [order, setOrder] = useState<ServiceOrder>();
  const [error, setError] = useState<string>();
  const load = () => {
    if (!props.tenantId) return;
    void props
      .api<{ serviceOrder: ServiceOrder }>(`/lab-services/service-orders/${serviceOrderId}`, {
        tenantId: props.tenantId
      })
      .then((value) => setOrder(value.serviceOrder))
      .catch((reason) => setError(message(reason)));
  };
  useEffect(load, [props.tenantId, serviceOrderId]);
  async function addLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!props.tenantId || !order) return;
    const data = new FormData(event.currentTarget);
    const next: Array<
      Pick<ServiceOrderLine, "lineOrder" | "serviceType" | "title" | "scopeDescription" | "notes">
    > = [
      ...order.lines.map(({ lineOrder, serviceType, title, scopeDescription, notes }) => ({
        lineOrder,
        serviceType,
        title,
        scopeDescription,
        notes
      })),
      {
        lineOrder: order.lines.length + 1,
        serviceType: data.get("serviceType") as ServiceOrderLine["serviceType"],
        title: String(data.get("title")),
        scopeDescription: String(data.get("scopeDescription")),
        notes: null
      }
    ];
    try {
      await props.api(`/lab-services/service-orders/${serviceOrderId}/lines`, {
        method: "PUT",
        tenantId: props.tenantId,
        body: { lines: next }
      });
      event.currentTarget.reset();
      load();
    } catch (reason) {
      setError(message(reason));
    }
  }
  async function action(name: "confirm" | "start" | "complete" | "cancel") {
    if (!props.tenantId) return;
    const reason =
      name === "cancel" && order?.status !== "DRAFT" ? window.prompt("Cancellation reason") : null;
    if (name === "cancel" && order?.status !== "DRAFT" && !reason) return;
    try {
      await props.api(`/lab-services/service-orders/${serviceOrderId}/${name}`, {
        method: "POST",
        tenantId: props.tenantId,
        body: name === "cancel" ? { reason } : undefined
      });
      load();
    } catch (cause) {
      setError(message(cause));
    }
  }
  if (!order)
    return <main>{error ? <p role="alert">{error}</p> : <p>Loading Service Order…</p>}</main>;
  const perms = props.modulePermissions ?? [];
  return (
    <main aria-labelledby="service-order-title">
      <Link to="/lab-services">← Lab Services</Link>
      <header className="nox-module-header">
        <div>
          <p className="nox-ai-context">{order.status}</p>
          <h1 id="service-order-title">{order.orderNumber}</h1>
          <p>
            {order.customerDisplayName} · {order.contactFullName ?? "No pinned Contact"}
          </p>
        </div>
        <div>
          {order.status === "DRAFT" && allowed(perms, permissions.confirmServiceOrder) ? (
            <button type="button" onClick={() => void action("confirm")}>
              Confirm scope
            </button>
          ) : null}
          {order.status === "CONFIRMED" && allowed(perms, permissions.startServiceOrder) ? (
            <button type="button" onClick={() => void action("start")}>
              Start engagement
            </button>
          ) : null}
          {order.status === "IN_PROGRESS" && allowed(perms, permissions.completeServiceOrder) ? (
            <button type="button" onClick={() => void action("complete")}>
              Complete
            </button>
          ) : null}
          {!["COMPLETED", "CANCELLED"].includes(order.status) &&
          allowed(perms, permissions.cancelServiceOrder) ? (
            <button
              type="button"
              className="nox-danger-action"
              onClick={() => void action("cancel")}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <section>
        <h2>Confirmed service scope</h2>
        <dl>
          <dt>Intake summary</dt>
          <dd>{order.intakeSummary}</dd>
          <dt>Requested completion</dt>
          <dd>{date(order.requestedCompletionDate)}</dd>
          <dt>Customer reference</dt>
          <dd>{order.customerExternalReference ?? "—"}</dd>
        </dl>
        <div className="nox-table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Service</th>
                <th>Title</th>
                <th>Scope</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((item) => (
                <tr key={item.id}>
                  <td>{item.lineOrder}</td>
                  <td>{item.serviceType}</td>
                  <td>{item.title}</td>
                  <td>{item.scopeDescription}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {order.status === "DRAFT" && allowed(perms, permissions.editServiceOrder) ? (
          <form className="nox-form-grid" onSubmit={(event) => void addLine(event)}>
            <label>
              Service type
              <select name="serviceType">
                <option>FORMULATION_RND</option>
                <option>TRIAL_EVALUATION</option>
                <option>TECHNICAL_CONSULTING</option>
                <option>PRODUCTION_SUPPORT</option>
                <option>OTHER</option>
              </select>
            </label>
            <label>
              Title
              <input name="title" required />
            </label>
            <label>
              Scope description
              <textarea name="scopeDescription" required />
            </label>
            <button type="submit">Add scope line</button>
          </form>
        ) : null}
      </section>
      {order.status !== "DRAFT" ? (
        <p className="nox-ai-context">
          Confirmed Customer, Contact, intake, and scope lines are immutable. Material scope changes
          require cancellation and replacement.
        </p>
      ) : null}
    </main>
  );
}

export function LabServicesExperience(props: Props) {
  if (!props.tenantId)
    return (
      <main>
        <h1>NØX Lab Services</h1>
        <p>Select a tenant workspace to continue.</p>
      </main>
    );
  if (!allowed(props.modulePermissions ?? [], permissions.read))
    return (
      <main>
        <h1>NØX Lab Services</h1>
        <p role="alert">Permission denied.</p>
      </main>
    );
  return (
    <Routes>
      <Route index element={<Registry {...props} />} />
      <Route path="customers/:customerId" element={<CustomerDetail {...props} />} />
      <Route path="service-orders/:serviceOrderId" element={<ServiceOrderDetail {...props} />} />
    </Routes>
  );
}
