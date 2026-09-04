import type {
  ProjectArtifactSource,
  ProjectCommandContext,
  ProjectOperationsCommercialProjection
} from "./contracts.js";
export interface ProjectOperationsSource {
  findProjectForCommercial(input: {
    tenantId: string;
    projectId: string;
  }): Promise<ProjectOperationsCommercialProjection | undefined>;
}
export interface ProjectOperationsStore extends ProjectOperationsSource, ProjectArtifactSource {
  listProjects(tenantId: string): Promise<unknown[]>;
  findProject(tenantId: string, projectId: string): Promise<Record<string, unknown> | undefined>;
  createProject(input: ProjectCommandContext & Record<string, unknown>): Promise<unknown>;
  updateProject(
    input: ProjectCommandContext & { projectId: string; changes: Record<string, unknown> }
  ): Promise<unknown>;
  activateProject(input: ProjectCommandContext & { projectId: string }): Promise<unknown>;
  holdProject(
    input: ProjectCommandContext & { projectId: string; reason: string }
  ): Promise<unknown>;
  resumeProject(input: ProjectCommandContext & { projectId: string }): Promise<unknown>;
  completeProject(input: ProjectCommandContext & { projectId: string }): Promise<unknown>;
  cancelProject(
    input: ProjectCommandContext & { projectId: string; reason?: string }
  ): Promise<unknown>;
  replacePhasePlans(
    input: ProjectCommandContext & { projectId: string; phases: unknown[] }
  ): Promise<unknown[]>;
  createTask(
    input: ProjectCommandContext & { projectId: string } & Record<string, unknown>
  ): Promise<unknown>;
  updateTask(
    input: ProjectCommandContext & { taskId: string; changes: Record<string, unknown> }
  ): Promise<unknown>;
  startTask(input: ProjectCommandContext & { taskId: string }): Promise<unknown>;
  completeTask(input: ProjectCommandContext & { taskId: string }): Promise<unknown>;
  cancelTask(input: ProjectCommandContext & { taskId: string; reason?: string }): Promise<unknown>;
  createDependency(
    input: ProjectCommandContext & { successorTaskId: string; predecessorTaskId: string }
  ): Promise<unknown>;
  removeDependency(
    input: ProjectCommandContext & { taskId: string; dependencyId: string }
  ): Promise<void>;
  createArtifactLink(
    input: ProjectCommandContext & { projectId: string } & Record<string, unknown>
  ): Promise<unknown>;
  revokeArtifactLink(
    input: ProjectCommandContext & { linkId: string; reason: string }
  ): Promise<unknown>;
  promotePrimary(input: ProjectCommandContext & { linkId: string }): Promise<unknown>;
  createUpdate(
    input: ProjectCommandContext & { projectId: string } & Record<string, unknown>
  ): Promise<unknown>;
  phaseState(tenantId: string, projectId: string): Promise<unknown[]>;
  timeline(tenantId: string, projectId: string): Promise<unknown[]>;
}
