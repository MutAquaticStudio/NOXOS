import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  formatMassMg,
  type AccordArchitecturePlan,
  type AccordSuggestion,
  type DesignWorkflowMode,
  type FormulaCandidate,
  type IntentDraft,
  type NormalizedOlfactoryIntent,
  type OsmoTaxonomyAssignmentType
} from "@nox-os/design-studio/browser";
import type { ApiClient } from "./platform-control";

const READ = "module.design-studio.studio.read";
const MANAGE_BRIEF = "module.design-studio.brief.manage";
const CONFIRM_INTENT = "module.design-studio.intent.confirm";
const GENERATE_FORMULA = "module.design-studio.formula.generate";
const PLAN_ACCORD = "module.design-studio.accord.plan";
const DEVELOP_ACCORD = "module.design-studio.accord.develop";
const FREEZE_FORMULA = "module.design-studio.formula.freeze";

type TaxonomyChoice = {
  assignmentType: OsmoTaxonomyAssignmentType;
  taxonomyTerm: string;
};
type AssetReference = {
  assetId: string;
  sourceName: string;
  modality: "IMAGE" | "REFERENCE";
};
type FrozenFormula = {
  formulaVersionId: string;
  name: string;
  bundleHash: string;
  frozenAt: string;
  candidate: FormulaCandidate;
};

function has(permissions: readonly string[], permission: string): boolean {
  return permissions.includes(permission);
}
function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The Design Studio operation failed.";
}
function taxonomyKey(value: TaxonomyChoice): string {
  return `${value.assignmentType}:${value.taxonomyTerm}`;
}
function fileBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 32_768) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
    }
    return btoa(binary);
  });
}

function PermissionDenied() {
  return (
    <section className="nox-design-empty" aria-labelledby="design-denied-title">
      <p className="nox-ai-context">403 · PERMISSION_DENIED</p>
      <h1 id="design-denied-title">Design Studio access denied</h1>
      <p>The current tenant context does not grant Design Studio access.</p>
    </section>
  );
}

function WorkflowChooser({ onChoose }: { onChoose: (mode: DesignWorkflowMode) => void }) {
  return (
    <section className="nox-design-entry" aria-labelledby="design-entry-title">
      <p className="nox-ai-context">DESIGN STUDIO</p>
      <h1 id="design-entry-title">What do you want to create?</h1>
      <p>Turn a confirmed olfactory direction into one inspectable, governed design artifact.</p>
      <div className="nox-design-workflow-grid">
        <button type="button" onClick={() => onChoose("FORMULA_GENERATION")}>
          <strong>Complete Formula</strong>
          <span>Build bounded, deterministic Material directions for comparison.</span>
        </button>
        <button type="button" onClick={() => onChoose("ACCORD_ARCHITECTURE")}>
          <strong>Plan Accord Architecture</strong>
          <span>Shape roles, phases and relationships before choosing Materials.</span>
        </button>
      </div>
    </section>
  );
}

