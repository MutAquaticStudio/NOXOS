import type { ProjectOperationsStore } from "./persistence.js";
import type { ProjectCommandContext } from "./contracts.js";
export class ProjectOperationsApplication {
  constructor(readonly store: ProjectOperationsStore) {}
  listProjects(t: string) {
    return this.store.listProjects(t);
  }
  findProject(t: string, id: string) {
    return this.store.findProject(t, id);
  }
  createProject(c: ProjectCommandContext, x: Record<string, unknown>) {
    return this.store.createProject({ ...c, ...x });
  }
  updateProject(c: ProjectCommandContext, id: string, changes: Record<string, unknown>) {
    return this.store.updateProject({ ...c, projectId: id, changes });
  }
  activate(c: ProjectCommandContext, id: string) {
    return this.store.activateProject({ ...c, projectId: id });
  }
  hold(c: ProjectCommandContext, id: string, reason: string) {
    return this.store.holdProject({ ...c, projectId: id, reason });
  }
  resume(c: ProjectCommandContext, id: string) {
    return this.store.resumeProject({ ...c, projectId: id });
  }
  complete(c: ProjectCommandContext, id: string) {
    return this.store.completeProject({ ...c, projectId: id });
  }
  cancel(c: ProjectCommandContext, id: string, reason?: string) {
    return this.store.cancelProject({ ...c, projectId: id, reason });
  }
}
