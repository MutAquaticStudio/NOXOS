import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import type { ApiClient } from "./platform-control";

type Props = { api: ApiClient; tenantId?: string };
export function ProjectOperationsExperience({ api, tenantId }: Props) {
  // Project Operations is entirely tenant-scoped. Bind the currently resolved
  // G2 tenant context once so no route can accidentally omit the authority
  // header; the server remains the final authority for every request.
  const scopedApi = useCallback<ApiClient>(
    (path, options = {}) => {
      if (!tenantId) return Promise.reject(new Error("An active tenant is required."));
      return api(path, { ...options, tenantId });
    },
    [api, tenantId]
  );
  return (
    <Routes>
      <Route index element={<Registry api={scopedApi} />} />
      <Route path="projects/:projectId" element={<Detail api={scopedApi} />} />
    </Routes>
  );
}
function Registry({ api }: Props) {
  const [projects, setProjects] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string>();
  useEffect(() => {
    void api<any>("/project-operations/projects")
      .then((x: any) => {
        setProjects(x.projects ?? []);
        setError(undefined);
      })
      .catch(() => {
        setProjects([]);
        setError("Project Registry could not be loaded.");
      });
  }, [api]);
  const filtered = useMemo(
    () =>
      projects.filter(
        (project) =>
          (!status || project.status === status) &&
          (!type || project.project_type === type) &&
          (!due ||
            (due === "SCHEDULED" && Boolean(project.target_completion_date)) ||
            (due === "UNSCHEDULED" && !project.target_completion_date) ||
            (due === "OVERDUE" &&
              Boolean(project.target_completion_date) &&
              new Date(`${project.target_completion_date}T23:59:59Z`).getTime() < Date.now() &&
              !["COMPLETED", "CANCELLED"].includes(project.status))) &&
          (!owner ||
            String(project.owner_display_name ?? project.owner_user_id)
              .toLocaleLowerCase()
              .includes(owner.toLocaleLowerCase()))
      ),
    [due, owner, projects, status, type]
  );
  return (
    <section>
      <p className="nox-ai-context">OPERATIONS</p>
      <h1>Project Operations</h1>
      <p>
        Operational Projects are distinct from Design Studio Projects. Customer and Service Order
        truth remains in NØX Lab Services.
      </p>
      <fieldset>
        <legend>Filter Project Registry</legend>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option>
            {["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          Type
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All</option>
            <option>CLIENT_SERVICE</option>
            <option>INTERNAL</option>
          </select>
        </label>{" "}
        <label>
          Owner
          <input value={owner} onChange={(event) => setOwner(event.target.value)} />
        </label>{" "}
        <label>
          Due state
          <select value={due} onChange={(event) => setDue(event.target.value)}>
            <option value="">All</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="OVERDUE">Overdue</option>
            <option value="UNSCHEDULED">Unscheduled</option>
          </select>
        </label>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Type</th>
            <th>Source Service Order</th>
            <th>Customer</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Required work</th>
            <th>Required phases</th>
            <th>Target completion</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id}>
              <td>
                <Link to={`/project-operations/projects/${p.id}`}>
                  {p.project_code} · {p.name}
                </Link>
              </td>
              <td>{p.project_type}</td>
              <td>{p.source_service_order_number ?? "—"}</td>
              <td>{p.source_customer_display_name ?? "—"}</td>
              <td>{p.owner_display_name ?? p.owner_user_id}</td>
              <td>{p.status}</td>
              <td>
                {p.completed_required_task_count}/{p.required_task_count}
              </td>
              <td>{p.required_phase_count}</td>
              <td>{p.target_completion_date ?? "—"}</td>
              <td>{p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 && <p>No Operational Projects match these filters.</p>}
    </section>
  );
}
function Detail({ api }: Props) {
  const { projectId = "" } = useParams();
  const [data, setData] = useState<any>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  useEffect(() => {
    void api<any>(`/project-operations/projects/${projectId}`)
      .then((payload) => {
        setData(payload);
        setError(undefined);
      })
      .catch(() => {
        setData(undefined);
        setError("Operational Project was not found or is no longer available.");
      });
  }, [api, projectId]);
  if (!data) return error ? <p role="alert">{error}</p> : <p>Loading Operational Project…</p>;
  const p = data.project;
  const stateByPhase = new Map(
    (data.phaseState ?? []).map((phase: any) => [phase.id, phase.state])
  );
  const scopeCoverage = new Map<string, any[]>();
  for (const task of data.tasks ?? []) {
    if (!task.source_service_order_line_id || !task.required) continue;
    const covered = scopeCoverage.get(task.source_service_order_line_id) ?? [];
    covered.push(task);
    scopeCoverage.set(task.source_service_order_line_id, covered);
  }
  const refresh = () => api<any>(`/project-operations/projects/${projectId}`).then(setData);
  const lifecycle = (action: "activate" | "hold" | "resume" | "complete" | "cancel") => {
    const reason =
      action === "hold" || action === "cancel"
        ? window.prompt(`${action === "hold" ? "Hold" : "Cancellation"} reason`)
        : undefined;
    if ((action === "hold" || action === "cancel") && !reason) return;
    setWorking(true);
    void api(`/project-operations/projects/${projectId}/${action}`, {
      method: "POST",
      body: reason ? { reason } : undefined
    })
      .then(refresh)
      .catch(() => setError(`Project could not be ${action}d.`))
      .finally(() => setWorking(false));
  };
  const addUpdate = (updateType: "PROGRESS" | "BLOCKER" | "NOTE") => {
    const summary = window.prompt(`${updateType} update`);
    if (!summary?.trim()) return;
    setWorking(true);
    void api(`/project-operations/projects/${projectId}/updates`, {
      method: "POST",
      body: { updateType, summary, phasePlanId: null, taskId: null, resolvesUpdateId: null }
    })
      .then(refresh)
      .catch(() => setError("Project update could not be recorded."))
      .finally(() => setWorking(false));
  };
  return (
    <section>
      <Link to="/project-operations">← Project Operations</Link>
      <p className="nox-ai-context">OPERATIONAL PROJECT</p>
      <h1>
        {p.project_code} · {p.name}
      </h1>
      <p>
        {p.status} · {p.project_type} · Priority {p.priority}
      </p>
      <p>
        Owner: {p.owner_display_name ?? p.owner_user_id} · Target: {p.target_start_date ?? "—"} →{" "}
        {p.target_completion_date ?? "—"}
      </p>
      <p aria-live="polite">{error}</p>
      <p>
        {p.status === "DRAFT" ? (
          <button disabled={working} onClick={() => lifecycle("activate")}>
            Activate
          </button>
        ) : null}{" "}
        {p.status === "ACTIVE" ? (
          <button disabled={working} onClick={() => lifecycle("hold")}>
            Hold
          </button>
        ) : null}{" "}
        {p.status === "ON_HOLD" ? (
          <button disabled={working} onClick={() => lifecycle("resume")}>
            Resume
          </button>
        ) : null}{" "}
        {p.status === "ACTIVE" ? (
          <button disabled={working} onClick={() => lifecycle("complete")}>
            Complete
          </button>
        ) : null}{" "}
        {!["COMPLETED", "CANCELLED"].includes(p.status) ? (
          <button disabled={working} onClick={() => lifecycle("cancel")}>
            Cancel
          </button>
        ) : null}
      </p>
      <section aria-labelledby="project-scope-heading">
        <h2 id="project-scope-heading">Scope</h2>
        {p.source_service_order_id ? (
          <p>
            Source Service Order {p.source_service_order_number ?? p.source_service_order_id} ·{" "}
            {p.source_customer_display_name ?? "Customer unavailable"} ·{" "}
            {p.source_service_order_status}
          </p>
        ) : (
          <p>Internal operational work. No Customer or Service Order truth is copied here.</p>
        )}
        {(data.scope ?? []).length ? (
          <ul>
            {data.scope.map((line: any) => (
              <li key={line.id}>
                {line.line_order}. {line.title} · {line.service_type} ·{" "}
                {(scopeCoverage.get(line.id) ?? []).length
                  ? "required work linked"
                  : "work not yet linked"}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <h2>Phase Plan</h2>
      <ul aria-label="Derived phase plan">
        {(data.phases ?? []).map((x: any) => (
          <li key={x.id}>
            {x.phase_key} · {stateByPhase.get(x.id) ?? "NOT_STARTED"} · owner{" "}
            {x.owner_display_name ?? "—"} · planned {x.planned_due_date ?? "—"}
          </li>
        ))}
      </ul>
      <h2>Tasks & Milestones</h2>
      <ul aria-label="Tasks and milestones">
        {(data.tasks ?? []).map((x: any) => (
          <li key={x.id}>
            {x.task_kind} · {x.title} · {x.status} · assignee {x.assignee_display_name ?? "—"} · due{" "}
            {x.due_date ?? "—"}
          </li>
        ))}
      </ul>
      {(data.dependencies ?? []).length ? (
        <section aria-labelledby="project-dependencies-heading">
          <h3 id="project-dependencies-heading">Finish-to-start dependencies</h3>
          <ul>
            {data.dependencies.map((dependency: any) => (
              <li key={dependency.id}>
                {dependency.predecessor_task_id} → {dependency.successor_task_id}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <h2>Artifact Lineage</h2>
      <ul>
        {(data.links ?? []).map((x: any) => (
          <li key={x.id}>
            {x.artifact_type} · {x.relationship} · {x.status}
          </li>
        ))}
      </ul>
      <h2>Internal Updates</h2>
      <p>
        <button disabled={working} onClick={() => addUpdate("PROGRESS")}>
          Add progress
        </button>{" "}
        <button disabled={working} onClick={() => addUpdate("BLOCKER")}>
          Add blocker
        </button>{" "}
        <button disabled={working} onClick={() => addUpdate("NOTE")}>
          Add note
        </button>
      </p>
      <ul>
        {(data.updates ?? []).map((x: any) => (
          <li key={x.id}>
            {x.update_type}: {x.summary}
          </li>
        ))}
      </ul>
    </section>
  );
}