function IntentReview({
  draft,
  onChange,
  onConfirm,
  canConfirm
}: {
  draft: IntentDraft;
  onChange: (intent: NormalizedOlfactoryIntent) => void;
  onConfirm: () => void;
  canConfirm: boolean;
}) {
  const remove = (key: "required" | "preferred" | "excluded" | "inferred", index: number) =>
    onChange({ ...draft.intent, [key]: draft.intent[key].filter((_, item) => item !== index) });
  return (
    <section className="nox-design-panel" aria-labelledby="intent-review-title">
      <p className="nox-ai-context">HUMAN REVIEW REQUIRED</p>
      <h2 id="intent-review-title">Intent Review</h2>
      <p>{draft.intent.rawBriefSummary}</p>
      {(["required", "preferred", "excluded"] as const).map((group) => (
        <div key={group}>
          <strong>{group.toUpperCase()}</strong>
          <ul className="nox-design-token-list">
            {draft.intent[group].map((target, index) => (
              <li key={`${group}:${target.assignmentType}:${target.taxonomyTerm}`}>
                <span>
                  {target.assignmentType} · {target.taxonomyTerm}
                </span>
                <button type="button" onClick={() => remove(group, index)}>
                  Remove
                </button>
              </li>
            ))}
            {draft.intent[group].length === 0 ? <li>None</li> : null}
          </ul>
        </div>
      ))}
      <div>
        <strong>INFERRED SOURCE SIGNALS</strong>
        <ul className="nox-design-token-list">
          {draft.intent.inferred.map((target, index) => (
            <li key={`inferred:${target.assignmentType}:${target.taxonomyTerm}`}>
              <span>
                {target.assignmentType} · {target.taxonomyTerm}
              </span>
              <button
                type="button"
                onClick={() => {
                  const inferred = draft.intent.inferred.filter((_, item) => item !== index);
                  onChange({
                    ...draft.intent,
                    inferred,
                    preferred: [...draft.intent.preferred, target]
                  });
                }}
              >
                Accept
              </button>
              <button type="button" onClick={() => remove("inferred", index)}>
                Reject
              </button>
            </li>
          ))}
          {draft.intent.inferred.length === 0 ? <li>None</li> : null}
        </ul>
      </div>
      <div>
        <strong>UNRESOLVED CONCEPTS</strong>
        <ul className="nox-design-token-list">
          {draft.intent.unresolvedConcepts.map((concept, index) => (
            <li key={concept}>
              <span>{concept}</span>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...draft.intent,
                    unresolvedConcepts: draft.intent.unresolvedConcepts.filter(
                      (_, item) => item !== index
                    )
                  })
                }
              >
                Resolve manually
              </button>
            </li>
          ))}
          {draft.intent.unresolvedConcepts.length === 0 ? <li>None</li> : null}
        </ul>
      </div>
      <p className="nox-design-muted">Taxonomy authority: OSMO · osmo_v1.2</p>
      <button type="button" onClick={onConfirm} disabled={!canConfirm}>
        Confirm Intent
      </button>
      {!canConfirm ? <p role="alert">Intent confirmation permission is required.</p> : null}
    </section>
  );
}

