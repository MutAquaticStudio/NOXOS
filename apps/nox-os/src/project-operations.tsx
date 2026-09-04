import { useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import type { ApiClient } from "./platform-control";

type Props = { api: ApiClient };
export function ProjectOperationsExperience({ api }: Props) {
  return (
    <Routes>
      <Route index element={<Registry api={api} />} />
      <Route path="projects/:projectId" element={<Detail api={api} />} />
    </Routes>
  );
}
function Registry({ api }: Props) {
  const [projects, setProjects] = useState<any[]>([]);
  useEffect(() => {
    void api<any>("/project-operations/projects")
      .then((x: any) => setProjects(x.projects ?? []))
      .catch(() => setProjects([]));
  }, [api]);
  return (
    <section>
      <p className="nox-ai-context">OPERATIONS</p>
      <h1>Project Operations</h1>
      <p>
        Operational Projects are distinct from Design Studio Projects. Customer and Service Order
        truth remains in NØX Lab Services.
      </p>
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>Type</th>
            <th>Status</th>
            <th>Required work</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>
                <Link to={`/project-operations/projects/${p.id}`}>
                  {p.project_code} · {p.name}
                </Link>
              </td>
              <td>{p.project_type}</td>
              <td>{p.status}</td>
              <td>
                {p.completed_required_task_count}/{p.required_task_count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {projects.length === 0 && <p>No Operational Projects found.</p>}
    </section>
  );
}
function Detail({ api }: Props) {
  const { projectId = "" } = useParams();
  const [data, setData] = useState<any>();
  useEffect(() => {
    void api<any>(`/project-operations/projects/${projectId}`)
      .then(setData)
      .catch(() => setData(undefined));
  }, [api, projectId]);
  if (!data) return <p>Loading Operational Project…</p>;
  const p = data.project;
  return (
    <section>
      <Link to="/project-operations">← Project Operations</Link>
      <p className="nox-ai-context">OPERATIONAL PROJECT</p>
      <h1>
        {p.project_code} · {p.name}
      </h1>
      <p>
        {p.status} · {p.project_type}
      </p>
      <h2>Phase Plan</h2>
      <ul>
        {(data.phases ?? []).map((x: any) => (
          <li key={x.id}>
            {x.phase_key} · planned {x.planned_due_date ?? "—"}
          </li>
        ))}
      </ul>
      <h2>Tasks & Milestones</h2>
      <ul>
        {(data.tasks ?? []).map((x: any) => (
          <li key={x.id}>
            {x.title} · {x.status}
          </li>
        ))}
      </ul>
      <h2>Artifact Lineage</h2>
      <ul>
        {(data.links ?? []).map((x: any) => (
          <li key={x.id}>
            {x.artifact_type} · {x.relationship} · {x.status}
          </li>
        ))}
      </ul>
      <h2>Internal Updates</h2>
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
