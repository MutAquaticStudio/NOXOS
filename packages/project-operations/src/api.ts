import { z } from "zod";
import type {
  ApiRequest,
  ApiResponse,
  ApiRouteRegistrar,
  ModuleDefinition,
  TenantRequestContext
} from "@nox-os/contracts";
import type { FeatureFlagResolver } from "@nox-os/module-registry";
import { ProjectOperationsApplication } from "./application.js";
import { projectOperationsPermissions } from "./authorization.js";
import {
  createArtifactLinkSchema,
  createDependencySchema,
  createProjectSchema,
  createTaskSchema,
  createUpdateSchema,
  phasePlansSchema,
  projectUuidSchema,
  reasonSchema,
  updateProjectSchema,
  updateTaskSchema
} from "./contracts.js";
import { ProjectOperationsProblem } from "./problem.js";

const moduleId = "project-operations",
  entitlement = "module.project-operations";
type Permission = (typeof projectOperationsPermissions)[keyof typeof projectOperationsPermissions];
export type ProjectOperationsApiOptions = {
  application: ProjectOperationsApplication;
  authorization: { tenantContext(request: ApiRequest): Promise<TenantRequestContext> };
  definitions: readonly ModuleDefinition[];
  featureFlags: FeatureFlagResolver;
};
const id = (request: ApiRequest, name: string) => {
  const parsed = projectUuidSchema.safeParse(request.params?.[name]);
  if (!parsed.success)
    throw new ProjectOperationsProblem(404, "PROJECT_NOT_FOUND", "Route identity is invalid.");
  return parsed.data;
};
const ctx = (c: TenantRequestContext, r: ApiRequest) => ({
  tenantId: c.tenant.tenantId,
  actorUserId: c.actor.userId,
  requestId: r.context.requestId,
  correlationId: r.context.correlationId
});

