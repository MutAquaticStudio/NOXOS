import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useWorkspaceObject,
  useUnsavedChanges,
  NoxDialog,
  NoxReadFeedback,
  type NoxReadState
} from "@nox-os/ui";
import { Link, Route, Routes, useParams } from "react-router-dom";
import type { ApiClient } from "./platform-control";
import { projectOperationsPermissions as permissions } from "../../../packages/project-operations/src/authorization";

type Props = { api: ApiClient; tenantId?: string; modulePermissions?: readonly string[] };
const commands = {
  activate: {
    title: "Activate Project",
    permission: permissions.activate,
    state: ["DRAFT"],
    effect: "Activate operational work. Required scope and work are checked by the server."
  },
  hold: {
    title: "Hold Project",
    permission: permissions.hold,
    state: ["ACTIVE"],
    effect: "Pause this Operational Project. Linked canonical artifacts remain unchanged."
  },
  resume: {
    title: "Resume Project",
    permission: permissions.resume,
    state: ["ON_HOLD"],
    effect: "Resume this Operational Project. Linked canonical artifacts remain unchanged."
  },
  complete: {
    title: "Complete Project",
    permission: permissions.completeProject,
    state: ["ACTIVE"],
    effect:
      "Request Project completion. This does not complete its Service Order or release a Batch."
  },
  cancel: {
    title: "Cancel Project",
    permission: permissions.cancelProject,
    state: ["DRAFT", "ACTIVE", "ON_HOLD"],
    effect: "Cancel this Operational Project. This does not cancel linked upstream records."
  },
  PROGRESS: {
    title: "Add progress",
    permission: permissions.createUpdate,
    state: [],
    effect: "Record an internal progress update. This does not change phase or task state."
  },
  BLOCKER: {
    title: "Add blocker",
    permission: permissions.createUpdate,
    state: [],
    effect: "Record an internal blocker. This does not put the Project on hold."
  },
  NOTE: {
    title: "Add note",
    permission: permissions.createUpdate,
    state: [],
    effect: "Record an internal note. No linked artifact is changed."
  }
} satisfies Record<string, { title: string; permission: string; state: string[]; effect: string }>;
type Command = keyof typeof commands;
const detailCollections = [
  "phases",
  "phaseState",
  "tasks",
  "dependencies",
  "links",
  "updates",
  "scope"
] as const;
function matchesProjectDetail(payload: any, projectId: string, tenantId?: string): boolean {
  return (
    payload?.project?.id === projectId &&
    payload.project.tenant_id === tenantId &&
    detailCollections.every((key) => Array.isArray(payload[key]))
  );
}
export function ProjectOperationsExperience({ api, tenantId, modulePermissions = [] }: Props) {
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
  if (!modulePermissions.includes(permissions.read))
    return (
      <section>
        <h1>Project Operations</h1>
        <p role="status">You do not have permission to read Operational Projects.</p>
      </section>
    );
  return (
    <Routes>
      <Route index element={<Registry api={scopedApi} />} />
      <Route
        path="projects/:projectId"
        element={
          <Detail
            key={tenantId}
            api={scopedApi}
            tenantId={tenantId}
            modulePermissions={modulePermissions}
          />
        }
      />
    </Routes>
  );
}
function Registry({ api }: Props) {
  const [projects, setProjects] = useState<any[]>([]);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [readState, setReadState] = useState<NoxReadState>("LOADING");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setReadState("LOADING");
    setProjects([]);
    void api<any>("/project-operations/projects")
      .then((x: any) => {
        if (!Array.isArray(x.projects)) throw new Error("Invalid registry response");
        if (!current) return;
        setProjects(x.projects);
        setReadState("READY");
      })
      .catch(() => {
        if (current) setReadState("ERROR");
      });
    return () => {
      current = false;
    };
  }, [api, reload]);
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
      <NoxReadFeedback
        state={readState}
        subject="Project Operations"
        retry={() => setReload((value) => value + 1)}
      />
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <caption className="sr-only">Operational Projects</caption>
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
      </div>
      {readState === "READY" && filtered.length === 0 && (
        <p>No Operational Projects match these filters.</p>
      )}
    </section>
  );
}
function Detail(props: Props) {
  const { projectId = "" } = useParams();
  return <ProjectDetail key={`${props.tenantId}:${projectId}`} {...props} projectId={projectId} />;
}
function ProjectDetail({
  api,
  tenantId,
  modulePermissions = [],
  projectId
}: Props & { projectId: string }) {
  const [data, setData] = useState<any>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  const [readState, setReadState] = useState<NoxReadState>("LOADING");
  const [reload, setReload] = useState(0);
  const [taskFilter, setTaskFilter] = useState("");
  const [taskQuery, setTaskQuery] = useState("");
  const [command, setCommand] = useState<{
    key: Command;
    version: string;
    idempotencyKey: string;
    expectedRevision?: string;
  }>();
  const [value, setValue] = useState("");
  const [discard, setDiscard] = useState(false);
  const [commandError, setCommandError] = useState<string>();
  const sending = useRef(false);
  const attempted = useRef(false);
  useUnsavedChanges(Boolean(command && (value || working)));
  const workspaceObject = useMemo(
    () =>
      !error && data?.project?.id === projectId
        ? {
            id: data.project.id,
            objectType: "OperationalProject",
            title: data.project.name,
            route: `/project-operations/projects/${data.project.id}`,
            properties: [
              { label: "Status", value: data.project.status },
              { label: "Type", value: data.project.project_type },
              {
                label: "Service order",
                value: data.project.source_service_order_id ?? "Not linked"
              }
            ]
          }
        : undefined,
    [data, projectId, error]
  );
  useWorkspaceObject(workspaceObject);
  useEffect(() => {
    let current = true;
    setData(undefined);
    setError(undefined);
    setReadState("LOADING");
    void api<any>(`/project-operations/projects/${projectId}`)
      .then((payload) => {
        if (!matchesProjectDetail(payload, projectId, tenantId))
          throw new Error("Project response does not match the requested context.");
        if (!current) return;
        setData(payload);
        setReadState("READY");
      })
      .catch(() => {
        if (current) setReadState("ERROR");
      });
    return () => {
      current = false;
    };
  }, [api, projectId, tenantId, reload]);
  if (
    readState !== "READY" ||
    data?.project?.id !== projectId ||
    data.project.tenant_id !== tenantId
  )
    return (
      <section>
        <Link to="/project-operations">← Project Operations</Link>
        <h1>Operational Project</h1>
        <NoxReadFeedback
          state={readState}
          subject="Operational Project"
          retry={() => setReload((value) => value + 1)}
        />
      </section>
    );
  const p = data.project;
  const taskById = new Map<string, any>(data.tasks.map((task: any) => [task.id, task]));
  const visibleTasks = data.tasks.filter(
    (task: any) =>
      (!taskFilter || task.status === taskFilter) &&
      (!taskQuery.trim() ||
        String(task.title).toLocaleLowerCase().includes(taskQuery.trim().toLocaleLowerCase()))
  );
  const stateByPhase = new Map<string, string>(
    data.phaseState.map((phase: any) => [
      phase.id,
      typeof phase.state === "string" ? phase.state : "State unavailable"
    ])
  );
  const scopeCoverage = new Map<string, any[]>();
  for (const task of data.tasks ?? []) {
    if (!task.source_service_order_line_id || !task.required) continue;
    const covered = scopeCoverage.get(task.source_service_order_line_id) ?? [];
    covered.push(task);
    scopeCoverage.set(task.source_service_order_line_id, covered);
  }
  const refresh = async () => {
    const payload = await api<any>(`/project-operations/projects/${projectId}`);
    if (!matchesProjectDetail(payload, projectId, tenantId))
      throw new Error("Project response does not match the requested context.");
    setData(payload);
  };
  const version = JSON.stringify([p.status, p.updated_at, p.revision]);
  const openCommand = (key: Command) => {
    setValue("");
    setCommandError(undefined);
    setDiscard(false);
    attempted.current = false;
    setCommand({ key, version, idempotencyKey: crypto.randomUUID(), expectedRevision: p.revision });
  };
  const lifecycle = openCommand;
  const addUpdate = openCommand;
  const selected = command && commands[command.key];
  const update = command && ["PROGRESS", "BLOCKER", "NOTE"].includes(command.key);
  const needsText = update || command?.key === "hold" || command?.key === "cancel";
  const guarded = update || command?.key === "hold" || command?.key === "resume";
  const stale = Boolean(
    command &&
    (command.version !== version ||
      (guarded && typeof command.expectedRevision !== "string") ||
      !selected ||
      !modulePermissions.includes(selected.permission) ||
      (selected.state.length && !(selected.state as string[]).includes(p.status)))
  );
  const closeCommand = () => {
    if (sending.current) return;
    if (value) setDiscard(true);
    else setCommand(undefined);
  };
  return (
    <section>
      {command && selected ? (
        <NoxDialog title={selected.title} onClose={closeCommand}>
          <form
            className="nox-commercial-dialog"
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                sending.current ||
                attempted.current ||
                discard ||
                stale ||
                (needsText && !value.trim())
              )
                return;
              sending.current = true;
              attempted.current = true;
              setWorking(true);
              let saved = false;
              const guard = guarded
                ? {
                    idempotencyKey: command.idempotencyKey,
                    expectedRevision: command.expectedRevision
                  }
                : {};
              try {
                await api(
                  `/project-operations/projects/${projectId}/${update ? "updates" : command.key}`,
                  {
                    method: "POST",
                    body: update
                      ? {
                          updateType: command.key,
                          summary: value.trim(),
                          phasePlanId: null,
                          taskId: null,
                          resolvesUpdateId: null,
                          ...guard
                        }
                      : needsText
                        ? { reason: value.trim(), ...guard }
                        : guarded
                          ? guard
                          : undefined
                  }
                );
                saved = true;
                await refresh();
                setCommand(undefined);
                setValue("");
              } catch {
                setCommandError(
                  saved
                    ? "The server accepted the change, but the refreshed Project could not be loaded. Do not submit it again."
                    : "The request could not be confirmed. It may have reached the server. Review current data before any further action; this form will not resend it."
                );
              } finally {
                sending.current = false;
                setWorking(false);
              }
            }}
          >
            <p>
              {p.project_code} · {p.name} · {p.status}
            </p>
            <p>{selected.effect}</p>
            <p>The server remains authoritative for permission and state checks.</p>
            {needsText ? (
              <div>
                <label htmlFor="project-command-text">{update ? "Update summary" : "Reason"}</label>
                <textarea
                  id="project-command-text"
                  rows={4}
                  style={{ width: "100%", boxSizing: "border-box" }}
                  required
                  maxLength={update ? 4000 : 2000}
                  value={value}
                  disabled={working || attempted.current}
                  onChange={(event) => setValue(event.target.value)}
                />
              </div>
            ) : null}
            {stale ? (
              <p role="alert">State or permission changed. Close and review the current Project.</p>
            ) : null}
            {commandError ? (
              <div role="alert">
                <p>{commandError}</p>
                <button
                  type="button"
                  disabled={working}
                  onClick={async () => {
                    if (sending.current) return;
                    sending.current = true;
                    setWorking(true);
                    try {
                      await refresh();
                    } catch {
                      setCommandError(
                        "Current data could not be loaded. No additional mutation was sent."
                      );
                    } finally {
                      sending.current = false;
                      setWorking(false);
                    }
                  }}
                >
                  Reload current data only
                </button>
              </div>
            ) : null}
            {discard ? (
              <div key="discard" role="alert">
                <p>Discard this form? Any request already sent is not undone.</p>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    setDiscard(false);
                  }}
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCommand(undefined);
                    setValue("");
                  }}
                >
                  Discard form
                </button>
              </div>
            ) : (
              <div key="actions" className="nox-table-actions">
                <button type="button" disabled={working} onClick={closeCommand}>
                  Back without submitting
                </button>
                <button
                  type="submit"
                  disabled={
                    working || attempted.current || stale || Boolean(needsText && !value.trim())
                  }
                >
                  {working ? "Working…" : `Confirm ${selected.title}`}
                </button>
              </div>
            )}
          </form>
        </NoxDialog>
      ) : null}
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
      <NoxReadFeedback
        state={readState}
        subject="Operational Project"
        disabled={working}
        retry={() => setReload((value) => value + 1)}
      />
      <p>
        {p.status === "DRAFT" && modulePermissions.includes(permissions.activate) ? (
          <button disabled={working} onClick={() => lifecycle("activate")}>
            Activate
          </button>
        ) : null}{" "}
        {p.status === "ACTIVE" && modulePermissions.includes(permissions.hold) ? (
          <button disabled={working} onClick={() => lifecycle("hold")}>
            Hold
          </button>
        ) : null}{" "}
        {p.status === "ON_HOLD" && modulePermissions.includes(permissions.resume) ? (
          <button disabled={working} onClick={() => lifecycle("resume")}>
            Resume
          </button>
        ) : null}{" "}
        {p.status === "ACTIVE" && modulePermissions.includes(permissions.completeProject) ? (
          <button disabled={working} onClick={() => lifecycle("complete")}>
            Complete
          </button>
        ) : null}{" "}
        {["DRAFT", "ACTIVE", "ON_HOLD"].includes(p.status) &&
        modulePermissions.includes(permissions.cancelProject) ? (
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
      {data.phases.length === 0 ? <p>No phase plan has been recorded.</p> : null}
      <p>Phase state is derived by G12 from linked canonical artifacts, not edited here.</p>
      <div className="nox-table-wrap" tabIndex={0} role="region" aria-label="Derived phase plan">
        <table>
          <caption className="sr-only">Derived phase plan</caption>
          <thead>
            <tr>
              <th scope="col">Phase</th>
              <th scope="col">Canonical state</th>
              <th scope="col">Required</th>
              <th scope="col">Owner</th>
              <th scope="col">Planned start</th>
              <th scope="col">Planned due</th>
            </tr>
          </thead>
          <tbody>
            {(data.phases ?? []).map((x: any) => (
              <tr key={x.id}>
                <th scope="row">{x.phase_key}</th>
                <td>{stateByPhase.get(x.id) ?? "State unavailable"}</td>
                <td>
                  {typeof x.required === "boolean"
                    ? x.required
                      ? "Required"
                      : "Optional"
                    : "Unavailable"}
                </td>
                <td>{x.owner_display_name ?? x.owner_user_id ?? "Unassigned"}</td>
                <td>{x.planned_start_date ?? "Not scheduled"}</td>
                <td>{x.planned_due_date ?? "Not scheduled"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Tasks & Milestones</h2>
      <fieldset className="nox-inline-form">
        <legend>Task filters</legend>
        <label>
          Find task
          <input
            type="search"
            value={taskQuery}
            onChange={(event) => setTaskQuery(event.target.value)}
          />
        </label>
        <div>
          <label htmlFor="project-task-status">Task status</label>
          <select
            id="project-task-status"
            value={taskFilter}
            onChange={(event) => setTaskFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {["TODO", "IN_PROGRESS", "DONE", "CANCELLED"].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </div>
        {taskQuery || taskFilter ? (
          <button
            onClick={() => {
              setTaskQuery("");
              setTaskFilter("");
            }}
          >
            Clear task filters
          </button>
        ) : null}
      </fieldset>
      <p role="status">
        {visibleTasks.length} of {data.tasks.length} tasks and milestones shown.
      </p>
      {data.tasks.length === 0 ? <p>No tasks or milestones have been recorded.</p> : null}
      {data.tasks.length > 0 && visibleTasks.length === 0 ? (
        <p>No tasks match these filters.</p>
      ) : null}
      <div className="nox-table-wrap" tabIndex={0} role="region" aria-label="Tasks and milestones">
        <table>
          <caption className="sr-only">Tasks and milestones</caption>
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
              <th scope="col">Required</th>
              <th scope="col">Assignee</th>
              <th scope="col">Due</th>
            </tr>
          </thead>
          <tbody>
            {visibleTasks.map((x: any) => (
              <tr key={x.id}>
                <th scope="row">{x.title}</th>
                <td>{x.task_kind}</td>
                <td>{x.status}</td>
                <td>
                  {typeof x.required === "boolean"
                    ? x.required
                      ? "Required"
                      : "Optional"
                    : "Unavailable"}
                </td>
                <td>{x.assignee_display_name ?? x.assignee_user_id ?? "Unassigned"}</td>
                <td>{x.due_date ?? "Not scheduled"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(data.dependencies ?? []).length ? (
        <section aria-labelledby="project-dependencies-heading">
          <h3 id="project-dependencies-heading">Finish-to-start dependencies</h3>
          <ul>
            {data.dependencies.map((dependency: any) => (
              <li key={dependency.id}>
                {taskById.get(dependency.predecessor_task_id)?.title ??
                  dependency.predecessor_task_id}{" "}
                →{" "}
                {taskById.get(dependency.successor_task_id)?.title ?? dependency.successor_task_id}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <h2>Artifact Lineage</h2>
      {data.links.length === 0 ? <p>No canonical artifacts are linked to this Project.</p> : null}
      <div className="nox-table-wrap" tabIndex={0} role="region" aria-label="Artifact lineage">
        <table>
          <caption className="sr-only">Artifact lineage</caption>
          <thead>
            <tr>
              <th scope="col">Artifact type</th>
              <th scope="col">Exact artifact ID</th>
              <th scope="col">Relationship</th>
              <th scope="col">Link state</th>
              <th scope="col">Revocation reason</th>
            </tr>
          </thead>
          <tbody>
            {data.links.map((x: any) => (
              <tr key={x.id}>
                <th scope="row">{x.artifact_type}</th>
                <td>
                  <code>{x.artifact_id}</code>
                </td>
                <td>{x.relationship}</td>
                <td>{x.status}</td>
                <td>{x.revocation_reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Internal Updates</h2>
      {data.updates.length === 0 ? <p>No internal updates have been recorded.</p> : null}
      {modulePermissions.includes(permissions.createUpdate) ? (
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
      ) : (
        <p>Internal updates are read-only with your current permissions.</p>
      )}
      <ol aria-label="Internal update timeline">
        {(data.updates ?? []).map((x: any) => (
          <li key={x.id}>
            <p>
              {x.update_type}: {x.summary}
            </p>
            <p>
              {x.created_at && Number.isFinite(new Date(x.created_at).getTime()) ? (
                <time dateTime={x.created_at}>
                  {new Date(x.created_at).toLocaleString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZoneName: "short"
                  })}
                </time>
              ) : (
                "Timestamp unavailable"
              )}
              {" · "}Actor: {x.created_by_user_id ?? "Unavailable"}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
