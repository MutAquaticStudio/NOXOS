import type { Sql, TransactionSql } from "postgres";
import type {
  ProjectArtifactReference,
  ProjectArtifactType,
  ProjectOperationsCommercialProjection,
  ProjectOperationsStore
} from "@nox-os/project-operations";
import { ProjectOperationsProblem } from "@nox-os/project-operations";

type Db = Sql | TransactionSql;
const audit = async (
  sql: Db,
  c: { tenantId: string; actorUserId: string; requestId: string; correlationId: string },
  action: string,
  type: string,
  id: string
) =>
  sql`insert into platform.audit_events (tenant_id,actor_user_id,action,resource_type,resource_id,request_id,correlation_id) values (${c.tenantId},${c.actorUserId},${action},${type},${id},${c.requestId},${c.correlationId})`;
const activeMember = async (sql: Db, tenantId: string, userId: string) =>
  (
    await sql`select 1 from platform.tenant_memberships m join platform.platform_users u on u.id=m.user_id where m.tenant_id=${tenantId} and m.user_id=${userId} and m.status='ACTIVE' and u.status='ACTIVE'`
  )[0] !== undefined;
const project = async (sql: Db, tenantId: string, id: string, lock = false) => {
  const r = lock
    ? await sql`select * from project_operations.projects where tenant_id=${tenantId} and id=${id} for update`
    : await sql`select * from project_operations.projects where tenant_id=${tenantId} and id=${id}`;
  if (!r[0])
    throw new ProjectOperationsProblem(
      404,
      "PROJECT_NOT_FOUND",
      "Operational Project was not found."
    );
  return r[0] as any;
};
const allowedPrimary: Record<string, readonly string[]> = {
  BRIEF: ["DESIGN_BRIEF"],
  DESIGN: ["DESIGN_PROJECT", "FORMULA_VERSION"],
  TRIAL: ["TRIAL"],
  SENSORY: ["SENSORY_EVALUATION"],
  READINESS: ["READINESS_ASSESSMENT"],
  PRODUCTION: ["PRODUCTION_ORDER", "PRODUCTION_BATCH"],
  QC_RELEASE: ["QC_INSPECTION", "BATCH_RELEASE_DECISION"]
};

