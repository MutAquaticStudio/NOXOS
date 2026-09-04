import { z } from "zod";

export const projectUuidSchema = z.string().uuid();
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
export const projectTypeSchema = z.enum(["CLIENT_SERVICE", "INTERNAL"]);
export const projectStatusSchema = z.enum(["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]);
export const projectPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
export const phaseKeySchema = z.enum([
  "BRIEF",
  "DESIGN",
  "TRIAL",
  "SENSORY",
  "READINESS",
  "PRODUCTION",
  "QC_RELEASE"
]);
export const taskKindSchema = z.enum(["TASK", "MILESTONE"]);
export const taskStatusSchema = z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]);
export const artifactTypeSchema = z.enum([
  "DESIGN_PROJECT",
  "DESIGN_BRIEF",
  "FORMULA_VERSION",
  "TRIAL",
  "SENSORY_EVALUATION",
  "READINESS_ASSESSMENT",
  "PRODUCTION_ORDER",
  "PRODUCTION_BATCH",
  "QC_INSPECTION",
  "BATCH_RELEASE_DECISION"
]);
export const artifactRelationshipSchema = z.enum(["PRIMARY", "OUTPUT", "EVIDENCE", "REFERENCE"]);
export const updateTypeSchema = z.enum([
  "PROGRESS",
  "BLOCKER",
  "BLOCKER_RESOLVED",
  "DECISION",
  "NOTE"
]);

const dates = z
  .object({
    targetStartDate: z.string().date().nullable().optional(),
    targetCompletionDate: z.string().date().nullable().optional()
  })
  .refine(
    (x) =>
      !x.targetStartDate || !x.targetCompletionDate || x.targetStartDate <= x.targetCompletionDate,
    "PROJECT_DATE_RANGE_INVALID"
  );
export const createProjectSchema = z.discriminatedUnion("projectType", [
  z
    .object({
      projectType: z.literal("CLIENT_SERVICE"),
      projectCode: text(80),
      name: text(200),
      description: optionalText(4000),
      sourceServiceOrderId: projectUuidSchema,
      ownerUserId: projectUuidSchema,
      priority: projectPrioritySchema.optional().default("NORMAL"),
      ...dates.shape
    })
    .strict(),
  z
    .object({
      projectType: z.literal("INTERNAL"),
      projectCode: text(80),
      name: text(200),
      description: optionalText(4000),
      ownerUserId: projectUuidSchema,
      priority: projectPrioritySchema.optional().default("NORMAL"),
      ...dates.shape
    })
    .strict()
]);
export const updateProjectSchema = z
  .object({
    name: text(200).optional(),
    description: optionalText(4000),
    ownerUserId: projectUuidSchema.optional(),
    priority: projectPrioritySchema.optional(),
    targetStartDate: z.string().date().nullable().optional(),
    targetCompletionDate: z.string().date().nullable().optional()
  })
  .strict()
  .refine((x) => Object.keys(x).length > 0);
export const phasePlanSchema = z
  .object({
    phaseKey: phaseKeySchema,
    phaseOrder: z.number().int().positive(),
    required: z.boolean(),
    ownerUserId: projectUuidSchema.nullable().optional(),
    plannedStartDate: z.string().date().nullable().optional(),
    plannedDueDate: z.string().date().nullable().optional(),
    notes: optionalText(4000)
  })
  .strict();
export const phasePlansSchema = z
  .object({ phases: z.array(phasePlanSchema).max(7) })
  .strict()
  .superRefine((value, context) => {
    const phaseKeys = new Set<string>();
    const phaseOrders = new Set<number>();
    for (const phase of value.phases) {
      if (phaseKeys.has(phase.phaseKey))
        context.addIssue({ code: "custom", message: "PROJECT_PHASE_DUPLICATE_KEY" });
      if (phaseOrders.has(phase.phaseOrder))
        context.addIssue({ code: "custom", message: "PROJECT_PHASE_DUPLICATE_ORDER" });
      phaseKeys.add(phase.phaseKey);
      phaseOrders.add(phase.phaseOrder);
    }
  });
export const createTaskSchema = z
  .object({
    phasePlanId: projectUuidSchema.nullable().optional(),
    sourceServiceOrderLineId: projectUuidSchema.nullable().optional(),
    taskKind: taskKindSchema,
    title: text(300),
    description: optionalText(4000),
    priority: projectPrioritySchema.optional().default("NORMAL"),
    required: z.boolean().optional().default(false),
    assigneeUserId: projectUuidSchema.nullable().optional(),
    dueDate: z.string().date().nullable().optional()
  })
  .strict();
export const updateTaskSchema = z
  .object({
    title: text(300).optional(),
    description: optionalText(4000),
    priority: projectPrioritySchema.optional(),
    required: z.boolean().optional(),
    assigneeUserId: projectUuidSchema.nullable().optional(),
    dueDate: z.string().date().nullable().optional(),
    phasePlanId: projectUuidSchema.nullable().optional(),
    sourceServiceOrderLineId: projectUuidSchema.nullable().optional()
  })
  .strict()
  .refine((x) => Object.keys(x).length > 0);
export const reasonSchema = z.object({ reason: text(2000) }).strict();
export const createDependencySchema = z.object({ predecessorTaskId: projectUuidSchema }).strict();
export const createArtifactLinkSchema = z
  .object({
    phasePlanId: projectUuidSchema.nullable().optional(),
    artifactType: artifactTypeSchema,
    artifactId: projectUuidSchema,
    relationship: artifactRelationshipSchema
  })
  .strict();
export const createUpdateSchema = z
  .object({
    phasePlanId: projectUuidSchema.nullable().optional(),
    taskId: projectUuidSchema.nullable().optional(),
    updateType: updateTypeSchema,
    summary: text(4000),
    resolvesUpdateId: projectUuidSchema.nullable().optional()
  })
  .strict()
  .superRefine((x, c) => {
    if ((x.updateType === "BLOCKER_RESOLVED") !== Boolean(x.resolvesUpdateId))
      c.addIssue({ code: "custom", message: "PROJECT_BLOCKER_RESOLUTION_INVALID" });
  });

export type ProjectType = z.infer<typeof projectTypeSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type PhaseKey = z.infer<typeof phaseKeySchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskKind = z.infer<typeof taskKindSchema>;
export type ProjectArtifactType = z.infer<typeof artifactTypeSchema>;
export type ProjectCommandContext = {
  tenantId: string;
  actorUserId: string;
  requestId: string;
  correlationId: string;
};
export type ProjectArtifactReference = {
  type: ProjectArtifactType;
  artifactId: string;
  tenantId: string;
  label: string;
  canonicalStatus: string;
  lineage: Record<string, string | undefined>;
};
export interface ProjectArtifactSource {
  resolveArtifact(input: {
    tenantId: string;
    artifactType: ProjectArtifactType;
    artifactId: string;
  }): Promise<ProjectArtifactReference | undefined>;
}
export type ProjectOperationsCommercialProjection = {
  projectId: string;
  projectCode: string;
  projectType: ProjectType;
  status: ProjectStatus;
  sourceServiceOrderId: string | null;
  requiredTaskCount: number;
  completedRequiredTaskCount: number;
  requiredPhases: readonly { phaseKey: PhaseKey; state: string }[];
};