function AccordPlanView({
  plan,
  canDevelop,
  onChange,
  onSave,
  onReload,
  onDevelop,
  onBuildComplete
}: {
  plan: AccordArchitecturePlan;
  canDevelop: boolean;
  onChange: (plan: AccordArchitecturePlan) => void;
  onSave: () => void;
  onReload: () => void;
  onDevelop: (accordKey: string) => void;
  onBuildComplete: () => void;
}) {
  const allTargets = [
    ...plan.intentSnapshot.required,
    ...plan.intentSnapshot.preferred,
    ...plan.intentSnapshot.inferred
  ];
  const patchAccord = (index: number, update: Partial<AccordSuggestion>) =>
    onChange({
      ...plan,
      accords: plan.accords.map((accord, item) =>
        item === index ? { ...accord, ...update } : accord
      )
    });
  return (
    <section className="nox-design-plan" aria-labelledby="accord-plan-title">
      <header>
        <p className="nox-ai-context">ACCORD ARCHITECTURE · MATERIAL-FREE</p>
        <h2 id="accord-plan-title">Primary architecture plan</h2>
        <p>
          Planner: {plan.plannerVersion}. Materials remain hidden until an explicit development
          action.
        </p>
      </header>
      <div className="nox-design-accord-grid">
        {plan.accords.map((accord, index) => (
          <article key={accord.accordKey} tabIndex={0}>
            <label>
              Accord name
              <input
                value={accord.label}
                onChange={(event) => patchAccord(index, { label: event.target.value })}
              />
            </label>
            <div className="nox-design-inline">
              <label>
                Phase
                <select
                  value={accord.phase}
                  onChange={(event) =>
                    patchAccord(index, { phase: event.target.value as AccordSuggestion["phase"] })
                  }
                >
                  {(["TOP", "MID", "BASE", "CROSS_PHASE"] as const).map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Role
                <select
                  value={accord.functionalRole}
                  onChange={(event) =>
                    patchAccord(index, {
                      functionalRole: event.target.value as AccordSuggestion["functionalRole"]
                    })
                  }
                >
                  {(["CORE", "SUPPORT", "BRIDGE", "CONTRAST", "FOUNDATION"] as const).map(
                    (value) => (
                      <option key={value}>{value}</option>
                    )
                  )}
                </select>
              </label>
            </div>
            <p>{accord.purpose}</p>
            <ul className="nox-design-token-list">
              {accord.taxonomyTargets.map((target, targetIndex) => (
                <li key={`${target.assignmentType}:${target.taxonomyTerm}`}>
                  <span>
                    {target.assignmentType} · {target.taxonomyTerm}
                  </span>
                  <button
                    type="button"
                    disabled={accord.taxonomyTargets.length === 1}
                    onClick={() =>
                      patchAccord(index, {
                        taxonomyTargets: accord.taxonomyTargets.filter(
                          (_, item) => item !== targetIndex
                        )
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <select
              aria-label={`Add taxonomy target to ${accord.label}`}
              value=""
              onChange={(event) => {
                const target = allTargets.find(
                  (value) => taxonomyKey(value) === event.target.value
                );
                if (
                  target &&
                  !accord.taxonomyTargets.some(
                    (value) => taxonomyKey(value) === taxonomyKey(target)
                  )
                )
                  patchAccord(index, {
                    taxonomyTargets: [...accord.taxonomyTargets, target]
                  });
              }}
            >
              <option value="">Add confirmed target…</option>
              {allTargets.map((target) => (
                <option key={taxonomyKey(target)} value={taxonomyKey(target)}>
                  {target.assignmentType} · {target.taxonomyTerm}
                </option>
              ))}
            </select>
            <div className="nox-table-actions">
              <button
                type="button"
                disabled={!canDevelop}
                onClick={() => onDevelop(accord.accordKey)}
              >
                Develop This Accord
              </button>
              <button
                type="button"
                disabled={plan.accords.length === 1}
                onClick={() => {
                  const remaining = plan.accords
                    .filter((_, item) => item !== index)
                    .map((value) => ({
                      ...value,
                      supportsAccordKeys: value.supportsAccordKeys.filter(
                        (key) => key !== accord.accordKey
                      ),
                      contrastsAccordKeys: value.contrastsAccordKeys.filter(
                        (key) => key !== accord.accordKey
                      )
                    }));
                  onChange({ ...plan, accords: remaining });
                }}
              >
                Remove
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="nox-table-actions">
        <button
          type="button"
          disabled={plan.accords.length >= 7 || allTargets.length === 0}
          onClick={() => {
            const used = new Set(plan.accords.map((accord) => accord.accordKey));
            let sequence = 1;
            while (used.has(`custom-accord-${sequence}`)) sequence += 1;
            const target = allTargets[0];
            onChange({
              ...plan,
              accords: [
                ...plan.accords,
                {
                  accordKey: `custom-accord-${sequence}`,
                  label: `Custom Accord ${sequence}`,
                  phase: "CROSS_PHASE",
                  functionalRole: "SUPPORT",
                  purpose: "Support the confirmed olfactory direction.",
                  taxonomyTargets: [target],
                  required: false,
                  supportsAccordKeys: [],
                  contrastsAccordKeys: [],
                  excludedConflicts: [],
                  provenance: []
                }
              ]
            });
          }}
        >
          Add Custom Accord
        </button>
        <button type="button" onClick={onSave}>
          Save Accord Plan
        </button>
        <button type="button" onClick={onReload}>
          Reload Saved Plan
        </button>
        <button type="button" disabled={!canDevelop} onClick={onBuildComplete}>
          Build Complete Formula
        </button>
      </div>
    </section>
  );
}

function FormulaCandidates({
  candidates,
  selected,
  onSelect,
  onFreeze,
  canFreeze
}: {
  candidates: FormulaCandidate[];
  selected: number;
  onSelect: (index: number) => void;
  onFreeze: () => void;
  canFreeze: boolean;
}) {
  const candidate = candidates[selected];
  return (
    <section className="nox-design-plan" aria-labelledby="formula-candidates-title">
      <p className="nox-ai-context">HUMAN SELECTION REQUIRED</p>
      <h2 id="formula-candidates-title">Formula candidates</h2>
      <div className="nox-design-candidate-tabs" role="tablist" aria-label="Formula directions">
        {candidates.map((value, index) => (
          <button
            type="button"
            role="tab"
            aria-selected={selected === index}
            key={value.candidateId}
            onClick={() => onSelect(index)}
          >
            {value.generationStrategy}
          </button>
        ))}
      </div>
      <div className="nox-table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>kg / g / mg</th>
              <th>%</th>
              <th>Active</th>
              <th>Carrier</th>
              <th>Phase</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {candidate.lines.map((line) => (
              <tr key={line.materialId}>
                <td>
                  <details>
                    <summary>{line.materialSnapshot.material.displayName}</summary>
                    <dl className="nox-design-intent-list">
                      <div>
                        <dt>Type</dt>
                        <dd>{line.materialSnapshot.material.materialType}</dd>
                      </div>
                      <div>
                        <dt>Approval</dt>
                        <dd>{line.materialSnapshot.material.approvalStatus}</dd>
                      </div>
                      <div>
                        <dt>Identity</dt>
                        <dd>
                          {Object.values(line.materialSnapshot.identifiers).flat().join(", ") ||
                            "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Olfactive</dt>
                        <dd>
                          {line.materialSnapshot.odorAssignments
                            .map((item) => item.taxonomyTerm)
                            .join(", ") || "—"}
                        </dd>
                      </div>
                    </dl>
                  </details>
                </td>
                <td>{formatMassMg(line.normalizedMassMg)}</td>
                <td>{(Number(line.normalizedMassMg) / 10_000).toFixed(4)}%</td>
                <td>{formatMassMg(line.activeAromaticMassMg)}</td>
                <td>{formatMassMg(line.carrierSolventMassMg)}</td>
                <td>{line.materialSnapshot.material.noteClassification ?? "CROSS_PHASE"}</td>
                <td>
                  {line.contributionEvidence.map((value) => value.target.taxonomyTerm).join(", ") ||
                    "No matched target"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="nox-design-warning" role="status">
        {candidate.validation.warnings.join(" · ") || "No preliminary warnings"} · Known-limit
        screening: {candidate.validation.knownLimitScreening} · Release readiness: NOT_ASSESSED
      </div>
      <p className="nox-design-muted">
        Scientific capability: {candidate.scientificContext.capability}. Deterministic baseline;
        human-perception validity is not claimed.
      </p>
      <button type="button" disabled={!canFreeze} onClick={onFreeze}>
        Use This Formula
      </button>
    </section>
  );
}

function FrozenFormulaView({ value, onTrial }: { value: FrozenFormula; onTrial: () => void }) {
  return (
    <section className="nox-design-plan" aria-labelledby="frozen-formula-title">
      <p className="nox-ai-context">FROZEN · NOT APPROVED</p>
      <h2 id="frozen-formula-title">{value.name}</h2>
      <dl className="nox-design-intent-list">
        <div>
          <dt>Version</dt>
          <dd>{value.formulaVersionId}</dd>
        </div>
        <div>
          <dt>Bundle hash</dt>
          <dd>
            <code>{value.bundleHash}</code>
          </dd>
        </div>
        <div>
          <dt>Frozen</dt>
          <dd>{new Date(value.frozenAt).toLocaleString()}</dd>
        </div>
      </dl>
      <p>
        Composition and Material snapshots are immutable. Approval remains a separate evidence
        transition.
      </p>
      <button type="button" onClick={onTrial}>
        Create Trial handoff
      </button>
    </section>
  );
}

export function DesignStudioExperience({
  api,
  tenantId,
  modulePermissions
}: {
  api: ApiClient;
  tenantId?: string;
  modulePermissions: readonly string[];
}) {
  const [mode, setMode] = useState<DesignWorkflowMode>();
  const [projectName, setProjectName] = useState("New Design Project");
  const [brief, setBrief] = useState("");
  const [applicationKey, setApplicationKey] = useState("fine-fragrance");
  const [dosage, setDosage] = useState(20);
  const [taxonomyChoices, setTaxonomyChoices] = useState<TaxonomyChoice[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [assets, setAssets] = useState<AssetReference[]>([]);
  const [draft, setDraft] = useState<IntentDraft>();
  const [briefId, setBriefId] = useState<string>();
  const [plan, setPlan] = useState<AccordArchitecturePlan>();
  const [candidates, setCandidates] = useState<FormulaCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState(0);
  const [generationOptions, setGenerationOptions] = useState<{
    accordKey?: string;
    buildCompleteFromAccords?: boolean;
  }>({});
  const [frozen, setFrozen] = useState<FrozenFormula>();
  const [trialReady, setTrialReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!tenantId || !has(modulePermissions, READ)) return;
    void api<{
      taxonomy: {
        GRAND_FAMILIES: string[];
        SUBFAMILIES: string[];
        DESCRIPTORS: string[];
        TEXTURES: string[];
        SENSATIONS: string[];
      };
    }>("/materials/taxonomy?version=1.2", { tenantId })
      .then(({ taxonomy }) => {
        const choices: TaxonomyChoice[] = [
          ...taxonomy.GRAND_FAMILIES.map((taxonomyTerm) => ({
            assignmentType: "GRAND_FAMILY" as const,
            taxonomyTerm
          })),
          ...taxonomy.SUBFAMILIES.map((taxonomyTerm) => ({
            assignmentType: "SUBFAMILY" as const,
            taxonomyTerm
          })),
          ...taxonomy.DESCRIPTORS.map((taxonomyTerm) => ({
            assignmentType: "DESCRIPTOR" as const,
            taxonomyTerm
          })),
          ...taxonomy.TEXTURES.map((taxonomyTerm) => ({
            assignmentType: "TEXTURE" as const,
            taxonomyTerm
          })),
          ...taxonomy.SENSATIONS.map((taxonomyTerm) => ({
            assignmentType: "SENSATION" as const,
            taxonomyTerm
          }))
        ];
        setTaxonomyChoices(choices);
        setSelectedKey((current) => current || (choices[0] ? taxonomyKey(choices[0]) : ""));
      })
      .catch((reason) => setError(message(reason)));
  }, [api, tenantId, modulePermissions]);

  const selectedTaxonomy = useMemo(
    () => taxonomyChoices.find((choice) => taxonomyKey(choice) === selectedKey),
    [taxonomyChoices, selectedKey]
  );
  if (!tenantId)
    return (
      <section className="nox-design-empty">
        <h1>Select an active tenant workspace</h1>
      </section>
    );
  if (!has(modulePermissions, READ)) return <PermissionDenied />;
  if (!mode) return <WorkflowChooser onChoose={setMode} />;

  const uploadAsset = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setWorking(true);
    setError(undefined);
    try {
      const payload = await api<{ asset: AssetReference }>("/design-studio/assets", {
        method: "POST",
        tenantId,
        body: {
          sourceName: file.name,
          modality: file.type.startsWith("image/") ? "IMAGE" : "REFERENCE",
          mimeType: file.type || "application/octet-stream",
          contentsBase64: await fileBase64(file)
        }
      });
      setAssets((current) => [...current, payload.asset]);
    } catch (reason) {
      setError(`${message(reason)} Manual taxonomy mapping remains available.`);
    } finally {
      setWorking(false);
      event.target.value = "";
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTaxonomy) return;
    setWorking(true);
    setError(undefined);
    try {
      const project = await api<{ project: { id: string } }>("/design-studio/projects", {
        method: "POST",
        tenantId,
        body: { name: projectName, description: null }
      });
      const response = await api<{ brief: { id: string }; intentDraft: IntentDraft }>(
        `/design-studio/projects/${project.project.id}/briefs`,
        {
          method: "POST",
          tenantId,
          body: {
            workflowMode: mode,
            rawBrief: brief,
            applicationKey,
            targetDosagePct: dosage,
            explicitTags: [{ ...selectedTaxonomy, targetStrength: 1 }],
            explicitExclusions: excluded
              .map((key) => taxonomyChoices.find((choice) => taxonomyKey(choice) === key))
              .filter(Boolean),
            signals: [],
            assetReferences: assets
          }
        }
      );
      setBriefId(response.brief.id);
      setDraft(response.intentDraft);
      setPlan(undefined);
      setCandidates([]);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setWorking(false);
    }
  };

  const generate = async (
    options: { accordKey?: string; buildCompleteFromAccords?: boolean } = {}
  ) => {
    if (!briefId) return;
    setWorking(true);
    setError(undefined);
    try {
      const response = await api<{ candidates: FormulaCandidate[] }>(
        `/design-studio/briefs/${briefId}/generate`,
        { method: "POST", tenantId, body: { budget: { mode: "STANDARD" }, ...options } }
      );
      setGenerationOptions(options);
      setCandidates(response.candidates);
      setSelectedCandidate(0);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setWorking(false);
    }
  };

  const confirm = async () => {
    if (!draft || !briefId) return;
    setWorking(true);
    setError(undefined);
    try {
      await api(`/design-studio/briefs/${briefId}/confirm`, {
        method: "POST",
        tenantId,
        body: { intent: draft.intent }
      });
      if (mode === "ACCORD_ARCHITECTURE") {
        const response = await api<{ plan: AccordArchitecturePlan }>(
          `/design-studio/briefs/${briefId}/accord-plan`,
          { method: "POST", tenantId }
        );
        setPlan(response.plan);
      } else {
        await generate();
      }
    } catch (reason) {
      setError(message(reason));
    } finally {
      setWorking(false);
    }
  };

  const savePlan = async () => {
    if (!briefId || !plan) return;
    setWorking(true);
    try {
      const response = await api<{ plan: AccordArchitecturePlan }>(
        `/design-studio/briefs/${briefId}/accord-plan`,
        { method: "PUT", tenantId, body: { plan } }
      );
      setPlan(response.plan);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setWorking(false);
    }
  };

  const reloadPlan = async () => {
    if (!briefId) return;
    setWorking(true);
    setError(undefined);
    try {
      const response = await api<{
        brief: { accordArchitecturePlan?: AccordArchitecturePlan | null };
      }>(`/design-studio/briefs/${briefId}`, { tenantId });
      if (!response.brief.accordArchitecturePlan)
        throw new Error("No saved Accord plan is available for this brief.");
      setPlan(response.brief.accordArchitecturePlan);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setWorking(false);
    }
  };

  const freeze = async () => {
    if (!briefId || !candidates[selectedCandidate]) return;
    if (
      !window.confirm("Freeze this exact one-kilogram Formula and its current Material snapshots?")
    )
      return;
    setWorking(true);
    setError(undefined);
    try {
      const response = await api<{ formulaVersion: FrozenFormula }>(
        `/design-studio/briefs/${briefId}/freeze`,
        {
          method: "POST",
          tenantId,
          body: {
            budget: { mode: "STANDARD" },
            strategy: candidates[selectedCandidate].generationStrategy,
            formulaName: `${projectName} · ${candidates[selectedCandidate].generationStrategy}`,
            ...generationOptions
          }
        }
      );
      setFrozen(response.formulaVersion);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="nox-design-studio" aria-labelledby="design-studio-title">
      <header className="nox-design-header">
        <div>
          <button
            type="button"
            className="nox-design-back"
            onClick={() => {
              setMode(undefined);
              setDraft(undefined);
              setPlan(undefined);
              setCandidates([]);
              setFrozen(undefined);
            }}
          >
            ← Workflows
          </button>
          <p className="nox-ai-context">{mode.replaceAll("_", " ")}</p>
          <h1 id="design-studio-title">Design Studio</h1>
        </div>
        <div className="nox-design-reference-mass">
          <span>Reference Formula</span>
          <strong>{formatMassMg("1000000")}</strong>
        </div>
      </header>
      <div className="nox-design-layout">
        <form className="nox-design-panel" onSubmit={submit}>
          <h2>Brief Composer</h2>
          <label>
            Project name
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              required
            />
          </label>
          <label>
            Creative brief
            <textarea
              required
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Describe the direction, development and drydown…"
            />
          </label>
          <fieldset>
            <legend>Text / Image / Reference</legend>
            <input
              type="file"
              accept="image/*,.pdf,.txt"
              onChange={uploadAsset}
              disabled={working}
              aria-label="Upload private brief source"
            />
            <p className="nox-design-muted">
              Private provenance is preserved. If no interpreter is configured, manual taxonomy
              mapping remains authoritative.
            </p>
            <ul>
              {assets.map((asset) => (
                <li key={asset.assetId}>
                  {asset.modality} · {asset.sourceName}
                </li>
              ))}
            </ul>
          </fieldset>
          <label>
            Primary canonical direction
            <select
              value={selectedKey}
              onChange={(event) => setSelectedKey(event.target.value)}
              required
            >
              {taxonomyChoices.map((choice) => (
                <option key={taxonomyKey(choice)} value={taxonomyKey(choice)}>
                  {choice.assignmentType} · {choice.taxonomyTerm}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Explicit exclusions</legend>
            <select
              aria-label="Add explicit exclusion"
              value=""
              onChange={(event) =>
                event.target.value &&
                setExcluded((current) =>
                  current.includes(event.target.value) ? current : [...current, event.target.value]
                )
              }
            >
              <option value="">Add exclusion…</option>
              {taxonomyChoices.map((choice) => (
                <option key={taxonomyKey(choice)} value={taxonomyKey(choice)}>
                  {choice.assignmentType} · {choice.taxonomyTerm}
                </option>
              ))}
            </select>
            {excluded.map((key) => (
              <button
                type="button"
                key={key}
                onClick={() => setExcluded((current) => current.filter((value) => value !== key))}
              >
                {key} ×
              </button>
            ))}
          </fieldset>
          <div className="nox-design-inline">
            <label>
              Application
              <input
                value={applicationKey}
                onChange={(event) => setApplicationKey(event.target.value)}
              />
            </label>
            <label>
              Dosage %
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                value={dosage}
                onChange={(event) => setDosage(Number(event.target.value))}
              />
            </label>
          </div>
          <button type="submit" disabled={working || !has(modulePermissions, MANAGE_BRIEF)}>
            {working ? "Working…" : "Interpret Brief"}
          </button>
          {error ? (
            <p className="nox-design-warning" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <div className="nox-design-results">
          {frozen ? (
            <FrozenFormulaView
              value={frozen}
              onTrial={() => {
                setWorking(true);
                void api(
                  `/design-studio/formula-versions/${frozen.formulaVersionId}/trial-context`,
                  { method: "POST", tenantId }
                )
                  .then(() => setTrialReady(true))
                  .catch((reason) => setError(message(reason)))
                  .finally(() => setWorking(false));
              }}
            />
          ) : candidates.length > 0 ? (
            <FormulaCandidates
              candidates={candidates}
              selected={selectedCandidate}
              onSelect={setSelectedCandidate}
              onFreeze={freeze}
              canFreeze={has(modulePermissions, FREEZE_FORMULA) && !working}
            />
          ) : plan ? (
            <AccordPlanView
              plan={plan}
              canDevelop={
                has(modulePermissions, DEVELOP_ACCORD) && has(modulePermissions, GENERATE_FORMULA)
              }
              onChange={setPlan}
              onSave={savePlan}
              onReload={reloadPlan}
              onDevelop={(accordKey) => void generate({ accordKey })}
              onBuildComplete={() => void generate({ buildCompleteFromAccords: true })}
            />
          ) : draft ? (
            <IntentReview
              draft={draft}
              onChange={(intent) => setDraft({ ...draft, intent })}
              onConfirm={confirm}
              canConfirm={
                has(modulePermissions, CONFIRM_INTENT) &&
                (mode !== "ACCORD_ARCHITECTURE" || has(modulePermissions, PLAN_ACCORD)) &&
                !working
              }
            />
          ) : (
            <section className="nox-design-empty">
              <p className="nox-ai-context">AWAITING BRIEF</p>
              <h2>Interpret a direction</h2>
              <p>
                The Studio requires explicit human intent review before any Formula or Accord
                action.
              </p>
            </section>
          )}
          {trialReady ? (
            <p className="nox-design-warning" role="status">
              G5 TrialContext handoff prepared. No Trial was created in Gate 4.
            </p>
          ) : null}
        </div>
      </div>
      <footer className="nox-design-status" role="status">
        Scientific Context · CURATED_ONLY · Molecular augmentation unavailable unless a verified
        checkpoint/schema pair is loaded · Release readiness: NOT_ASSESSED
      </footer>
    </section>
  );
}