export class PostgresProjectOperationsStore implements ProjectOperationsStore {
  constructor(private readonly sql: Sql) {}
  async listProjects(tenantId: string) {
    return this.sql`
      select p.*,o.order_number as source_service_order_number,
        c.display_name as source_customer_display_name,
        u.display_name as owner_display_name,
        count(distinct t.id) filter(where t.required)::int as required_task_count,
        count(distinct t.id) filter(where t.required and t.status='DONE')::int as completed_required_task_count,
        count(distinct ph.id) filter(where ph.required)::int as required_phase_count
      from project_operations.projects p
      left join project_operations.project_tasks t
        on t.tenant_id=p.tenant_id and t.project_id=p.id
      left join lab_services.service_orders o
        on o.tenant_id=p.tenant_id and o.id=p.source_service_order_id
      left join lab_services.customers c
        on c.tenant_id=o.tenant_id and c.id=o.customer_id
      left join platform.platform_users u on u.id=p.owner_user_id
      left join project_operations.project_phase_plans ph
        on ph.tenant_id=p.tenant_id and ph.project_id=p.id
      where p.tenant_id=${tenantId}
      group by p.id,o.id,c.id,u.id
      order by p.updated_at desc
    `;
  }
  async findProject(tenantId: string, id: string) {
    const p = await this.sql`
      select p.*,o.order_number as source_service_order_number,
        c.display_name as source_customer_display_name,o.status as source_service_order_status
        ,u.display_name as owner_display_name
      from project_operations.projects p
      left join lab_services.service_orders o
        on o.tenant_id=p.tenant_id and o.id=p.source_service_order_id
      left join lab_services.customers c
        on c.tenant_id=o.tenant_id and c.id=o.customer_id
      left join platform.platform_users u on u.id=p.owner_user_id
      where p.tenant_id=${tenantId} and p.id=${id}
    `;
    if (!p[0]) return undefined;
    const [phases, tasks, dependencies, links, updates, scope, phaseState] = await Promise.all([
      this
        .sql`select ph.*,u.display_name as owner_display_name from project_operations.project_phase_plans ph left join platform.platform_users u on u.id=ph.owner_user_id where ph.tenant_id=${tenantId} and ph.project_id=${id} order by ph.phase_order`,
      this
        .sql`select t.*,u.display_name as assignee_display_name from project_operations.project_tasks t left join platform.platform_users u on u.id=t.assignee_user_id where t.tenant_id=${tenantId} and t.project_id=${id} order by t.created_at`,
      this
        .sql`select * from project_operations.task_dependencies where tenant_id=${tenantId} and project_id=${id} order by created_at`,
      this
        .sql`select * from project_operations.project_artifact_links where tenant_id=${tenantId} and project_id=${id} order by created_at`,
      this
        .sql`select * from project_operations.project_updates where tenant_id=${tenantId} and project_id=${id} order by created_at`,
      this.sql`
        select id,line_order,service_type,title,scope_description
        from lab_services.service_order_lines
        where tenant_id=${tenantId} and service_order_id=${p[0].source_service_order_id ?? null}
        order by line_order
      `,
      this.phaseStateWith(this.sql, tenantId, id)
    ]);
    return { project: p[0], phases, phaseState, tasks, dependencies, links, updates, scope };
  }
  async createProject(input: any) {
    return this.sql.begin(async (tx) => {
      if (!(await activeMember(tx, input.tenantId, input.ownerUserId)))
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_OWNER_NOT_ACTIVE_MEMBER",
          "Project owner must be an active Tenant member."
        );
      if (input.projectType === "CLIENT_SERVICE") {
        // A transaction-scoped advisory lock protects the partial unique invariant
        // before an absent source link can be observed by two concurrent creators.
        await tx`select pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.sourceServiceOrderId}`}, 0))`;
        const existing =
          await tx`select id from project_operations.projects where tenant_id=${input.tenantId} and source_service_order_id=${input.sourceServiceOrderId} for update`;
        if (existing[0])
          throw new ProjectOperationsProblem(
            409,
            "PROJECT_SOURCE_SERVICE_ORDER_ALREADY_LINKED",
            "A Client Project already exists for this Service Order."
          );
        const source =
          await tx`select o.id,o.status from lab_services.service_orders o where o.tenant_id=${input.tenantId} and o.id=${input.sourceServiceOrderId}`;
        const lines =
          await tx`select id from lab_services.service_order_lines where tenant_id=${input.tenantId} and service_order_id=${input.sourceServiceOrderId}`;
        if (!source[0] || !["CONFIRMED", "IN_PROGRESS"].includes(source[0].status) || !lines.length)
          throw new ProjectOperationsProblem(
            409,
            "PROJECT_SOURCE_SERVICE_ORDER_INVALID",
            "Confirmed Service Order with scope is required."
          );
      }
      const rows = await tx<
        any[]
      >`insert into project_operations.projects (tenant_id,project_code,project_type,name,description,source_service_order_id,owner_user_id,priority,created_by_user_id,target_start_date,target_completion_date) values (${input.tenantId},${input.projectCode},${input.projectType},${input.name},${input.description ?? null},${input.sourceServiceOrderId ?? null},${input.ownerUserId},${input.priority},${input.actorUserId},${input.targetStartDate ?? null},${input.targetCompletionDate ?? null}) returning *`;
      await audit(
        tx,
        input,
        "project-operations.project.created",
        "OperationalProject",
        rows[0].id
      );
      return rows[0];
    });
  }
  async updateProject(input: any) {
    return this.sql.begin(async (tx) => {
      const p = await project(tx, input.tenantId, input.projectId, true);
      if (["COMPLETED", "CANCELLED"].includes(p.status))
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_ALREADY_TERMINAL",
          "Terminal Project is immutable."
        );
      if (
        input.changes.ownerUserId &&
        !(await activeMember(tx, input.tenantId, input.changes.ownerUserId))
      )
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_OWNER_NOT_ACTIVE_MEMBER",
          "Owner must be active."
        );
      const c = input.changes;
      const r = await tx<
        any[]
      >`update project_operations.projects set name=coalesce(${c.name ?? null},name),description=coalesce(${c.description ?? null},description),owner_user_id=coalesce(${c.ownerUserId ?? null},owner_user_id),priority=coalesce(${c.priority ?? null},priority),target_start_date=coalesce(${c.targetStartDate ?? null},target_start_date),target_completion_date=coalesce(${c.targetCompletionDate ?? null},target_completion_date),updated_at=now() where tenant_id=${input.tenantId} and id=${p.id} returning *`;
      await audit(tx, input, "project-operations.project.updated", "OperationalProject", p.id);
      return r[0];
    });
  }
  async activateProject(input: any) {
    return this.sql.begin(async (tx) => {
      const p = await project(tx, input.tenantId, input.projectId, true);
      if (p.status !== "DRAFT")
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_NOT_ACTIVATABLE",
          "Only DRAFT Project can activate."
        );
      if (!(await activeMember(tx, input.tenantId, p.owner_user_id)))
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_OWNER_NOT_ACTIVE_MEMBER",
          "Owner must be active."
        );
      const phases =
        await tx`select id from project_operations.project_phase_plans where tenant_id=${input.tenantId} and project_id=${p.id}`;
      const tasks =
        await tx`select * from project_operations.project_tasks where tenant_id=${input.tenantId} and project_id=${p.id}`;
      if (!phases.length && !tasks.length)
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_PLAN_REQUIRED",
          "Project needs a task or phase plan."
        );
      await this.assertScope(tx, input.tenantId, p, tasks, false);
      const r = await tx<
        any[]
      >`update project_operations.projects set status='ACTIVE',activated_by_user_id=${input.actorUserId},activated_at=now(),updated_at=now() where id=${p.id} returning *`;
      await audit(tx, input, "project-operations.project.activated", "OperationalProject", p.id);
      return r[0];
    });
  }
  async holdProject(input: any) {
    return this.transition(input, "ACTIVE", "ON_HOLD", "held", "project-operations.project.held");
  }
  async resumeProject(input: any) {
    return this.transition(
      input,
      "ON_HOLD",
      "ACTIVE",
      "resumed",
      "project-operations.project.resumed"
    );
  }
  private async transition(input: any, from: string, to: string, label: string, action: string) {
    return this.sql.begin(async (tx) => {
      const p = await project(tx, input.tenantId, input.projectId, true);
      if (p.status !== from)
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_STATE_INVALID",
          "Project transition is invalid."
        );
      if (to === "ON_HOLD" && !input.reason)
        throw new ProjectOperationsProblem(
          400,
          "PROJECT_HOLD_REASON_REQUIRED",
          "Hold reason required."
        );
      if (to === "ACTIVE" && p.project_type === "CLIENT_SERVICE")
        await this.assertSourceLive(tx, input.tenantId, p);
      const r = await tx<
        any[]
      >`update project_operations.projects set status=${to},hold_reason=${to === "ON_HOLD" ? input.reason : null},${to === "ON_HOLD" ? tx`held_by_user_id=${input.actorUserId},held_at=now()` : tx`resumed_by_user_id=${input.actorUserId},resumed_at=now()`},updated_at=now() where id=${p.id} returning *`;
      await audit(tx, input, action, "OperationalProject", p.id);
      return r[0];
    });
  }
  async completeProject(input: any) {
    return this.sql.begin(async (tx) => {
      const p = await project(tx, input.tenantId, input.projectId, true);
      if (p.status !== "ACTIVE")
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_NOT_COMPLETABLE",
          "Project is not active."
        );
      const tasks = await tx<
        any[]
      >`select * from project_operations.project_tasks where tenant_id=${input.tenantId} and project_id=${p.id} for update`;
      if (
        tasks.some((t) => t.status === "IN_PROGRESS") ||
        tasks.some((t) => t.required && t.status !== "DONE")
      )
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_TASKS_INCOMPLETE",
          "Required Tasks must be DONE."
        );
      await this.assertScope(tx, input.tenantId, p, tasks, true);
      const blockers =
        await tx`select 1 from project_operations.project_updates b where b.tenant_id=${input.tenantId} and b.project_id=${p.id} and b.update_type='BLOCKER' and not exists(select 1 from project_operations.project_updates r where r.tenant_id=b.tenant_id and r.resolves_update_id=b.id)`;
      if (blockers[0])
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_BLOCKER_UNRESOLVED",
          "Project has unresolved blocker."
        );
      const phases = await this.phaseStateWith(tx, input.tenantId, p.id);
      if ((phases as any[]).some((x) => x.required && x.state !== "COMPLETE"))
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_PHASES_INCOMPLETE",
          "Required phases must be complete."
        );
      const r = await tx<
        any[]
      >`update project_operations.projects set status='COMPLETED',completed_by_user_id=${input.actorUserId},completed_at=now(),updated_at=now() where id=${p.id} returning *`;
      await audit(tx, input, "project-operations.project.completed", "OperationalProject", p.id);
      return r[0];
    });
  }
  async cancelProject(input: any) {
    return this.sql.begin(async (tx) => {
      const p = await project(tx, input.tenantId, input.projectId, true);
      if (!["DRAFT", "ACTIVE", "ON_HOLD"].includes(p.status))
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_STATE_INVALID",
          "Project cannot be cancelled."
        );
      if (p.status !== "DRAFT" && !input.reason)
        throw new ProjectOperationsProblem(
          400,
          "PROJECT_CANCELLATION_REASON_REQUIRED",
          "Cancellation reason required."
        );
      const r = await tx<
        any[]
      >`update project_operations.projects set status='CANCELLED',cancellation_reason=${input.reason ?? null},cancelled_by_user_id=${input.actorUserId},cancelled_at=now(),updated_at=now() where id=${p.id} returning *`;
      await audit(tx, input, "project-operations.project.cancelled", "OperationalProject", p.id);
      return r[0];
    });
  }
  async replacePhasePlans(input: any) {
    return this.sql.begin(async (tx) => {
      const p = await project(tx, input.tenantId, input.projectId, true);
      if (p.status !== "DRAFT")
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_PHASE_IMMUTABLE",
          "Phase identity is frozen after activation."
        );
      for (const phase of input.phases)
        if (phase.ownerUserId && !(await activeMember(tx, input.tenantId, phase.ownerUserId)))
          throw new ProjectOperationsProblem(
            409,
            "PROJECT_PHASE_OWNER_NOT_ACTIVE_MEMBER",
            "Phase owner must be an active Tenant member."
          );
      await tx`delete from project_operations.project_phase_plans where tenant_id=${input.tenantId} and project_id=${p.id}`;
      for (const phase of input.phases)
        await tx`insert into project_operations.project_phase_plans (tenant_id,project_id,phase_key,phase_order,required,owner_user_id,planned_start_date,planned_due_date,notes,created_by_user_id) values (${input.tenantId},${p.id},${phase.phaseKey},${phase.phaseOrder},${phase.required},${phase.ownerUserId ?? null},${phase.plannedStartDate ?? null},${phase.plannedDueDate ?? null},${phase.notes ?? null},${input.actorUserId})`;
      await audit(tx, input, "project-operations.phase-plan.updated", "OperationalProject", p.id);
      return tx`select * from project_operations.project_phase_plans where tenant_id=${input.tenantId} and project_id=${p.id} order by phase_order`;
    });
  }
  async createTask(input: any) {
    return this.sql.begin(async (tx) => {
      const p = await project(tx, input.tenantId, input.projectId, true);
      if (["COMPLETED", "CANCELLED"].includes(p.status))
        throw new ProjectOperationsProblem(409, "PROJECT_ALREADY_TERMINAL", "Project terminal.");
      if (input.assigneeUserId && !(await activeMember(tx, input.tenantId, input.assigneeUserId)))
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_ASSIGNEE_NOT_ACTIVE_MEMBER",
          "Assignee not active."
        );
      if (input.phasePlanId) await this.assertPhase(tx, input.tenantId, p.id, input.phasePlanId);
      if (p.project_type === "INTERNAL" && input.sourceServiceOrderLineId)
        throw new ProjectOperationsProblem(
          400,
          "PROJECT_TASK_SOURCE_SCOPE_INVALID",
          "Internal task cannot have Service Order scope."
        );
      if (input.sourceServiceOrderLineId)
        await this.assertLine(tx, input.tenantId, p, input.sourceServiceOrderLineId);
      const r = await tx<
        any[]
      >`insert into project_operations.project_tasks (tenant_id,project_id,phase_plan_id,source_service_order_line_id,task_kind,title,description,priority,required,assignee_user_id, due_date,created_by_user_id) values (${input.tenantId},${p.id},${input.phasePlanId ?? null},${input.sourceServiceOrderLineId ?? null},${input.taskKind},${input.title},${input.description ?? null},${input.priority},${input.required},${input.assigneeUserId ?? null},${input.dueDate ?? null},${input.actorUserId}) returning *`;
      await audit(tx, input, "project-operations.task.created", "ProjectTask", r[0].id);
      return r[0];
    });
  }
  async updateTask(input: any) {
    return this.sql.begin(async (tx) => {
      const t = await tx<
        any[]
      >`select * from project_operations.project_tasks where tenant_id=${input.tenantId} and id=${input.taskId} for update`;
      if (!t[0])
        throw new ProjectOperationsProblem(404, "PROJECT_TASK_NOT_FOUND", "Task not found.");
      if (t[0].status !== "TODO")
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_TASK_NOT_EDITABLE",
          "Only TODO Task can change identity."
        );
      const c = input.changes;
      if (c.assigneeUserId && !(await activeMember(tx, input.tenantId, c.assigneeUserId)))
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_ASSIGNEE_NOT_ACTIVE_MEMBER",
          "Assignee must be active."
        );
      const taskProject = await project(tx, input.tenantId, t[0].project_id);
      if (c.phasePlanId) await this.assertPhase(tx, input.tenantId, taskProject.id, c.phasePlanId);
      if (c.sourceServiceOrderLineId) {
        if (taskProject.project_type === "INTERNAL")
          throw new ProjectOperationsProblem(
            400,
            "PROJECT_TASK_SOURCE_SCOPE_INVALID",
            "Internal task cannot have Service Order scope."
          );
        await this.assertLine(tx, input.tenantId, taskProject, c.sourceServiceOrderLineId);
      }
      const r = await tx<
        any[]
      >`update project_operations.project_tasks set title=coalesce(${c.title ?? null},title),description=coalesce(${c.description ?? null},description),priority=coalesce(${c.priority ?? null},priority),required=coalesce(${c.required ?? null},required),assignee_user_id=coalesce(${c.assigneeUserId ?? null},assignee_user_id),due_date=coalesce(${c.dueDate ?? null},due_date),phase_plan_id=coalesce(${c.phasePlanId ?? null},phase_plan_id),source_service_order_line_id=coalesce(${c.sourceServiceOrderLineId ?? null},source_service_order_line_id),updated_at=now() where id=${input.taskId} returning *`;
      await audit(tx, input, "project-operations.task.updated", "ProjectTask", input.taskId);
      return r[0];
    });
  }
  async startTask(input: any) {
    return this.transitionTask(input, "IN_PROGRESS");
  }
  async completeTask(input: any) {
    return this.transitionTask(input, "DONE");
  }
  private async transitionTask(input: any, to: string) {
    return this.sql.begin(async (tx) => {
      const rows = await tx<
        any[]
      >`select t.*,p.status as project_status,p.project_type,p.source_service_order_id from project_operations.project_tasks t join project_operations.projects p on p.id=t.project_id and p.tenant_id=t.tenant_id where t.tenant_id=${input.tenantId} and t.id=${input.taskId} for update`;
      const t = rows[0];
      if (!t) throw new ProjectOperationsProblem(404, "PROJECT_TASK_NOT_FOUND", "Task not found.");
      const allowedTransition =
        (to === "IN_PROGRESS" && t.status === "TODO" && t.task_kind !== "MILESTONE") ||
        (to === "DONE" &&
          (t.status === "TODO" || (t.status === "IN_PROGRESS" && t.task_kind === "TASK")));
      if (t.project_status !== "ACTIVE" || !allowedTransition)
        throw new ProjectOperationsProblem(
          409,
          to === "DONE" ? "PROJECT_TASK_NOT_COMPLETABLE" : "PROJECT_TASK_NOT_STARTABLE",
          "Task transition is invalid."
        );
      if (t.project_type === "CLIENT_SERVICE") await this.assertSourceLive(tx, input.tenantId, t);
      const deps =
        await tx`select predecessor.status from project_operations.task_dependencies d join project_operations.project_tasks predecessor on predecessor.id=d.predecessor_task_id and predecessor.tenant_id=d.tenant_id where d.tenant_id=${input.tenantId} and d.successor_task_id=${t.id}`;
      if (deps.some((d: any) => d.status !== "DONE"))
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_TASK_DEPENDENCY_UNSATISFIED",
          "Predecessor task not done."
        );
      const r = await tx<
        any[]
      >`update project_operations.project_tasks set status=${to},${to === "DONE" ? tx`completed_by_user_id=${input.actorUserId},completed_at=now()` : tx`started_by_user_id=${input.actorUserId},started_at=now()`},updated_at=now() where id=${t.id} returning *`;
      await audit(
        tx,
        input,
        to === "DONE" ? "project-operations.task.completed" : "project-operations.task.started",
        "ProjectTask",
        t.id
      );
      return r[0];
    });
  }
  async cancelTask(input: any) {
    return this.sql.begin(async (tx) => {
      const r = await tx<
        any[]
      >`select t.*,p.status project_status from project_operations.project_tasks t join project_operations.projects p on p.id=t.project_id where t.tenant_id=${input.tenantId} and t.id=${input.taskId} for update`;
      const t = r[0];
      if (
        !t ||
        t.project_status !== "ACTIVE" ||
        !["TODO", "IN_PROGRESS"].includes(t.status) ||
        ((t.status === "IN_PROGRESS" || t.required) && !input.reason)
      )
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_TASK_NOT_EDITABLE",
          "Task cannot be cancelled."
        );
      const u = await tx<
        any[]
      >`update project_operations.project_tasks set status='CANCELLED',cancellation_reason=${input.reason ?? null},cancelled_by_user_id=${input.actorUserId},cancelled_at=now(),updated_at=now() where id=${t.id} returning *`;
      await audit(tx, input, "project-operations.task.cancelled", "ProjectTask", t.id);
      return u[0];
    });
  }
  async createDependency(input: any) {
    return this.sql.begin(async (tx) => {
      const successor = (
        await tx<
          any[]
        >`select t.*,p.status project_status from project_operations.project_tasks t join project_operations.projects p on p.id=t.project_id where t.tenant_id=${input.tenantId} and t.id=${input.successorTaskId} for update`
      )[0];
      const predecessor = (
        await tx<
          any[]
        >`select * from project_operations.project_tasks where tenant_id=${input.tenantId} and id=${input.predecessorTaskId}`
      )[0];
      if (
        !successor ||
        !predecessor ||
        successor.project_id !== predecessor.project_id ||
        successor.status !== "TODO" ||
        !["DRAFT", "ACTIVE"].includes(successor.project_status)
      )
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_DEPENDENCY_INVALID",
          "Dependency is invalid."
        );
      const cycle =
        await tx`with recursive path(id) as (select successor_task_id from project_operations.task_dependencies where tenant_id=${input.tenantId} and predecessor_task_id=${successor.id} union select d.successor_task_id from project_operations.task_dependencies d join path p on p.id=d.predecessor_task_id where d.tenant_id=${input.tenantId}) select 1 from path where id=${predecessor.id}`;
      if (cycle[0])
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_DEPENDENCY_CYCLE",
          "Dependency creates cycle."
        );
      const r = await tx<
        any[]
      >`insert into project_operations.task_dependencies (tenant_id,project_id,predecessor_task_id,successor_task_id,created_by_user_id) values (${input.tenantId},${successor.project_id},${predecessor.id},${successor.id},${input.actorUserId}) returning *`;
      await audit(tx, input, "project-operations.dependency.created", "TaskDependency", r[0].id);
      return r[0];
    });
  }
  async removeDependency(input: any) {
    await this.sql.begin(async (tx) => {
      const task = (
        await tx<
          any[]
        >`select t.project_id,p.status as project_status from project_operations.project_tasks t join project_operations.projects p on p.tenant_id=t.tenant_id and p.id=t.project_id where t.tenant_id=${input.tenantId} and t.id=${input.taskId} for update`
      )[0];
      if (!task || !["DRAFT", "ACTIVE"].includes(task.project_status))
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_DEPENDENCY_INVALID",
          "Dependency cannot mutate while Project is on hold or terminal."
        );
      const r = await tx<
        any[]
      >`delete from project_operations.task_dependencies where tenant_id=${input.tenantId} and id=${input.dependencyId} and successor_task_id=${input.taskId} returning id`;
      if (!r[0])
        throw new ProjectOperationsProblem(
          404,
          "PROJECT_DEPENDENCY_NOT_FOUND",
          "Dependency not found."
        );
      await audit(
        tx,
        input,
        "project-operations.dependency.removed",
        "TaskDependency",
        input.dependencyId
      );
    });
  }
  async createArtifactLink(input: any) {
    return this.sql.begin(async (tx) => {
      const p = await project(tx, input.tenantId, input.projectId, true);
      if (["COMPLETED", "CANCELLED"].includes(p.status))
        throw new ProjectOperationsProblem(409, "PROJECT_ALREADY_TERMINAL", "Project terminal.");
      const artifact = await this.resolveArtifact({
        tenantId: input.tenantId,
        artifactType: input.artifactType,
        artifactId: input.artifactId
      });
      if (!artifact)
        throw new ProjectOperationsProblem(
          404,
          "PROJECT_ARTIFACT_NOT_FOUND",
          "Artifact not found."
        );
      await this.assertArtifactLineage(tx, input.tenantId, p.id, artifact);
      if (input.phasePlanId) {
        const phase = (
          await tx<
            any[]
          >`select phase_key from project_operations.project_phase_plans where tenant_id=${input.tenantId} and id=${input.phasePlanId} and project_id=${p.id} for update`
        )[0];
        if (!phase)
          throw new ProjectOperationsProblem(
            409,
            "PROJECT_ARTIFACT_PHASE_MISMATCH",
            "Artifact phase does not belong to this Project."
          );
        if (
          input.relationship === "PRIMARY" &&
          !allowedPrimary[phase.phase_key].includes(input.artifactType)
        )
          throw new ProjectOperationsProblem(
            409,
            "PROJECT_ARTIFACT_PHASE_MISMATCH",
            "Artifact cannot be primary for phase."
          );
        // Reference/evidence/output links preserve the current primary. A primary
        // replacement is the only operation permitted to revoke it.
        if (input.relationship === "PRIMARY")
          await tx`update project_operations.project_artifact_links set status='REVOKED',revoked_by_user_id=${input.actorUserId},revoked_at=now(),revocation_reason='Replaced by promoted primary' where tenant_id=${input.tenantId} and project_id=${p.id} and phase_plan_id=${input.phasePlanId} and relationship='PRIMARY' and status='ACTIVE'`;
      }
      const r = await tx<
        any[]
      >`insert into project_operations.project_artifact_links (tenant_id,project_id,phase_plan_id,artifact_type,artifact_id,relationship,created_by_user_id) values (${input.tenantId},${p.id},${input.phasePlanId ?? null},${input.artifactType},${input.artifactId},${input.relationship},${input.actorUserId}) returning *`;
      await audit(tx, input, "project-operations.artifact-linked", "ProjectArtifactLink", r[0].id);
      return r[0];
    });
  }
  async revokeArtifactLink(input: any) {
    return this.sql.begin(async (tx) => {
      const r = await tx<
        any[]
      >`update project_operations.project_artifact_links set status='REVOKED',revoked_by_user_id=${input.actorUserId},revoked_at=now(),revocation_reason=${input.reason} where tenant_id=${input.tenantId} and id=${input.linkId} and status='ACTIVE' returning *`;
      if (!r[0])
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_ARTIFACT_LINK_ALREADY_REVOKED",
          "Link cannot be revoked."
        );
      await audit(
        tx,
        input,
        "project-operations.artifact-link-revoked",
        "ProjectArtifactLink",
        input.linkId
      );
      return r[0];
    });
  }
  async promotePrimary(input: any) {
    return this.sql.begin(async (tx) => {
      const old = (
        await tx<
          any[]
        >`select * from project_operations.project_artifact_links where tenant_id=${input.tenantId} and id=${input.linkId} and status='ACTIVE' for update`
      )[0];
      if (!old)
        throw new ProjectOperationsProblem(
          404,
          "PROJECT_ARTIFACT_LINK_NOT_FOUND",
          "Link not found."
        );
      if (!old.phase_plan_id)
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_ARTIFACT_PHASE_MISMATCH",
          "Primary needs phase."
        );
      const p = await project(tx, input.tenantId, old.project_id, true);
      const phase = (
        await tx<
          any[]
        >`select phase_key from project_operations.project_phase_plans where tenant_id=${input.tenantId} and id=${old.phase_plan_id} and project_id=${p.id} for update`
      )[0];
      if (!phase || !allowedPrimary[phase.phase_key].includes(old.artifact_type))
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_ARTIFACT_PHASE_MISMATCH",
          "Artifact cannot be primary for phase."
        );
      const artifact = await this.resolveArtifactFrom(tx, {
        tenantId: input.tenantId,
        artifactType: old.artifact_type,
        artifactId: old.artifact_id
      });
      if (!artifact)
        throw new ProjectOperationsProblem(
          404,
          "PROJECT_ARTIFACT_NOT_FOUND",
          "Artifact not found."
        );
      await this.assertArtifactLineage(tx, input.tenantId, p.id, artifact);
      await tx`update project_operations.project_artifact_links set status='REVOKED',revoked_by_user_id=${input.actorUserId},revoked_at=now(),revocation_reason='Promoted alternate primary' where tenant_id=${input.tenantId} and project_id=${old.project_id} and phase_plan_id=${old.phase_plan_id} and relationship='PRIMARY' and status='ACTIVE'`;
      const r = await tx<
        any[]
      >`insert into project_operations.project_artifact_links (tenant_id,project_id,phase_plan_id,artifact_type,artifact_id,relationship,created_by_user_id) values (${input.tenantId},${old.project_id},${old.phase_plan_id},${old.artifact_type},${old.artifact_id},'PRIMARY',${input.actorUserId}) returning *`;
      await audit(
        tx,
        input,
        "project-operations.primary-artifact-promoted",
        "ProjectArtifactLink",
        old.id
      );
      return r[0];
    });
  }
  async createUpdate(input: any) {
    return this.sql.begin(async (tx) => {
      await project(tx, input.tenantId, input.projectId, true);
      if (input.updateType === "BLOCKER_RESOLVED") {
        const b = (
          await tx<
            any[]
          >`select * from project_operations.project_updates where tenant_id=${input.tenantId} and id=${input.resolvesUpdateId} and project_id=${input.projectId} and update_type='BLOCKER' for update`
        )[0];
        if (!b)
          throw new ProjectOperationsProblem(
            409,
            "PROJECT_BLOCKER_RESOLUTION_INVALID",
            "Blocker resolution invalid."
          );
        const existingResolution = await tx<
          any[]
        >`select id from project_operations.project_updates where tenant_id=${input.tenantId} and resolves_update_id=${input.resolvesUpdateId} for update`;
        if (existingResolution[0])
          throw new ProjectOperationsProblem(
            409,
            "PROJECT_BLOCKER_ALREADY_RESOLVED",
            "Blocker already has a resolution record."
          );
      }
      const r = await tx<
        any[]
      >`insert into project_operations.project_updates (tenant_id,project_id,phase_plan_id,task_id,update_type,summary,resolves_update_id,created_by_user_id) values (${input.tenantId},${input.projectId},${input.phasePlanId ?? null},${input.taskId ?? null},${input.updateType},${input.summary},${input.resolvesUpdateId ?? null},${input.actorUserId}) returning *`;
      await audit(tx, input, "project-operations.update.created", "ProjectUpdate", r[0].id);
      return r[0];
    });
  }
  async phaseState(tenantId: string, projectId: string) {
    return this.phaseStateWith(this.sql, tenantId, projectId);
  }
  private async phaseStateWith(sql: Db, tenantId: string, projectId: string) {
    const phases = await sql<
      any[]
    >`select p.*,l.artifact_type,l.artifact_id from project_operations.project_phase_plans p left join project_operations.project_artifact_links l on l.tenant_id=p.tenant_id and l.phase_plan_id=p.id and l.relationship='PRIMARY' and l.status='ACTIVE' where p.tenant_id=${tenantId} and p.project_id=${projectId} order by p.phase_order`;
    const resolved: any[] = [];
    for (const p of phases) {
      let state: string;
      if (!p.artifact_id) {
        const predecessors = resolved.filter((candidate) => candidate.phase_order < p.phase_order);
        state = predecessors.every(
          (candidate) => !candidate.required || candidate.state === "COMPLETE"
        )
          ? "AVAILABLE"
          : "NOT_STARTED";
      } else {
        const a = await this.resolveArtifactFrom(sql, {
          tenantId,
          artifactType: p.artifact_type,
          artifactId: p.artifact_id
        });
        const s = a?.canonicalStatus ?? "MISSING";
        state = [
          "FROZEN",
          "PREPARED",
          "COMPLETED",
          "READY",
          "RELEASED",
          "INTENT_CONFIRMED",
          "FINAL"
        ].includes(s)
          ? "COMPLETE"
          : ["CANCELLED", "ARCHIVED", "ABORTED", "REJECTED", "BLOCKED", "AMBIGUOUS"].includes(s)
            ? "BLOCKED"
            : s === "REVIEW_REQUIRED" || s === "HOLD"
              ? "NEEDS_ACTION"
              : s === "REVISION_REQUIRED"
                ? "REVISION_REQUIRED"
                : "ACTIVE";
      }
      // A final G5 revision signal remains meaningful after the formula that
      // preceded it was frozen. It is a read-only derived exception for the
      // DESIGN phase, never a mutable status stored by G12.
      if (p.phase_key === "DESIGN") {
        const revisionLinks = await sql<
          any[]
        >`select artifact_id from project_operations.project_artifact_links where tenant_id=${tenantId} and phase_plan_id=${p.id} and artifact_type='SENSORY_EVALUATION' and status='ACTIVE'`;
        for (const revisionLink of revisionLinks) {
          const revision = await this.resolveArtifactFrom(sql, {
            tenantId,
            artifactType: "SENSORY_EVALUATION",
            artifactId: revisionLink.artifact_id
          });
          if (revision?.canonicalStatus === "REVISION_REQUIRED") {
            state = "REVISION_REQUIRED";
            break;
          }
        }
      }
      resolved.push({ ...p, state });
    }
    return resolved;
  }
  async timeline(tenantId: string, projectId: string) {
    return this
      .sql`select * from project_operations.project_updates where tenant_id=${tenantId} and project_id=${projectId} order by created_at`;
  }
  async findProjectForCommercial(input: {
    tenantId: string;
    projectId: string;
  }): Promise<ProjectOperationsCommercialProjection | undefined> {
    const p = (
      await this.sql<
        any[]
      >`select * from project_operations.projects where tenant_id=${input.tenantId} and id=${input.projectId}`
    )[0];
    if (!p) return undefined;
    const t = (
      await this.sql<
        any[]
      >`select count(*) filter(where required)::int required,count(*) filter(where required and status='DONE')::int done from project_operations.project_tasks where tenant_id=${input.tenantId} and project_id=${p.id}`
    )[0];
    return {
      projectId: p.id,
      projectCode: p.project_code,
      projectType: p.project_type,
      status: p.status,
      sourceServiceOrderId: p.source_service_order_id,
      requiredTaskCount: t.required,
      completedRequiredTaskCount: t.done,
      requiredPhases: (await this.phaseState(input.tenantId, p.id))
        .filter((x: any) => x.required)
        .map((x: any) => ({ phaseKey: x.phase_key, state: x.state })) as any
    };
  }
  async resolveArtifact(input: {
    tenantId: string;
    artifactType: ProjectArtifactType;
    artifactId: string;
  }): Promise<ProjectArtifactReference | undefined> {
    return this.resolveArtifactFrom(this.sql, input);
  }
  private async resolveArtifactFrom(
    sql: Db,
    input: { tenantId: string; artifactType: ProjectArtifactType; artifactId: string }
  ): Promise<ProjectArtifactReference | undefined> {
    const q: Record<string, string> = {
      DESIGN_PROJECT:
        "select p.id,p.tenant_id,p.name label,p.status,jsonb_build_object('designProjectId',p.id) lineage from design_studio.projects p",
      DESIGN_BRIEF:
        "select b.id,b.tenant_id,b.raw_brief label,b.status,jsonb_build_object('designProjectId',b.project_id,'designBriefId',b.id) lineage from design_studio.design_briefs b",
      FORMULA_VERSION:
        "select v.id,v.tenant_id,v.formula_id::text label,v.status,jsonb_build_object('designProjectId',f.project_id,'designBriefId',f.source_brief_id,'formulaId',v.formula_id,'formulaVersionId',v.id,'formulaBundleHash',v.bundle_hash) lineage from design_studio.formula_versions v join design_studio.formulas f on f.tenant_id=v.tenant_id and f.id=v.formula_id",
      TRIAL:
        "select t.id,t.tenant_id,t.id::text label,t.status,jsonb_build_object('designProjectId',f.project_id,'designBriefId',f.source_brief_id,'formulaId',v.formula_id,'formulaVersionId',t.formula_version_id,'formulaBundleHash',t.formula_bundle_hash,'trialId',t.id) lineage from trial_sensory.trials t join design_studio.formula_versions v on v.tenant_id=t.tenant_id and v.id=t.formula_version_id join design_studio.formulas f on f.tenant_id=v.tenant_id and f.id=v.formula_id",
      SENSORY_EVALUATION:
        "select e.id,e.tenant_id,e.id::text label,case when e.status='FINAL' and e.decision='REVISION_REQUIRED' then 'REVISION_REQUIRED' else e.status end status,jsonb_build_object('designProjectId',f.project_id,'designBriefId',f.source_brief_id,'formulaId',v.formula_id,'formulaVersionId',t.formula_version_id,'formulaBundleHash',t.formula_bundle_hash,'trialId',t.id,'evaluationId',e.id) lineage from trial_sensory.sensory_evaluations e join trial_sensory.trials t on t.tenant_id=e.tenant_id and t.id=e.trial_id join design_studio.formula_versions v on v.tenant_id=t.tenant_id and v.id=t.formula_version_id join design_studio.formulas f on f.tenant_id=v.tenant_id and f.id=v.formula_id",
      READINESS_ASSESSMENT:
        "select r.id,r.tenant_id,r.id::text label,r.decision status,jsonb_build_object('designProjectId',f.project_id,'designBriefId',f.source_brief_id,'formulaId',v.formula_id,'formulaVersionId',r.formula_version_id,'formulaBundleHash',r.formula_bundle_hash) lineage from release_readiness.assessments r join design_studio.formula_versions v on v.tenant_id=r.tenant_id and v.id=r.formula_version_id join design_studio.formulas f on f.tenant_id=v.tenant_id and f.id=v.formula_id",
      PRODUCTION_ORDER:
        "select o.id,o.tenant_id,o.order_number label,o.status,jsonb_build_object('designProjectId',f.project_id,'designBriefId',f.source_brief_id,'formulaId',v.formula_id,'formulaVersionId',o.formula_version_id,'formulaBundleHash',o.formula_bundle_hash,'productionOrderId',o.id) lineage from production.production_orders o join design_studio.formula_versions v on v.tenant_id=o.tenant_id and v.id=o.formula_version_id join design_studio.formulas f on f.tenant_id=v.tenant_id and f.id=v.formula_id",
      PRODUCTION_BATCH:
        "select b.id,b.tenant_id,b.batch_number label,o.status,jsonb_build_object('designProjectId',f.project_id,'designBriefId',f.source_brief_id,'formulaId',v.formula_id,'formulaVersionId',b.formula_version_id,'formulaBundleHash',b.formula_bundle_hash,'productionOrderId',b.production_order_id,'productionBatchId',b.id) lineage from production.production_batches b join production.production_orders o on o.tenant_id=b.tenant_id and o.id=b.production_order_id join design_studio.formula_versions v on v.tenant_id=b.tenant_id and v.id=b.formula_version_id join design_studio.formulas f on f.tenant_id=v.tenant_id and f.id=v.formula_id",
      QC_INSPECTION:
        "select i.id,i.tenant_id,i.inspection_number label,i.status,jsonb_build_object('designProjectId',f.project_id,'designBriefId',f.source_brief_id,'formulaId',v.formula_id,'formulaVersionId',b.formula_version_id,'formulaBundleHash',b.formula_bundle_hash,'productionOrderId',b.production_order_id,'productionBatchId',b.id) lineage from quality_control.batch_inspections i join production.production_batches b on b.tenant_id=i.tenant_id and b.id=i.batch_id join design_studio.formula_versions v on v.tenant_id=b.tenant_id and v.id=b.formula_version_id join design_studio.formulas f on f.tenant_id=v.tenant_id and f.id=v.formula_id",
      BATCH_RELEASE_DECISION:
        "select d.id,d.tenant_id,d.id::text label,d.decision status,jsonb_build_object('designProjectId',f.project_id,'designBriefId',f.source_brief_id,'formulaId',v.formula_id,'formulaVersionId',b.formula_version_id,'formulaBundleHash',b.formula_bundle_hash,'productionOrderId',b.production_order_id,'productionBatchId',b.id) lineage from quality_control.batch_release_decisions d join production.production_batches b on b.tenant_id=d.tenant_id and b.id=d.batch_id join design_studio.formula_versions v on v.tenant_id=b.tenant_id and v.id=b.formula_version_id join design_studio.formulas f on f.tenant_id=v.tenant_id and f.id=v.formula_id"
    };
    const query = q[input.artifactType];
    if (!query) return undefined;
    const rows = await sql.unsafe(
      `select * from (${query}) artifact where artifact.tenant_id=$1 and artifact.id=$2`,
      [input.tenantId, input.artifactId]
    );
    const r: any = rows[0];
    return r
      ? {
          type: input.artifactType,
          artifactId: r.id,
          tenantId: r.tenant_id,
          label: r.label,
          canonicalStatus: r.status,
          lineage: r.lineage ?? {}
        }
      : undefined;
  }
  private async assertSourceLive(sql: Db, tenantId: string, p: any) {
    const r =
      await sql`select status from lab_services.service_orders where tenant_id=${tenantId} and id=${p.source_service_order_id}`;
    if (!r[0] || !["CONFIRMED", "IN_PROGRESS"].includes(r[0].status))
      throw new ProjectOperationsProblem(
        409,
        r[0]?.status === "CANCELLED"
          ? "PROJECT_SOURCE_SERVICE_ORDER_CANCELLED"
          : "PROJECT_SOURCE_SERVICE_ORDER_INVALID",
        r[0]?.status === "CANCELLED"
          ? "Source Service Order is cancelled."
          : "Source Service Order is not available for operational work."
      );
  }
  private async assertPhase(sql: Db, tenantId: string, projectId: string, phasePlanId: string) {
    const phase =
      await sql`select 1 from project_operations.project_phase_plans where tenant_id=${tenantId} and project_id=${projectId} and id=${phasePlanId}`;
    if (!phase[0])
      throw new ProjectOperationsProblem(
        409,
        "PROJECT_TASK_PHASE_INVALID",
        "Task phase must belong to this Project."
      );
  }
  private async assertArtifactLineage(
    sql: Db,
    tenantId: string,
    projectId: string,
    candidate: ProjectArtifactReference
  ) {
    const links = await sql<
      any[]
    >`select artifact_type,artifact_id from project_operations.project_artifact_links where tenant_id=${tenantId} and project_id=${projectId}`;
    for (const link of links) {
      const existing = await this.resolveArtifactFrom(sql, {
        tenantId,
        artifactType: link.artifact_type,
        artifactId: link.artifact_id
      });
      if (!existing) continue;
      for (const key of ["designProjectId", "designBriefId", "formulaId"] as const) {
        const a = existing.lineage[key];
        const b = candidate.lineage[key];
        if (a && b && a !== b)
          throw new ProjectOperationsProblem(
            409,
            "PROJECT_ARTIFACT_LINEAGE_MISMATCH",
            "Artifact belongs to a different canonical development lineage."
          );
      }
    }
  }
  private async assertLine(sql: Db, tenantId: string, p: any, line: string) {
    const r =
      await sql`select 1 from lab_services.service_order_lines where tenant_id=${tenantId} and service_order_id=${p.source_service_order_id} and id=${line}`;
    if (!r[0])
      throw new ProjectOperationsProblem(
        409,
        "PROJECT_TASK_SOURCE_SCOPE_INVALID",
        "Task source scope is invalid."
      );
  }
  private async assertScope(sql: Db, tenantId: string, p: any, tasks: any[], done: boolean) {
    if (p.project_type !== "CLIENT_SERVICE") return;
    await this.assertSourceLive(sql, tenantId, p);
    const lines = await sql<
      any[]
    >`select id from lab_services.service_order_lines where tenant_id=${tenantId} and service_order_id=${p.source_service_order_id}`;
    for (const l of lines)
      if (
        !tasks.some(
          (t) =>
            t.source_service_order_line_id === l.id &&
            t.required &&
            t.status !== "CANCELLED" &&
            (!done || t.status === "DONE")
        )
      )
        throw new ProjectOperationsProblem(
          409,
          "PROJECT_SCOPE_NOT_COVERED",
          "Every Service Order line needs required operational work."
        );
  }
}
export const createPostgresProjectOperationsStore = (sql: Sql): ProjectOperationsStore =>
  new PostgresProjectOperationsStore(sql);
