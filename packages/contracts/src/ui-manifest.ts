import { z } from "zod";

// DESIGN.md §92: presentation metadata, never a permission or workflow authority.
const text = z.string().trim().min(1);
const texts = z.array(text);
const permission = text.refine((value) => !value.includes("*"), "Wildcard permission is forbidden");
const read = z.strictObject({
  kind: z.literal("read"),
  canonicalCommandId: text,
  commandOwner: text,
  permission,
  tenantBindingRef: text,
  errorCodes: texts
});
const mutation = z.strictObject({
  kind: z.literal("mutation"),
  canonicalCommandId: text,
  commandOwner: text,
  permission,
  targetObjectRef: text,
  targetVersionSource: text,
  guardRefs: texts.min(1),
  confirmation: z.enum(["required", "canonical-reversible-action"]),
  consequence: text,
  auditConsequence: text,
  auditEventRef: text,
  successDestination: text,
  successStateSource: text,
  idempotency: z.strictObject({
    mode: z.enum(["keyed-server-replay", "documented-server-uniqueness"]),
    contractRef: text
  }),
  errorCodes: texts
});
export const gateUiManifestSchema = z
  .strictObject({
    schemaVersion: z.literal("1.0"),
    status: z.enum(["READY", "BLOCKED"]),
    screenId: text,
    gateId: z.enum([
      "G0",
      "G1",
      "G2",
      "G3",
      "G4",
      "G5",
      "G6",
      "G7",
      "G8",
      "G9",
      "G10",
      "G11",
      "G12",
      "G13",
      "G14"
    ]),
    route: text.refine((value) => value.startsWith("/"), "Runtime route must be absolute"),
    routeStateSelector: z.strictObject({ canonicalSource: text, value: text }).optional(),
    module: text,
    userJob: text,
    contractRefs: z.array(z.strictObject({ document: text, version: text, section: text })).min(1),
    visualRefs: z
      .array(
        z.strictObject({
          sourceType: z.enum(["figma", "stitch", "screenshot", "none"]),
          id: text,
          version: text,
          approvalStatus: z.enum(["approved", "visual-reference-only", "none"]),
          theme: z.enum(["dark", "light"]).optional(),
          density: z.enum(["compact", "default", "comfortable"]).optional(),
          viewport: text.optional(),
          fixture: text.optional()
        })
      )
      .min(1),
    canonicalObject: text,
    domainOwner: text,
    relationships: texts,
    entryEvidence: texts,
    currentPhaseSource: text,
    blockersSource: text,
    nextActionSource: text,
    routeAccess: z.strictObject({
      tenantBindingRef: text,
      readPermission: permission,
      entitlementRef: text.optional()
    }),
    query: z.strictObject({
      source: text,
      tenantBindingRef: text,
      readPermission: permission,
      cacheIsolationRef: text
    }),
    serverGuardSource: text,
    template: z.enum([
      "index",
      "entity",
      "studio",
      "workflow",
      "operations",
      "settings",
      "analytics"
    ]),
    canvasMode: z.enum(["instrument", "atelier", "sensory", "review", "operations"]),
    density: z.enum(["compact", "default", "comfortable"]),
    interaction: z.strictObject({
      supported: z.array(z.enum(["pointer", "touch"])).min(1),
      default: z.enum(["pointer", "touch"]),
      touchOverride: z.enum([
        "coarse-pointer",
        "user-preference",
        "coarse-pointer-or-user-preference",
        "none"
      ])
    }),
    openableEntities: z.array(
      z.strictObject({
        entityType: text,
        routeRef: text,
        tenantBindingRef: text,
        readPermission: permission
      })
    ),
    localStages: texts.optional(),
    inspectorTabs: z.array(
      z.enum(["Overview", "Properties", "Evidence", "Inventory", "Validation", "History"])
    ),
    commands: z.array(z.discriminatedUnion("kind", [read, mutation])),
    guardRefs: texts,
    handoffInputs: texts,
    handoffOutputs: texts,
    stateFixtures: texts,
    unknowns: z.array(
      z.strictObject({
        id: text,
        concern: text,
        owner: text,
        contractNeeded: text,
        blocksMutations: z.literal(true)
      })
    ),
    contentSecurityRefs: texts,
    mobile: z.discriminatedUnion("policy", [
      z.strictObject({
        policy: z.enum(["full", "task-priority", "review-only"]),
        priority: texts.min(1)
      }),
      z.strictObject({ policy: z.literal("unsupported"), reason: text })
    ]),
    forbiddenBehavior: texts
  })
  .superRefine((manifest, context) => {
    if (manifest.status === "READY" && manifest.unknowns.length)
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "READY cannot contain UNKNOWN concerns"
      });
    if (!manifest.interaction.supported.includes(manifest.interaction.default))
      context.addIssue({
        code: "custom",
        path: ["interaction"],
        message: "Default interaction must be supported"
      });
    const commands = new Set<string>();
    manifest.commands.forEach((command, index) => {
      const key = `${command.kind}:${command.canonicalCommandId}`;
      if (commands.has(key))
        context.addIssue({
          code: "custom",
          path: ["commands", index],
          message: "Duplicate command"
        });
      commands.add(key);
    });
  });

export type GateUIManifest = z.infer<typeof gateUiManifestSchema>;
export type RuntimeScreenEntry = Pick<GateUIManifest, "screenId" | "route" | "routeStateSelector">;

/** Release verification; callers must supply the actual runtime screen inventory. */
export function validateScreenManifestCoverage(
  entries: readonly RuntimeScreenEntry[],
  input: readonly unknown[],
  requireReady = true
): string[] {
  const errors: string[] = [];
  const manifests: GateUIManifest[] = [];
  for (const value of input) {
    const parsed = gateUiManifestSchema.safeParse(value);
    if (!parsed.success) {
      errors.push(`Invalid manifest: ${parsed.error.message}`);
      continue;
    }
    manifests.push(parsed.data);
  }
  const signature = (entry: RuntimeScreenEntry) =>
    JSON.stringify([
      entry.route,
      entry.routeStateSelector?.canonicalSource ?? null,
      entry.routeStateSelector?.value ?? null
    ]);
  const ids = new Set<string>(),
    states = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.screenId)) errors.push(`Duplicate runtime Screen ID: ${entry.screenId}`);
    if (states.has(signature(entry))) errors.push(`Ambiguous runtime route/state: ${entry.route}`);
    ids.add(entry.screenId);
    states.add(signature(entry));
    const matches = manifests.filter(
      (manifest) => manifest.screenId === entry.screenId && signature(manifest) === signature(entry)
    );
    if (matches.length !== 1)
      errors.push(`Expected exactly one matching manifest: ${entry.screenId}`);
    else if (requireReady && matches[0]!.status !== "READY")
      errors.push(`Screen not READY: ${entry.screenId}`);
  }
  for (const manifest of manifests) {
    if (
      !entries.some(
        (entry) => entry.screenId === manifest.screenId && signature(entry) === signature(manifest)
      )
    )
      errors.push(`Manifest has no runtime entry: ${manifest.screenId}`);
    const siblings = manifests.filter((other) => other.route === manifest.route);
    if (
      siblings.length > 1 &&
      siblings.some(
        (other) =>
          !other.routeStateSelector ||
          other.routeStateSelector.canonicalSource !== manifest.routeStateSelector?.canonicalSource
      )
    )
      errors.push(`Shared route requires one deterministic selector source: ${manifest.route}`);
  }
  return [...new Set(errors)];
}
