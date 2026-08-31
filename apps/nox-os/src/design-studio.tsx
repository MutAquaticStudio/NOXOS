import { useMemo, useState, type FormEvent } from "react";
import {
  arbitrateIntent,
  buildAccordArchitecture,
  confirmIntent,
  formatMassMg,
  type AccordArchitecturePlan,
  type DesignWorkflowMode,
  type IntentDraft
} from "@nox-os/design-studio/browser";

const READ = "module.design-studio.studio.read";
const MANAGE_BRIEF = "module.design-studio.brief.manage";
const CONFIRM_INTENT = "module.design-studio.intent.confirm";
const PLAN_ACCORD = "module.design-studio.accord.plan";

const taxonomyChoices = [
  ["DESCRIPTOR", "Bergamotty"],
  ["DESCRIPTOR", "Smooth"],
  ["TEXTURE", "Powdery"],
  ["SENSATION", "Fresh"],
  ["GRAND_FAMILY", "Floral"]
] as const;

function has(permissions: readonly string[], permission: string): boolean {
  return permissions.includes(permission);
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
      <p>
        Translate a confirmed creative direction into one inspectable, governed design artifact.
      </p>
      <div className="nox-design-workflow-grid">
        <button type="button" onClick={() => onChoose("FORMULA_GENERATION")}>
          <strong>Complete Formula</strong>
          <span>Generate three deterministic Material directions for comparison.</span>
        </button>
        <button type="button" onClick={() => onChoose("ACCORD_ARCHITECTURE")}>
          <strong>Plan Accord Architecture</strong>
          <span>Plan roles, phases and relationships before choosing Materials.</span>
        </button>
      </div>
    </section>
  );
}

function IntentReview({
  draft,
  onConfirm,
  canConfirm
}: {
  draft: IntentDraft;
  onConfirm: () => void;
  canConfirm: boolean;
}) {
  return (
    <section className="nox-design-panel" aria-labelledby="intent-review-title">
      <p className="nox-ai-context">HUMAN REVIEW REQUIRED</p>
      <h2 id="intent-review-title">Intent Review</h2>
      <p>{draft.intent.rawBriefSummary}</p>
      <dl className="nox-design-intent-list">
        <div>
          <dt>Required</dt>
          <dd>{draft.intent.required.map((item) => item.taxonomyTerm).join(", ") || "None"}</dd>
        </div>
        <div>
          <dt>Unresolved</dt>
          <dd>{draft.intent.unresolvedConcepts.join(", ") || "None"}</dd>
        </div>
        <div>
          <dt>Taxonomy</dt>
          <dd>OSMO · osmo_v1.2</dd>
        </div>
      </dl>
      <button type="button" onClick={onConfirm} disabled={!canConfirm}>
        Confirm Intent
      </button>
      {!canConfirm ? <p role="alert">Intent confirmation permission is required.</p> : null}
    </section>
  );
}

function AccordPlanView({ plan }: { plan: AccordArchitecturePlan }) {
  return (
    <section className="nox-design-plan" aria-labelledby="accord-plan-title">
      <header>
        <p className="nox-ai-context">ACCORD ARCHITECTURE · MATERIAL-FREE</p>
        <h2 id="accord-plan-title">Primary architecture plan</h2>
        <p>
          This runtime plan is not persisted because no approved Brief JSON field exists. No
          Material suggestions appear until an explicit development action.
        </p>
      </header>
      <div className="nox-design-accord-grid">
        {plan.accords.map((accord) => (
          <article key={accord.accordKey} tabIndex={0}>
            <div className="nox-design-accord-heading">
              <h3>{accord.label}</h3>
              <span>{accord.required ? "Required" : "Optional"}</span>
            </div>
            <p>{accord.purpose}</p>
            <dl>
              <div>
                <dt>Phase</dt>
                <dd>{accord.phase}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{accord.functionalRole}</dd>
              </div>
              <div>
                <dt>Targets</dt>
                <dd>{accord.taxonomyTargets.map((target) => target.taxonomyTerm).join(", ")}</dd>
              </div>
            </dl>
            <button type="button" disabled title="Executable persistence schema is not approved">
              Develop This Accord
            </button>
          </article>
        ))}
      </div>
      <p className="nox-design-warning" role="status">
        ACCORD_PLAN_PERSISTENCE_UNSPECIFIED · Formula Freeze is unavailable until the canonical
        Formula schema is supplied.
      </p>
    </section>
  );
}