export class ProjectOperationsApi {
  constructor(private readonly options: ProjectOperationsApiOptions) {}
  registerRoutes(registrar: ApiRouteRegistrar): void {
    registrar.get(
      "/project-operations/projects",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.read);
        return {
          status: 200,
          body: { projects: await this.options.application.listProjects(c.tenant.tenantId) }
        };
      })
    );
    registrar.register(
      "POST",
      "/project-operations/projects",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.createProject);
        const p = await this.options.application.createProject(
          ctx(c, r),
          createProjectSchema.parse(r.body)
        );
        return { status: 201, body: { project: p } };
      })
    );
    registrar.get(
      "/project-operations/projects/:projectId",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.read);
        const p = await this.options.application.findProject(c.tenant.tenantId, id(r, "projectId"));
        if (!p)
          throw new ProjectOperationsProblem(
            404,
            "PROJECT_NOT_FOUND",
            "Operational Project was not found."
          );
        // `findProject` already returns the project workspace envelope
        // ({ project, phases, tasks, links, updates, ... }). Keep its root shape
        // stable for the route-based detail experience rather than nesting it.
        return { status: 200, body: p };
      })
    );
    registrar.register(
      "PUT",
      "/project-operations/projects/:projectId",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.editProject);
        return {
          status: 200,
          body: {
            project: await this.options.application.updateProject(
              ctx(c, r),
              id(r, "projectId"),
              updateProjectSchema.parse(r.body)
            )
          }
        };
      })
    );
    for (const [action, permission] of [
      ["activate", projectOperationsPermissions.activate],
      ["hold", projectOperationsPermissions.hold],
      ["resume", projectOperationsPermissions.resume],
      ["complete", projectOperationsPermissions.completeProject],
      ["cancel", projectOperationsPermissions.cancelProject]
    ] as const)
      registrar.register(
        "POST",
        `/project-operations/projects/:projectId/${action}`,
        this.handle(async (r) => {
          const c = await this.tenant(r, permission);
          const projectId = id(r, "projectId");
          const input = ctx(c, r);
          const value =
            action === "activate"
              ? await this.options.application.activate(input, projectId)
              : action === "hold"
                ? await this.options.application.hold(
                    input,
                    projectId,
                    reasonSchema.parse(r.body).reason
                  )
                : action === "resume"
                  ? await this.options.application.resume(input, projectId)
                  : action === "complete"
                    ? await this.options.application.complete(input, projectId)
                    : await this.options.application.cancel(
                        input,
                        projectId,
                        reasonSchema.parse(r.body).reason
                      );
          return { status: 200, body: { project: value } };
        })
      );
    registrar.register(
      "PUT",
      "/project-operations/projects/:projectId/phases",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.managePhase);
        const phases = phasePlansSchema.parse(r.body).phases;
        return {
          status: 200,
          body: {
            phases: await this.options.application.store.replacePhasePlans({
              ...ctx(c, r),
              projectId: id(r, "projectId"),
              phases
            })
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/project-operations/projects/:projectId/tasks",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.createTask);
        const task = await this.options.application.store.createTask({
          ...ctx(c, r),
          projectId: id(r, "projectId"),
          ...createTaskSchema.parse(r.body)
        });
        return { status: 201, body: { task } };
      })
    );
    registrar.register(
      "PUT",
      "/project-operations/tasks/:taskId",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.editTask);
        return {
          status: 200,
          body: {
            task: await this.options.application.store.updateTask({
              ...ctx(c, r),
              taskId: id(r, "taskId"),
              changes: updateTaskSchema.parse(r.body)
            })
          }
        };
      })
    );
    for (const [action, permission] of [
      ["start", projectOperationsPermissions.startTask],
      ["complete", projectOperationsPermissions.completeTask],
      ["cancel", projectOperationsPermissions.cancelTask]
    ] as const)
      registrar.register(
        "POST",
        `/project-operations/tasks/:taskId/${action}`,
        this.handle(async (r) => {
          const c = await this.tenant(r, permission);
          const taskId = id(r, "taskId");
          const input = ctx(c, r);
          const task =
            action === "start"
              ? await this.options.application.store.startTask({ ...input, taskId })
              : action === "complete"
                ? await this.options.application.store.completeTask({ ...input, taskId })
                : await this.options.application.store.cancelTask({
                    ...input,
                    taskId,
                    reason: reasonSchema.parse(r.body).reason
                  });
          return { status: 200, body: { task } };
        })
      );
    registrar.register(
      "POST",
      "/project-operations/tasks/:taskId/dependencies",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.manageDependency);
        const dependency = await this.options.application.store.createDependency({
          ...ctx(c, r),
          successorTaskId: id(r, "taskId"),
          ...createDependencySchema.parse(r.body)
        });
        return { status: 201, body: { dependency } };
      })
    );
    registrar.register(
      "DELETE",
      "/project-operations/tasks/:taskId/dependencies/:dependencyId",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.manageDependency);
        await this.options.application.store.removeDependency({
          ...ctx(c, r),
          taskId: id(r, "taskId"),
          dependencyId: id(r, "dependencyId")
        });
        return { status: 204, body: null };
      })
    );
    registrar.register(
      "POST",
      "/project-operations/projects/:projectId/artifacts",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.manageArtifact);
        const link = await this.options.application.store.createArtifactLink({
          ...ctx(c, r),
          projectId: id(r, "projectId"),
          ...createArtifactLinkSchema.parse(r.body)
        });
        return { status: 201, body: { link } };
      })
    );
    registrar.register(
      "POST",
      "/project-operations/artifact-links/:linkId/revoke",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.manageArtifact);
        return {
          status: 200,
          body: {
            link: await this.options.application.store.revokeArtifactLink({
              ...ctx(c, r),
              linkId: id(r, "linkId"),
              reason: reasonSchema.parse(r.body).reason
            })
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/project-operations/artifact-links/:linkId/promote-primary",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.manageArtifact);
        return {
          status: 200,
          body: {
            link: await this.options.application.store.promotePrimary({
              ...ctx(c, r),
              linkId: id(r, "linkId")
            })
          }
        };
      })
    );
    registrar.register(
      "POST",
      "/project-operations/projects/:projectId/updates",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.createUpdate);
        const update = await this.options.application.store.createUpdate({
          ...ctx(c, r),
          projectId: id(r, "projectId"),
          ...createUpdateSchema.parse(r.body)
        });
        return { status: 201, body: { update } };
      })
    );
    registrar.get(
      "/project-operations/projects/:projectId/phase-state",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.read);
        return {
          status: 200,
          body: {
            phases: await this.options.application.store.phaseState(
              c.tenant.tenantId,
              id(r, "projectId")
            )
          }
        };
      })
    );
    registrar.get(
      "/project-operations/projects/:projectId/timeline",
      this.handle(async (r) => {
        const c = await this.tenant(r, projectOperationsPermissions.read);
        return {
          status: 200,
          body: {
            timeline: await this.options.application.store.timeline(
              c.tenant.tenantId,
              id(r, "projectId")
            )
          }
        };
      })
    );
  }
  private async tenant(request: ApiRequest, permission: Permission) {
    const c = await this.options.authorization.tenantContext(request);
    const d = this.options.definitions.find((x) => x.descriptor.id === moduleId);
    if (
      !d ||
      !this.options.featureFlags.isEnabled(d.descriptor.featureFlag) ||
      !c.entitlements.includes(entitlement) ||
      !c.authorization.modulePermissions.includes(permission)
    )
      throw new ProjectOperationsProblem(
        403,
        "PERMISSION_DENIED",
        "Project Operations access denied."
      );
    return c;
  }
  private handle(fn: (r: ApiRequest) => Promise<ApiResponse>) {
    return async (r: ApiRequest) => {
      try {
        return await fn(r);
      } catch (error) {
        if (error instanceof ProjectOperationsProblem)
          return {
            status: error.status,
            body: {
              error: { code: error.code, message: error.message, requestId: r.context.requestId }
            }
          };
        if (error instanceof z.ZodError)
          return {
            status: 400,
            body: {
              error: {
                code: "VALIDATION_FAILED",
                message: "Request validation failed.",
                requestId: r.context.requestId
              }
            }
          };
        throw error;
      }
    };
  }
}
export const createProjectOperationsApi = (options: ProjectOperationsApiOptions) =>
  new ProjectOperationsApi(options);
