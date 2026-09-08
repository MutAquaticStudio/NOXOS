import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode
} from "react";
import { matchPath, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { NoxDialog, useWorkspaceObject, useUnsavedChanges } from "@nox-os/ui";
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
import { resolveDevelopmentContext } from "./development-context";
import { compareCandidateLines } from "./candidate-diff";

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
  status: "FROZEN";
  approvalState: "NOT_APPROVED" | "APPROVED" | "SUPERSEDED";
  compositionKind: "FULL_FORMULA" | "ACCORD_FORMULATION";
  versionNumber: number;
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

export function FormulaCandidates({
  candidates,
  selected,
  onSelect,
  onFreeze,
  canFreeze,
  readOnly = false
}: {
  candidates: FormulaCandidate[];
  selected: number;
  onSelect: (index: number) => void;
  onFreeze: () => void | boolean | Promise<boolean>;
  canFreeze: boolean;
  readOnly?: boolean;
}) {
  const headingId = useId();
  const [showDiff, setShowDiff] = useState(false);
  const [baselineId, setBaselineId] = useState(candidates[0]?.candidateId);
  const [freezeTarget, setFreezeTarget] = useState<FormulaCandidate>();
  const [freezing, setFreezing] = useState(false);
  const freezeInFlight = useRef(false);
  const [freezeError, setFreezeError] = useState<string>();
  const candidate = candidates[selected];
  const baseline = candidates.find((value) => value.candidateId === baselineId) ?? candidates[0];
  const differences = useMemo(
    () => (baseline && candidate ? compareCandidateLines(baseline.lines, candidate.lines) : []),
    [baseline, candidate]
  );
  if (!candidate) return <p role="status">No candidate direction is available.</p>;
  const validForFreeze =
    canFreeze &&
    !readOnly &&
    candidate.validation.structuralValidation === "PASS" &&
    candidate.validation.materialEligibility === "PASS";
  const confirmFreeze = async () => {
    if (!validForFreeze || freezeTarget !== candidate || freezeInFlight.current) return;
    freezeInFlight.current = true;
    setFreezing(true);
    setFreezeError(undefined);
    try {
      const succeeded = await onFreeze();
      if (succeeded === false)
        setFreezeError(
          "Freeze was not confirmed by the server. Review the current result before retrying."
        );
      else setFreezeTarget(undefined);
    } catch {
      setFreezeError("Freeze did not complete. No successful result has been confirmed.");
    } finally {
      freezeInFlight.current = false;
      setFreezing(false);
    }
  };
  return (
    <section className="nox-design-plan" aria-labelledby={headingId}>
      <p className="nox-ai-context">HUMAN SELECTION REQUIRED</p>
      <h2 id={headingId}>Formula candidates</h2>
      <div className="nox-candidate-controls">
        <div className="nox-candidate-paging" aria-label="Candidate pages">
          <button
            type="button"
            aria-label="Previous direction"
            disabled={selected === 0}
            onClick={() => onSelect(selected - 1)}
          >
            ←
          </button>
          <span role="status">
            {selected + 1} / {candidates.length} · {candidate.generationStrategy}
          </span>
          <button
            type="button"
            aria-label="Next direction"
            disabled={selected === candidates.length - 1}
            onClick={() => onSelect(selected + 1)}
          >
            →
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={showDiff}
            onChange={(event) => setShowDiff(event.target.checked)}
          />{" "}
          Show composition differences
        </label>
        {showDiff && baseline ? (
          <label>
            Compare against
            <select
              value={baseline.candidateId}
              onChange={(event) => setBaselineId(event.target.value)}
            >
              {candidates.map((value) => (
                <option key={value.candidateId} value={value.candidateId}>
                  {value.generationStrategy}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div
        className="nox-table-wrap nox-candidate-comparison"
        tabIndex={0}
        role="region"
        aria-label="Candidate comparison"
      >
        <table>
          <caption>Compare returned directions — source values, not AI confidence scores</caption>
          <thead>
            <tr>
              <th scope="col">Property</th>
              {candidates.map((value) => (
                <th
                  scope="col"
                  key={value.candidateId}
                  data-selected={value.candidateId === candidate.candidateId}
                >
                  {value.generationStrategy}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                [
                  "Composition",
                  (value: FormulaCandidate) => value.compositionKind.replaceAll("_", " ")
                ],
                ["Materials", (value: FormulaCandidate) => String(value.lines.length)],
                [
                  "Structural validation",
                  (value: FormulaCandidate) => value.validation.structuralValidation
                ],
                [
                  "Material eligibility",
                  (value: FormulaCandidate) => value.validation.materialEligibility
                ],
                [
                  "Known-limit screening",
                  (value: FormulaCandidate) => value.validation.knownLimitScreening
                ],
                [
                  "Unresolved constraints",
                  (value: FormulaCandidate) =>
                    value.validation.unresolvedConstraints.join(" · ") || "None reported"
                ],
                ["Engine", (value: FormulaCandidate) => value.engineVersion],
                ["Taxonomy", (value: FormulaCandidate) => value.taxonomyVersion]
              ] as const
            ).map(([label, valueOf]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {candidates.map((value) => (
                  <td
                    key={value.candidateId}
                    data-selected={value.candidateId === candidate.candidateId}
                  >
                    {valueOf(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="nox-design-candidate-tabs" role="tablist" aria-label="Formula directions">
        {candidates.map((value, index) => (
          <button
            type="button"
            role="tab"
            id={`${headingId}-direction-${index}`}
            aria-controls={`${headingId}-composition`}
            tabIndex={selected === index ? 0 : -1}
            aria-selected={selected === index}
            key={value.candidateId}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % candidates.length
                  : event.key === "ArrowLeft"
                    ? (index + candidates.length - 1) % candidates.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? candidates.length - 1
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              onSelect(next);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                [next]?.focus();
            }}
          >
            {value.generationStrategy}
          </button>
        ))}
      </div>
      {showDiff && baseline ? (
        <section className="nox-candidate-diff" role="region" aria-label="Composition differences">
          <h3>
            {baseline.generationStrategy} → {candidate.generationStrategy}
          </h3>
          <p>Exact source mass and Material snapshot comparison. No mutation or quality score.</p>
          {differences.every((row) => row.state === "Unchanged") ? (
            <p>No composition differences.</p>
          ) : null}
          <ul>
            {differences
              .filter((row) => row.state !== "Unchanged")
              .map((row) => (
                <li key={row.materialId}>
                  <strong>
                    {(row.after ?? row.before)!.materialSnapshot.material.displayName}
                  </strong>{" "}
                  · {row.state}
                  <dl>
                    <div>
                      <dt>Mass</dt>
                      <dd>
                        {row.before ? formatMassMg(row.before.normalizedMassMg) : "Not present"} →{" "}
                        {row.after ? formatMassMg(row.after.normalizedMassMg) : "Not present"}
                      </dd>
                    </div>
                    <div>
                      <dt>Active</dt>
                      <dd>
                        {row.before ? formatMassMg(row.before.activeAromaticMassMg) : "—"} →{" "}
                        {row.after ? formatMassMg(row.after.activeAromaticMassMg) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Carrier</dt>
                      <dd>
                        {row.before ? formatMassMg(row.before.carrierSolventMassMg) : "—"} →{" "}
                        {row.after ? formatMassMg(row.after.carrierSolventMassMg) : "—"}
                      </dd>
                    </div>
                    {row.before &&
                    row.after &&
                    row.before.materialSnapshot.snapshotHash !==
                      row.after.materialSnapshot.snapshotHash ? (
                      <div>
                        <dt>Material evidence</dt>
                        <dd>Snapshot changed</dd>
                      </div>
                    ) : null}
                  </dl>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
      <div
        className="nox-table-wrap"
        tabIndex={0}
        role="tabpanel"
        id={`${headingId}-composition`}
        aria-labelledby={`${headingId}-direction-${selected}`}
      >
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
      {!readOnly ? (
        <div className="nox-candidate-action">
          <button
            type="button"
            disabled={!validForFreeze || freezing}
            onClick={() => {
              setFreezeError(undefined);
              setFreezeTarget(candidate);
            }}
          >
            {candidate.compositionKind === "ACCORD_FORMULATION"
              ? "Freeze & Lock"
              : "Use This Formula"}
          </button>
        </div>
      ) : (
        <p role="status">
          Previous response · read-only context. It cannot be frozen from this history view.
        </p>
      )}
      {freezeTarget && !readOnly ? (
        <NoxDialog
          title="Freeze exact Formula"
          onClose={() => {
            if (!freezing) setFreezeTarget(undefined);
          }}
        >
          <p>
            This creates an immutable FormulaVersion with frozen Material snapshots, lineage, hash
            and audit. It does not approve the Formula or create a Trial.
          </p>
          <dl className="nox-design-intent-list">
            <div>
              <dt>Direction</dt>
              <dd>{freezeTarget.generationStrategy}</dd>
            </div>
            <div>
              <dt>Candidate</dt>
              <dd>{freezeTarget.candidateId}</dd>
            </div>
            <div>
              <dt>Composition</dt>
              <dd>{freezeTarget.compositionKind.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Exact total</dt>
              <dd>
                {formatMassMg(
                  freezeTarget.lines
                    .reduce((mass, line) => mass + BigInt(line.normalizedMassMg), 0n)
                    .toString()
                )}
              </dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>New immutable version assigned by the server on success.</dd>
            </div>
          </dl>
          {freezeTarget !== candidate || !validForFreeze ? (
            <p role="alert">
              The selected candidate or its availability changed. Close and review the current
              result.
            </p>
          ) : null}
          {freezeError ? <p role="alert">{freezeError}</p> : null}
          <button type="button" disabled={freezing} onClick={() => setFreezeTarget(undefined)}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!validForFreeze || freezeTarget !== candidate || freezing}
            onClick={() => void confirmFreeze()}
          >
            {freezing ? "Freezing…" : "Confirm Freeze"}
          </button>
        </NoxDialog>
      ) : null}
    </section>
  );
}

function PreviousCandidates({ candidates }: { candidates: FormulaCandidate[] }) {
  const [selected, setSelected] = useState(0);
  return (
    <FormulaCandidates
      candidates={candidates}
      selected={selected}
      onSelect={setSelected}
      onFreeze={() => {}}
      canFreeze={false}
      readOnly
    />
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

function FormulaRevisionReview({
  api,
  tenantId,
  parent,
  trialId,
  evaluationId,
  modulePermissions,
  evidence
}: {
  api: ApiClient;
  tenantId: string;
  parent: FrozenFormula;
  trialId: string;
  evaluationId: string;
  modulePermissions: readonly string[];
  evidence: ReactNode;
}) {
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<FormulaCandidate[]>([]);
  const [previous, setPrevious] = useState<FormulaCandidate[][]>([]);
  const [selected, setSelected] = useState(0);
  const [working, setWorking] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string>();
  const canRequest = has(modulePermissions, "module.trial-sensory.revision.request");
  const generate = async () => {
    if (!canRequest || inFlight.current) return;
    inFlight.current = true;
    setWorking(true);
    setError(undefined);
    try {
      const result = await api<{
        revisionContext: {
          parentFormulaVersionId: string;
          sourceTrialId: string;
          sourceEvaluationId: string;
        };
        candidates: FormulaCandidate[];
      }>(`/trials/${trialId}/evaluations/${evaluationId}/create-revision`, {
        method: "POST",
        tenantId
      });
      if (
        result.revisionContext.parentFormulaVersionId !== parent.formulaVersionId ||
        result.revisionContext.sourceTrialId !== trialId ||
        result.revisionContext.sourceEvaluationId !== evaluationId ||
        result.candidates.some(
          (candidate) =>
            candidate.projectId !== parent.candidate.projectId ||
            candidate.sourceBriefId !== parent.candidate.sourceBriefId ||
            candidate.compositionKind !== parent.compositionKind
        )
      )
        throw new Error("Revision response does not match the selected parent and evidence.");
      if (candidates.length) setPrevious((value) => [...value, candidates]);
      setCandidates(result.candidates);
      setSelected(0);
    } catch (reason) {
      setError(message(reason));
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  };
  const freeze = async () => {
    const candidate = candidates[selected];
    if (!canRequest || !has(modulePermissions, FREEZE_FORMULA) || !candidate || inFlight.current)
      return false;
    inFlight.current = true;
    setWorking(true);
    setError(undefined);
    try {
      const result = await api<{
        formulaVersion: FrozenFormula & {
          parentFormulaVersionId: string;
          tenantId: string;
        };
      }>(`/design-studio/formula-versions/${parent.formulaVersionId}/revisions/freeze`, {
        method: "POST",
        tenantId,
        body: {
          sourceTrialId: trialId,
          sourceEvaluationId: evaluationId,
          strategy: candidate.generationStrategy,
          formulaName: `${parent.name} · Revision`
        }
      });
      const next = result.formulaVersion;
      if (
        !next.formulaVersionId ||
        next.formulaVersionId === parent.formulaVersionId ||
        next.parentFormulaVersionId !== parent.formulaVersionId ||
        next.tenantId !== tenantId ||
        next.status !== "FROZEN"
      )
        throw new Error(
          "The server result does not confirm a new frozen revision with the selected lineage. Do not retry blindly; inspect the recorded result."
        );
      navigate(`/design-studio/formula-versions/${next.formulaVersionId}`);
      return true;
    } catch (reason) {
      setError(message(reason));
      return false;
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  };
  return (
    <section className="nox-design-panel" aria-label="Formula revision review">
      <h2>Revision from finalized Sensory evidence</h2>
      <p>
        Parent v{parent.versionNumber} remains immutable. Review the human observations before
        generating a new Formula direction.
      </p>
      <dl className="nox-design-intent-list">
        <div>
          <dt>Parent FormulaVersion</dt>
          <dd>{parent.formulaVersionId}</dd>
        </div>
        <div>
          <dt>Source Trial</dt>
          <dd>{trialId}</dd>
        </div>
        <div>
          <dt>Source Evaluation</dt>
          <dd>{evaluationId}</dd>
        </div>
      </dl>
      {evidence}
      {canRequest ? (
        <button type="button" disabled={working} onClick={() => void generate()}>
          {working
            ? "Working…"
            : candidates.length
              ? "Generate revision again"
              : "Generate revision directions"}
        </button>
      ) : (
        <p role="status">
          Read-only evidence. Revision permission is required to generate directions.
        </p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {candidates.length ? (
        <FormulaCandidates
          candidates={candidates}
          selected={selected}
          onSelect={setSelected}
          onFreeze={freeze}
          canFreeze={canRequest && has(modulePermissions, FREEZE_FORMULA) && !working && !error}
        />
      ) : null}
      {previous.map((items, index) => (
        <details key={index}>
          <summary>Previous revision response {index + 1} · read-only</summary>
          <PreviousCandidates candidates={items} />
        </details>
      ))}
    </section>
  );
}

function FormulaVersionEntry({
  api,
  tenantId,
  formulaVersionId,
  modulePermissions
}: {
  api: ApiClient;
  tenantId: string;
  formulaVersionId: string;
  modulePermissions: readonly string[];
}) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const sourceTrialId = search.get("sourceTrialId");
  const sourceEvaluationId = search.get("sourceEvaluationId");
  const [formula, setFormula] = useState<FrozenFormula>();
  const [error, setError] = useState<string>();
  const [evidence, setEvidence] = useState<{
    trial: {
      id: string;
      tenantId: string;
      status: string;
      formulaVersionId: string;
      formulaBundleHash: string;
    };
    evaluation: {
      id: string;
      trialId: string;
      status: string;
      decision: string | null;
      evaluationText?: string;
      diagnosticNote?: string | null;
      finalizedAt?: string | null;
      deltas?: Array<{ phase: string; taxonomyTerm: string; confirmedDelta?: number | null }>;
    } | null;
  }>();
  const [evidenceError, setEvidenceError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string>();
  const workspaceObject = useMemo(
    () =>
      formula
        ? {
            id: formula.formulaVersionId,
            objectType: "FormulaVersion",
            readOnly: formula.status === "FROZEN",
            title: `${formula.name} · v${formula.versionNumber}`,
            route: `/design-studio/formula-versions/${formula.formulaVersionId}`,
            development: resolveDevelopmentContext({
              tenantId,
              queryTenantId: tenantId,
              formulaVersionId,
              formula,
              selectedTrialId: sourceTrialId,
              selectedEvaluationId: sourceEvaluationId,
              trial: evidence?.trial,
              evaluation: evidence?.evaluation,
              permissions: modulePermissions
            }),
            properties: [
              { label: "Composition", value: formula.compositionKind.replaceAll("_", " ") },
              { label: "State", value: formula.status },
              { label: "Approval", value: formula.approvalState.replaceAll("_", " ") },
              { label: "Bundle Hash", value: formula.bundleHash }
            ]
          }
        : undefined,
    [
      formula,
      tenantId,
      formulaVersionId,
      sourceTrialId,
      sourceEvaluationId,
      evidence,
      modulePermissions
    ]
  );
  useWorkspaceObject(workspaceObject);
  useEffect(() => {
    let current = true;
    void api<{ formulaVersion: FrozenFormula }>(
      `/design-studio/formula-versions/${formulaVersionId}`,
      { tenantId }
    )
      .then((result) => current && setFormula(result.formulaVersion))
      .catch((reason) => current && setError(message(reason)));
    return () => {
      current = false;
    };
  }, [api, tenantId, formulaVersionId]);
  useEffect(() => {
    let current = true;
    setEvidence(undefined);
    setEvidenceError(undefined);
    if (!sourceTrialId || !sourceEvaluationId) return;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(sourceTrialId) || !uuid.test(sourceEvaluationId)) {
      setEvidenceError("The approval handoff contains an invalid evidence identifier.");
      return;
    }
    void api<NonNullable<typeof evidence>>(`/trials/${sourceTrialId}`, { tenantId })
      .then((payload) => {
        if (current) setEvidence(payload);
      })
      .catch((reason) => {
        if (current) setEvidenceError(message(reason));
      });
    return () => {
      current = false;
    };
  }, [api, tenantId, formulaVersionId, sourceTrialId, sourceEvaluationId]);
  if (error)
    return (
      <p role="alert" className="nox-design-warning">
        {error}
      </p>
    );
  if (!formula) return <p aria-busy="true">Loading FormulaVersion…</p>;
  const eligible =
    formula.status === "FROZEN" &&
    formula.approvalState === "APPROVED" &&
    formula.compositionKind === "FULL_FORMULA";
  const canAssess =
    eligible &&
    has(modulePermissions, "module.release-readiness.assessment.create") &&
    has(modulePermissions, "module.release-readiness.assessment.run");
  const lineageMatches = Boolean(
    evidence &&
    evidence.trial.tenantId === tenantId &&
    ["PREPARED", "COMPLETED"].includes(evidence.trial.status) &&
    evidence.trial.id === sourceTrialId &&
    evidence.trial.formulaVersionId === formula.formulaVersionId &&
    evidence.trial.formulaBundleHash === formula.bundleHash &&
    evidence.evaluation?.id === sourceEvaluationId &&
    evidence.evaluation.trialId === sourceTrialId &&
    evidence.evaluation.status === "FINAL"
  );
  const evidenceMatches = lineageMatches && evidence?.evaluation?.decision === "READY_FOR_APPROVAL";
  const canApprove =
    formula.approvalState === "NOT_APPROVED" &&
    evidenceMatches &&
    has(modulePermissions, "module.design-studio.formula.approve");
  const approve = async () => {
    if (!canApprove || approving) return;
    setApproving(true);
    setApprovalError(undefined);
    try {
      // G4 remains authoritative. Commit-time evidence revalidation is a recorded backend gap.
      const result = await api<{ formulaVersion: FrozenFormula }>(
        `/design-studio/formula-versions/${formula.formulaVersionId}/approve`,
        { method: "POST", tenantId, body: { sourceTrialId, sourceEvaluationId } }
      );
      setFormula(result.formulaVersion);
      setConfirming(false);
    } catch (reason) {
      setApprovalError(message(reason));
      setConfirming(false);
    } finally {
      setApproving(false);
    }
  };
  return (
    <section
      className="nox-design-studio"
      data-screen-id="DS-04"
      aria-labelledby="formula-version-title"
    >
      <header className="nox-design-header">
        <div>
          <button
            type="button"
            className="nox-design-back"
            onClick={() => navigate("/design-studio")}
          >
            ← Design Studio
          </button>
          <p className="nox-ai-context">
            {formula.status} · {formula.approvalState}
          </p>
          <h1 id="formula-version-title">
            {formula.name} · v{formula.versionNumber}
          </h1>
        </div>
        {canAssess ? (
          <button
            type="button"
            onClick={() =>
              navigate(`/release-readiness/new?formulaVersionId=${formula.formulaVersionId}`)
            }
          >
            Assess Release Readiness
          </button>
        ) : null}
      </header>
      <dl className="nox-design-intent-list">
        <div>
          <dt>Composition</dt>
          <dd>{formula.compositionKind.replaceAll("_", " ")}</dd>
        </div>
        <div>
          <dt>Bundle Hash</dt>
          <dd>
            <code>{formula.bundleHash}</code>
          </dd>
        </div>
        <div>
          <dt>FormulaVersion</dt>
          <dd>
            <code>{formula.formulaVersionId}</code>
          </dd>
        </div>
      </dl>
      <section className="nox-design-panel" aria-labelledby="formula-composition-title">
        <h2 id="formula-composition-title">Frozen composition</h2>
        <div
          className="nox-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Frozen Formula lines"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Material</th>
                <th scope="col">Reference mass</th>
                <th scope="col">Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {formula.candidate.lines.map((line) => (
                <tr key={line.materialId}>
                  <td>
                    <a href={`/materials/${line.materialId}`}>
                      {line.materialSnapshot.material.displayName}
                    </a>
                  </td>
                  <td>{formatMassMg(line.normalizedMassMg)}</td>
                  <td>
                    <code>{line.materialSnapshot.snapshotHash}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {formula.approvalState === "NOT_APPROVED" &&
      evidence?.evaluation?.decision !== "REVISION_REQUIRED" ? (
        <section className="nox-design-panel" aria-labelledby="formula-approval-title">
          <h2 id="formula-approval-title">Approval review</h2>
          <p>
            Frozen composition is immutable. Approval is a separate G4 decision backed by FINAL G5
            evidence.
          </p>
          {evidenceMatches ? (
            <dl className="nox-definition-list">
              <div>
                <dt>Trial</dt>
                <dd>{sourceTrialId}</dd>
              </div>
              <div>
                <dt>Evaluation</dt>
                <dd>{sourceEvaluationId}</dd>
              </div>
              <div>
                <dt>Decision</dt>
                <dd>FINAL · READY FOR APPROVAL</dd>
              </div>
            </dl>
          ) : (
            <p role="status">
              {evidenceError ??
                (sourceTrialId && !evidence
                  ? "Loading approval evidence…"
                  : "Exact FINAL READY FOR APPROVAL evidence is required. Open the corresponding Trial; no latest Trial is selected automatically.")}
            </p>
          )}
          {canApprove ? (
            <button
              type="button"
              className="nox-material-primary-action"
              disabled={approving}
              onClick={() => setConfirming(true)}
            >
              Approve Formula
            </button>
          ) : null}
          {!has(modulePermissions, "module.design-studio.formula.approve") ? (
            <p>Approval permission is not granted in this workspace.</p>
          ) : null}
          <button
            type="button"
            onClick={() =>
              navigate(
                sourceTrialId
                  ? `/trials/${encodeURIComponent(sourceTrialId)}`
                  : `/trials?formulaVersionId=${formula.formulaVersionId}`
              )
            }
          >
            Open Trial workspace
          </button>
          {approvalError ? (
            <p role="alert" className="nox-design-warning">
              {approvalError}
            </p>
          ) : null}
        </section>
      ) : null}
      {confirming ? (
        <NoxDialog
          title="Confirm Formula approval"
          onClose={() => {
            if (!approving) setConfirming(false);
          }}
        >
          <p>
            Approve {formula.name} · v{formula.versionNumber} using the displayed FINAL Trial
            evidence? This records a G4 approval and audit event. It does not release a Batch.
          </p>
          <button type="button" disabled={approving} onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="nox-material-primary-action"
            disabled={approving}
            onClick={() => void approve()}
          >
            {approving ? "Approving…" : "Confirm approval"}
          </button>
        </NoxDialog>
      ) : null}
      {!lineageMatches && evidence?.evaluation?.decision === "REVISION_REQUIRED" ? (
        <p role="alert">
          Revision evidence does not match this tenant, Trial and frozen FormulaVersion. No revision
          action is available.
        </p>
      ) : null}
      {lineageMatches && evidence?.evaluation?.decision === "REVISION_REQUIRED" ? (
        <FormulaRevisionReview
          key={`${tenantId}:${formula.formulaVersionId}:${sourceTrialId}:${sourceEvaluationId}`}
          api={api}
          tenantId={tenantId}
          parent={formula}
          trialId={sourceTrialId!}
          evaluationId={sourceEvaluationId!}
          modulePermissions={modulePermissions}
          evidence={
            <>
              <p className="nox-evidence-raw">
                {evidence.evaluation.evaluationText || "Raw observation unavailable."}
              </p>
              {evidence.evaluation.diagnosticNote ? (
                <p>{evidence.evaluation.diagnosticNote}</p>
              ) : null}
              <ul>
                {evidence.evaluation.deltas?.map((delta, index) => (
                  <li key={index}>
                    {delta.phase} · {delta.taxonomyTerm} · Confirmed:{" "}
                    {delta.confirmedDelta ?? "Not confirmed"}
                  </li>
                ))}
              </ul>
              <p>
                FINAL · {evidence.evaluation.finalizedAt ?? "Finalization timestamp unavailable"}
              </p>
            </>
          }
        />
      ) : null}
      {!eligible ? (
        <p className="nox-design-warning">
          Release assessment is available only for an APPROVED, FROZEN FULL_FORMULA.
        </p>
      ) : null}
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
  const [unsaved, setUnsaved] = useState(false);
  const [briefOutOfDate, setBriefOutOfDate] = useState(false);
  const projectAttempt = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const briefAttempt = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const submitting = useRef(false);
  useUnsavedChanges(unsaved);
  const [plan, setPlan] = useState<AccordArchitecturePlan>();
  const [candidates, setCandidates] = useState<FormulaCandidate[]>([]);
  const [previousCandidates, setPreviousCandidates] = useState<FormulaCandidate[][]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState(0);
  const [generationOptions, setGenerationOptions] = useState<{
    accordKey?: string;
    buildCompleteFromAccords?: boolean;
  }>({});
  const [frozen, setFrozen] = useState<FrozenFormula>();
  const [trialReady, setTrialReady] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
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
  const formulaVersionRoute = matchPath(
    "/design-studio/formula-versions/:formulaVersionId",
    location.pathname
  );
  if (formulaVersionRoute?.params.formulaVersionId)
    return (
      <FormulaVersionEntry
        key={`${tenantId}:${formulaVersionRoute.params.formulaVersionId}`}
        api={api}
        tenantId={tenantId}
        formulaVersionId={formulaVersionRoute.params.formulaVersionId}
        modulePermissions={modulePermissions}
      />
    );
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
    if (!selectedTaxonomy || submitting.current) return;
    submitting.current = true;
    setWorking(true);
    setError(undefined);
    try {
      const projectBody = { name: projectName, description: null };
      const projectFingerprint = JSON.stringify({ tenantId, ...projectBody });
      if (projectAttempt.current?.fingerprint !== projectFingerprint)
        projectAttempt.current = { fingerprint: projectFingerprint, key: crypto.randomUUID() };
      const project = await api<{ project: { id: string } }>("/design-studio/projects", {
        method: "POST",
        tenantId,
        body: { ...projectBody, operationKey: projectAttempt.current.key }
      });
      const briefBody = {
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
      };
      const briefFingerprint = JSON.stringify({
        tenantId,
        projectId: project.project.id,
        ...briefBody
      });
      if (briefAttempt.current?.fingerprint !== briefFingerprint)
        briefAttempt.current = { fingerprint: briefFingerprint, key: crypto.randomUUID() };
      const response = await api<{ brief: { id: string }; intentDraft: IntentDraft }>(
        `/design-studio/projects/${project.project.id}/briefs`,
        {
          method: "POST",
          tenantId,
          body: { ...briefBody, operationKey: briefAttempt.current.key }
        }
      );
      setBriefId(response.brief.id);
      setUnsaved(false);
      setBriefOutOfDate(false);
      setDraft(response.intentDraft);
      setPlan(undefined);
      if (candidates.length) setPreviousCandidates((current) => [...current, candidates]);
      setCandidates([]);
    } catch (reason) {
      setError(message(reason));
    } finally {
      submitting.current = false;
      setWorking(false);
    }
  };

  const generate = async (
    options: { accordKey?: string; buildCompleteFromAccords?: boolean } = {}
  ) => {
    if (!briefId || briefOutOfDate) return;
    setWorking(true);
    setError(undefined);
    try {
      const response = await api<{ candidates: FormulaCandidate[] }>(
        `/design-studio/briefs/${briefId}/generate`,
        { method: "POST", tenantId, body: { budget: { mode: "STANDARD" }, ...options } }
      );
      setGenerationOptions(options);
      if (candidates.length) setPreviousCandidates((current) => [...current, candidates]);
      setCandidates(response.candidates);
      setSelectedCandidate(0);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setWorking(false);
    }
  };

  const confirm = async () => {
    if (!draft || !briefId || briefOutOfDate) return;
    setWorking(true);
    setError(undefined);
    try {
      await api(`/design-studio/briefs/${briefId}/confirm`, {
        method: "POST",
        tenantId,
        body: { intent: draft.intent }
      });
      setUnsaved(false);
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
      setUnsaved(false);
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
    if (!briefId || !candidates[selectedCandidate] || briefOutOfDate) return false;
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
      setUnsaved(false);
      return true;
    } catch (reason) {
      setError(message(reason));
      return false;
    } finally {
      setWorking(false);
    }
  };

  return (
    <section
      className="nox-design-studio"
      aria-labelledby="design-studio-title"
      onChangeCapture={() => setUnsaved(true)}
    >
      <header className="nox-design-header">
        <div>
          <button
            type="button"
            className="nox-design-back"
            onClick={() => {
              if (
                unsaved &&
                !window.confirm(
                  "Discard unsaved local edits and return to workflows? Saved server drafts are not deleted."
                )
              )
                return;
              setUnsaved(false);
              setMode(undefined);
              projectAttempt.current = undefined;
              briefAttempt.current = undefined;
              setDraft(undefined);
              setPlan(undefined);
              setCandidates([]);
              setPreviousCandidates([]);
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
      <nav className="nox-local-stages" aria-label="Design authoring stages">
        <ol>
          {[
            "Brief",
            "Intent review",
            ...(mode === "ACCORD_ARCHITECTURE" ? ["Accord architecture"] : ["Generate", "Select"]),
            "Freeze"
          ].map((label) => (
            <li
              key={label}
              aria-current={
                label ===
                (frozen
                  ? "Freeze"
                  : candidates.length
                    ? "Select"
                    : plan
                      ? "Accord architecture"
                      : draft
                        ? "Intent review"
                        : "Brief")
                  ? "step"
                  : undefined
              }
            >
              {label}
            </li>
          ))}
        </ol>
      </nav>
      <div className="nox-design-layout">
        <form
          className="nox-design-panel"
          data-screen-id="DS-01"
          onSubmit={submit}
          onChangeCapture={() => {
            if (briefId) setBriefOutOfDate(true);
          }}
        >
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
          {briefOutOfDate ? (
            <p role="status" className="nox-design-warning">
              Brief inputs have changed. Interpret and review the updated brief before generating or
              freezing. Previous results remain visible as stale context.
            </p>
          ) : null}
          {frozen ? (
            <FrozenFormulaView
              value={frozen}
              onTrial={() => {
                setTrialReady(true);
                navigate(`/trials?formulaVersionId=${frozen.formulaVersionId}`);
              }}
            />
          ) : candidates.length > 0 ? (
            <FormulaCandidates
              candidates={candidates}
              selected={selectedCandidate}
              onSelect={setSelectedCandidate}
              onFreeze={freeze}
              canFreeze={has(modulePermissions, FREEZE_FORMULA) && !working && !briefOutOfDate}
            />
          ) : plan ? (
            <AccordPlanView
              plan={plan}
              canDevelop={
                has(modulePermissions, DEVELOP_ACCORD) &&
                has(modulePermissions, GENERATE_FORMULA) &&
                !briefOutOfDate
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
                !working &&
                !briefOutOfDate
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
          {previousCandidates.length ? (
            <section aria-label="Previous candidate responses">
              <h2>Previous responses</h2>
              <p>
                Retained in this workspace for comparison only. Current Brief and validation remain
                authoritative.
              </p>
              {previousCandidates.map((response, index) => (
                <details key={index}>
                  <summary>
                    Previous response {index + 1} · {response.length} directions
                  </summary>
                  <PreviousCandidates candidates={response} />
                </details>
              ))}
            </section>
          ) : null}
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