export function DesignStudioExperience({
  tenantId,
  modulePermissions
}: {
  tenantId?: string;
  modulePermissions: readonly string[];
}) {
  const [mode, setMode] = useState<DesignWorkflowMode>();
  const [brief, setBrief] = useState("");
  const [applicationKey, setApplicationKey] = useState("fine-fragrance");
  const [dosage, setDosage] = useState(20);
  const [selected, setSelected] = useState(0);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [draft, setDraft] = useState<IntentDraft>();
  const [plan, setPlan] = useState<AccordArchitecturePlan>();
  const [error, setError] = useState<string>();
  const projectId = useMemo(() => crypto.randomUUID(), []);
  const briefId = useMemo(() => crypto.randomUUID(), []);

  if (!tenantId) {
    return (
      <section className="nox-design-empty">
        <h1>Select an active tenant workspace</h1>
      </section>
    );
  }
  if (!has(modulePermissions, READ)) return <PermissionDenied />;
  if (!mode) return <WorkflowChooser onChoose={setMode} />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (!has(modulePermissions, MANAGE_BRIEF)) {
      setError("Brief management permission is required.");
      return;
    }
    try {
      const [assignmentType, taxonomyTerm] = taxonomyChoices[selected];
      setDraft(
        arbitrateIntent({
          rawBriefSummary: brief,
          applicationProfile: { applicationKey, targetDosagePct: dosage },
          explicitTags: [{ assignmentType, taxonomyTerm, targetStrength: 1 }],
          explicitExclusions: excluded.map((index) => {
            const [excludedType, excludedTerm] = taxonomyChoices[index];
            return { assignmentType: excludedType, taxonomyTerm: excludedTerm };
          }),
          signals: []
        })
      );
      setPlan(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Brief interpretation failed.");
    }
  };

  const confirm = () => {
    if (!draft) return;
    const confirmed = confirmIntent(draft, {
      confirmed: true,
      confirmedByUserId: crypto.randomUUID()
    });
    if (mode === "ACCORD_ARCHITECTURE") {
      setPlan(
        buildAccordArchitecture({ projectId, sourceBriefId: briefId, confirmedIntent: confirmed })
      );
    } else {
      setError(
        "FORMULA_FROZEN_SNAPSHOT_SCHEMA_MISSING · Formula candidates require the canonical server persistence boundary."
      );
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
            <p className="nox-design-muted">
              Text is active. Image and Reference interpretation remain explicit source signals; no
              unsupported inference is fabricated.
            </p>
          </fieldset>
          <label>
            Primary canonical direction
            <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
              {taxonomyChoices.map((choice, index) => (
                <option key={choice.join(":")} value={index}>
                  {choice[0]} · {choice[1]}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Explicit exclusions</legend>
            {taxonomyChoices.map((choice, index) => (
              <label className="nox-design-check" key={choice.join(":")}>
                <input
                  type="checkbox"
                  checked={excluded.includes(index)}
                  onChange={(event) =>
                    setExcluded((current) =>
                      event.target.checked
                        ? [...current, index]
                        : current.filter((value) => value !== index)
                    )
                  }
                />
                {choice[1]}
              </label>
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
          <button type="submit">Interpret Brief</button>
          {error ? (
            <p className="nox-design-warning" role="alert">
              {error}
            </p>
          ) : null}
        </form>

        <div className="nox-design-results">
          {plan ? (
            <AccordPlanView plan={plan} />
          ) : draft ? (
            <IntentReview
              draft={draft}
              onConfirm={confirm}
              canConfirm={
                has(modulePermissions, CONFIRM_INTENT) &&
                (mode !== "ACCORD_ARCHITECTURE" || has(modulePermissions, PLAN_ACCORD))
              }
            />
          ) : (
            <section className="nox-design-empty">
              <p className="nox-ai-context">AWAITING BRIEF</p>
              <h2>Interpret a direction</h2>
              <p>
                The Studio will show an explicit intent review before any architecture or Formula
                action.
              </p>
            </section>
          )}
        </div>
      </div>
      <footer className="nox-design-status" role="status">
        Scientific Context · MODEL_UNAVAILABLE · Curated OSMO evidence remains available · Release
        readiness: NOT_ASSESSED
      </footer>
    </section>
  );
}
