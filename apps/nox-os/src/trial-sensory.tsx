import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { FormulaCandidate, OsmoTaxonomyAssignmentType } from "@nox-os/design-studio/browser";
import {
  formatMassMg,
  type FinalEvaluationDecision,
  type SensoryDeltaDraft,
  type TrialInventoryAvailability,
  type TrialLotAllocation,
  type TrialPreparationPlan
} from "@nox-os/trial-sensory/browser";
import type { ApiClient } from "./platform-control";

const permissions = {
  read: "module.trial-sensory.trial.read",
  create: "module.trial-sensory.trial.create",
  prepare: "module.trial-sensory.trial.prepare",
  cancel: "module.trial-sensory.trial.cancel",
  createEvaluation: "module.trial-sensory.evaluation.create",
  editEvaluation: "module.trial-sensory.evaluation.edit",
  finalizeEvaluation: "module.trial-sensory.evaluation.finalize",
  revision: "module.trial-sensory.revision.request",
  recommendApproval: "module.trial-sensory.approval.recommend",
  freezeRevision: "module.design-studio.formula.freeze",
  approveFormula: "module.design-studio.formula.approve",
  inventoryRead: "module.inventory.read"
} as const;

type TrialPayload = {
  id: string;
  tenantId: string;
  formulaVersionId: string;
  formulaBundleHash: string;
  compositionKind: "FULL_FORMULA" | "ACCORD_FORMULATION";
  preparation: {
    preparationMode: "CONCENTRATE" | "FINISHED_APPLICATION";
    applicationKey: string;
    dosagePct: number;
    carrierOrBaseReference: string | null;
    targetMassMg: string;
  };
  status: "DRAFT" | "PREPARED" | "COMPLETED" | "CANCELLED";
  preparedAt: string | null;
  updatedAt: string;
  lines: Array<{
    materialId: string;
    lineOrder: number;
    scaledMassMg: string;
    materialSnapshotHash: string;
  }>;
};

type EvaluationPayload = {
  id: string;
  trialId: string;
  status: "DRAFT" | "FINAL";
  context: {
    evaluationMedium: "BLOTTER" | "SKIN" | "PRODUCT" | "OTHER";
    sampleAgeMinutes: number;
    temperatureC?: number | null;
    humidityPct?: number | null;
  };
  evaluationText: string;
  diagnosticNote: string | null;
  decision: FinalEvaluationDecision | null;
  finalizedAt: string | null;
  deltas: SensoryDeltaDraft[];
};

type FormulaSummary = {
  formulaVersionId: string;
  name: string;
  versionNumber: number;
  compositionKind: TrialPayload["compositionKind"];
  lines: Array<{ materialId: string; displayName: string }>;
};

type TaxonomyChoice = {
  assignmentType: OsmoTaxonomyAssignmentType;
  taxonomyTerm: string;
};

type TrialInventoryTrace = {
  trialId: string;
  movements: Array<{
    id: string;
    lotId: string;
    materialId: string;
    quantityMg: string;
    fromLocationId: string | null;
    sourceModule: string;
    sourceReferenceId: string | null;
  }>;
};

function has(values: readonly string[], permission: string): boolean {
  return values.includes(permission);
}

function problem(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Trial & Sensory operation failed.";
}

function statusLabel(status: TrialPayload["status"]): string {
  return status.replaceAll("_", " ");
}

function TrialRegistry({
  api,
  tenantId,
  modulePermissions
}: {
  api: ApiClient;
  tenantId: string;
  modulePermissions: readonly string[];
}) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [trials, setTrials] = useState<TrialPayload[]>([]);
  const [formulaVersionId, setFormulaVersionId] = useState(search.get("formulaVersionId") ?? "");
  const [targetMassG, setTargetMassG] = useState(20);
  const [preparationMode, setPreparationMode] = useState<"CONCENTRATE" | "FINISHED_APPLICATION">(
    "CONCENTRATE"
  );
  const [applicationKey, setApplicationKey] = useState("fine-fragrance");
  const [dosagePct, setDosagePct] = useState(20);
  const [carrier, setCarrier] = useState("");
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let current = true;
    void api<{ trials: TrialPayload[] }>("/trials", { tenantId })
      .then((payload) => {
        if (current) setTrials(payload.trials);
      })
      .catch((reason) => {
        if (current) setError(problem(reason));
      });
    return () => {
      current = false;
    };
  }, [api, tenantId]);

  const createTrial = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError(undefined);
    try {
      const targetMassMg = String(Math.round(targetMassG * 1000));
      const response = await api<{ trial: TrialPayload }>("/trials", {
        method: "POST",
        tenantId,
        body: {
          formulaVersionId,
          preparationMode,
          applicationKey,
          dosagePct,
          carrierOrBaseReference: carrier.trim() || null,
          targetMassMg
        }
      });
      navigate(`/trials/${response.trial.id}`);
    } catch (reason) {
      setError(problem(reason));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="nox-trial" aria-labelledby="trial-registry-title">
      <header className="nox-section-heading">
        <div>
          <p className="nox-ai-context">TRIAL & SENSORY</p>
          <h1 id="trial-registry-title">Trial Registry</h1>
          <p>Physical preparation and whole-composition perception evidence.</p>
        </div>
      </header>
      {formulaVersionId && has(modulePermissions, permissions.create) ? (
        <form className="nox-trial-create nox-design-panel" onSubmit={createTrial}>
          <h2>Create Trial from FROZEN Formula</h2>
          <label>
            FormulaVersion
            <input
              value={formulaVersionId}
              onChange={(event) => setFormulaVersionId(event.target.value)}
              required
            />
          </label>
          <div className="nox-trial-form-grid">
            <label>
              Preparation
              <select
                value={preparationMode}
                onChange={(event) =>
                  setPreparationMode(event.target.value as typeof preparationMode)
                }
              >
                <option value="CONCENTRATE">Concentrate</option>
                <option value="FINISHED_APPLICATION">Finished application</option>
              </select>
            </label>
            <label>
              Target batch (g)
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={targetMassG}
                onChange={(event) => setTargetMassG(Number(event.target.value))}
                required
              />
            </label>
            <label>
              Application
              <input
                value={applicationKey}
                onChange={(event) => setApplicationKey(event.target.value)}
                required
              />
            </label>
            <label>
              Dosage %
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                value={dosagePct}
                onChange={(event) => setDosagePct(Number(event.target.value))}
                required
              />
            </label>
          </div>
          <label>
            Carrier / base reference (optional)
            <input value={carrier} onChange={(event) => setCarrier(event.target.value)} />
          </label>
          <button type="submit" disabled={working}>
            {working ? "Creating…" : "Create Draft Trial"}
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="nox-design-warning" role="alert">
          {error}
        </p>
      ) : null}
      <div className="nox-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Trial</th>
              <th>Composition</th>
              <th>Formula version</th>
              <th>Status</th>
              <th>Target batch</th>
              <th>Application</th>
              <th>Prepared</th>
            </tr>
          </thead>
          <tbody>
            {trials.map((trial) => (
              <tr
                key={trial.id}
                onClick={() => navigate(`/trials/${trial.id}`)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/trials/${trial.id}`);
                }}
              >
                <td>
                  <button type="button" onClick={() => navigate(`/trials/${trial.id}`)}>
                    {trial.id.slice(0, 8)}
                  </button>
                </td>
                <td>{trial.compositionKind.replaceAll("_", " ")}</td>
                <td>
                  <code>{trial.formulaVersionId.slice(0, 8)}</code>
                </td>
                <td>{statusLabel(trial.status)}</td>
                <td>{formatMassMg(trial.preparation.targetMassMg)}</td>
                <td>{trial.preparation.applicationKey}</td>
                <td>{trial.preparedAt ? new Date(trial.preparedAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {trials.length === 0 ? (
        <p className="nox-design-empty">No Trials have been created.</p>
      ) : null}
    </section>
  );
}

function TrialDetail({
  api,
  tenantId,
  modulePermissions
}: {
  api: ApiClient;
  tenantId: string;
  modulePermissions: readonly string[];
}) {
  const navigate = useNavigate();
  const { trialId = "" } = useParams();
  const [trial, setTrial] = useState<TrialPayload>();
  const [formula, setFormula] = useState<FormulaSummary>();
  const [evaluation, setEvaluation] = useState<EvaluationPayload>();
  const [taxonomy, setTaxonomy] = useState<TaxonomyChoice[]>([]);
  const [evaluationText, setEvaluationText] = useState("");
  const [diagnosticNote, setDiagnosticNote] = useState("");
  const [medium, setMedium] = useState<EvaluationPayload["context"]["evaluationMedium"]>("BLOTTER");
  const [sampleAgeMinutes, setSampleAgeMinutes] = useState(0);
  const [temperatureC, setTemperatureC] = useState<number | null>(null);
  const [humidityPct, setHumidityPct] = useState<number | null>(null);
  const [deltas, setDeltas] = useState<SensoryDeltaDraft[]>([]);
  const [decision, setDecision] = useState<FinalEvaluationDecision>("REVISION_REQUIRED");
  const [revisionCandidates, setRevisionCandidates] = useState<FormulaCandidate[]>([]);
  const [preparationPlan, setPreparationPlan] = useState<TrialPreparationPlan>();
  const [inventory, setInventory] = useState<TrialInventoryAvailability>();
  const [inventoryTrace, setInventoryTrace] = useState<TrialInventoryTrace>();
  const [allocations, setAllocations] = useState<TrialLotAllocation[]>([]);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);

  const load = async () => {
    const payload = await api<{
      trial: TrialPayload;
      evaluation: EvaluationPayload | null;
      formula: FormulaSummary | null;
    }>(`/trials/${trialId}`, { tenantId });
    setTrial(payload.trial);
    setFormula(payload.formula ?? undefined);
    setEvaluation(payload.evaluation ?? undefined);
    if (payload.evaluation) {
      setEvaluationText(payload.evaluation.evaluationText);
      setDiagnosticNote(payload.evaluation.diagnosticNote ?? "");
      setMedium(payload.evaluation.context.evaluationMedium);
      setSampleAgeMinutes(payload.evaluation.context.sampleAgeMinutes);
      setTemperatureC(payload.evaluation.context.temperatureC ?? null);
      setHumidityPct(payload.evaluation.context.humidityPct ?? null);
      setDeltas(payload.evaluation.deltas);
      if (payload.evaluation.decision) setDecision(payload.evaluation.decision);
    }
    if (payload.trial.status === "DRAFT") await loadInventory();
    else if (has(modulePermissions, permissions.inventoryRead)) await loadInventoryTrace();
  };

  const loadInventory = async () => {
    const [planPayload, inventoryPayload] = await Promise.all([
      api<{ plan: TrialPreparationPlan }>(`/trials/${trialId}/preparation-plan`, { tenantId }),
      api<{ availability: TrialInventoryAvailability }>(`/trials/${trialId}/inventory`, {
        tenantId
      })
    ]);
    setPreparationPlan(planPayload.plan);
    setInventory(inventoryPayload.availability);
    setAllocations((current) => {
      if (current.length > 0 || inventoryPayload.availability.activeReservations.length > 0)
        return current;
      return planPayload.plan.requirements.flatMap((requirement) => {
        const candidate = inventoryPayload.availability.allocations.find(
          (item) => item.materialId === requirement.materialId && item.eligible
        );
        return candidate
          ? [
              {
                materialId: requirement.materialId,
                lotId: candidate.lotId,
                locationId: candidate.locationId,
                quantityMg: requirement.requiredMassMg
              }
            ]
          : [];
      });
    });
  };

  const loadInventoryTrace = async () => {
    const payload = await api<{ trace: TrialInventoryTrace }>(
      `/inventory/trials/${trialId}/trace`,
      { tenantId }
    );
    setInventoryTrace(payload.trace);
  };

  useEffect(() => {
    let current = true;
    Promise.all([
      api<{
        trial: TrialPayload;
        evaluation: EvaluationPayload | null;
        formula: FormulaSummary | null;
      }>(`/trials/${trialId}`, { tenantId }),
      api<{
        taxonomy: Record<
          "GRAND_FAMILIES" | "SUBFAMILIES" | "DESCRIPTORS" | "TEXTURES" | "SENSATIONS",
          string[]
        >;
      }>("/materials/taxonomy?version=1.2", { tenantId })
    ])
      .then(([payload, terms]) => {
        if (!current) return;
        setTrial(payload.trial);
        setFormula(payload.formula ?? undefined);
        setEvaluation(payload.evaluation ?? undefined);
        if (payload.evaluation) {
          setEvaluationText(payload.evaluation.evaluationText);
          setDiagnosticNote(payload.evaluation.diagnosticNote ?? "");
          setMedium(payload.evaluation.context.evaluationMedium);
          setSampleAgeMinutes(payload.evaluation.context.sampleAgeMinutes);
          setTemperatureC(payload.evaluation.context.temperatureC ?? null);
          setHumidityPct(payload.evaluation.context.humidityPct ?? null);
          setDeltas(payload.evaluation.deltas);
          if (payload.evaluation.decision) setDecision(payload.evaluation.decision);
        }
        setTaxonomy([
          ...terms.taxonomy.GRAND_FAMILIES.map((taxonomyTerm) => ({
            assignmentType: "GRAND_FAMILY" as const,
            taxonomyTerm
          })),
          ...terms.taxonomy.SUBFAMILIES.map((taxonomyTerm) => ({
            assignmentType: "SUBFAMILY" as const,
            taxonomyTerm
          })),
          ...terms.taxonomy.DESCRIPTORS.map((taxonomyTerm) => ({
            assignmentType: "DESCRIPTOR" as const,
            taxonomyTerm
          })),
          ...terms.taxonomy.TEXTURES.map((taxonomyTerm) => ({
            assignmentType: "TEXTURE" as const,
            taxonomyTerm
          })),
          ...terms.taxonomy.SENSATIONS.map((taxonomyTerm) => ({
            assignmentType: "SENSATION" as const,
            taxonomyTerm
          }))
        ]);
        if (payload.trial.status === "DRAFT")
          void loadInventory().catch((reason) => setError(problem(reason)));
        else if (has(modulePermissions, permissions.inventoryRead))
          void loadInventoryTrace().catch((reason) => setError(problem(reason)));
      })
      .catch((reason) => current && setError(problem(reason)));
    return () => {
      current = false;
    };
  }, [api, tenantId, trialId]);

  const action = async (operation: () => Promise<unknown>, success: string) => {
    setWorking(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await operation();
      await load();
      setNotice(success);
    } catch (reason) {
      setError(problem(reason));
    } finally {
      setWorking(false);
    }
  };

  const saveEvaluation = () => {
    if (!evaluation) return Promise.resolve();
    return api(`/trials/${trialId}/evaluations/${evaluation.id}`, {
      method: "PUT",
      tenantId,
      body: {
        evaluationMedium: medium,
        sampleAgeMinutes,
        temperatureC,
        humidityPct,
        evaluationText,
        diagnosticNote: diagnosticNote || null,
        deltas
      }
    });
  };

  const addDelta = () => {
    const choice = taxonomy.find(
      (item) =>
        !deltas.some(
          (delta) =>
            delta.assignmentType === item.assignmentType && delta.taxonomyTerm === item.taxonomyTerm
        )
    );
    if (!choice) return;
    setDeltas([
      ...deltas,
      {
        phase: "CROSS_PHASE",
        ...choice,
        proposedDelta: null,
        confirmedDelta: 0,
        proposalConfidence: null,
        interpreterVersion: null
      }
    ]);
  };

  const names = useMemo(
    () => new Map(formula?.lines.map((line) => [line.materialId, line.displayName]) ?? []),
    [formula]
  );
  const requiredByMaterial = useMemo(
    () =>
      new Map(
        preparationPlan?.requirements.map((item) => [
          item.materialId,
          BigInt(item.requiredMassMg)
        ]) ?? []
      ),
    [preparationPlan]
  );
  const allocatedByMaterial = useMemo(() => {
    const values = new Map<string, bigint>();
    for (const item of allocations)
      values.set(
        item.materialId,
        (values.get(item.materialId) ?? 0n) + BigInt(item.quantityMg || "0")
      );
    return values;
  }, [allocations]);
  const activeReservedByMaterial = useMemo(() => {
    const values = new Map<string, bigint>();
    for (const item of inventory?.activeReservations ?? [])
      values.set(item.materialId, (values.get(item.materialId) ?? 0n) + BigInt(item.quantityMg));
    return values;
  }, [inventory]);
  const exactDraftAllocation =
    requiredByMaterial.size > 0 &&
    [...requiredByMaterial].every(
      ([materialId, mass]) => allocatedByMaterial.get(materialId) === mass
    );
  const exactActiveReservation =
    requiredByMaterial.size > 0 &&
    [...requiredByMaterial].every(
      ([materialId, mass]) => activeReservedByMaterial.get(materialId) === mass
    );
  if (!trial) return <p aria-busy="true">Loading Trial…</p>;
  const canEditEvaluation = evaluation?.status === "DRAFT" && trial.status === "PREPARED";

  const prompts =
    trial.compositionKind === "FULL_FORMULA"
      ? [
          "Opening",
          "Heart / Development",
          "Drydown",
          "Overall Balance",
          "Phase Continuity",
          "Brief Alignment",
          "Qualitative Diffusion"
        ]
      : [
          "Concept Fidelity",
          "Functional Role",
          "Target Phase",
          "Clarity",
          "Balance",
          "Coherence",
          "Usefulness as a Building Block"
        ];

  return (
    <section className="nox-trial" aria-labelledby="trial-detail-title">
      <header className="nox-design-header">
        <div>
          <button type="button" className="nox-design-back" onClick={() => navigate("/trials")}>
            ← Trial Registry
          </button>
          <p className="nox-ai-context">
            {statusLabel(trial.status)} · {trial.compositionKind.replaceAll("_", " ")}
          </p>
          <h1 id="trial-detail-title">{formula?.name ?? `Trial ${trial.id.slice(0, 8)}`}</h1>
        </div>
        <div className="nox-design-reference-mass">
          <span>Target batch</span>
          <strong>{formatMassMg(trial.preparation.targetMassMg)}</strong>
        </div>
      </header>
      <div className="nox-trial-layout">
        <section className="nox-design-plan" aria-labelledby="preparation-title">
          <h2 id="preparation-title">Preparation</h2>
          <dl className="nox-design-intent-list">
            <div>
              <dt>Formula</dt>
              <dd>
                v{formula?.versionNumber ?? "—"} · <code>{trial.formulaVersionId}</code>
              </dd>
            </div>
            <div>
              <dt>Bundle</dt>
              <dd>
                <code>{trial.formulaBundleHash.slice(0, 16)}…</code>
              </dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{trial.preparation.preparationMode.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Application</dt>
              <dd>
                {trial.preparation.applicationKey} · {trial.preparation.dosagePct}%
              </dd>
            </div>
            <div>
              <dt>Carrier</dt>
              <dd>{trial.preparation.carrierOrBaseReference ?? "—"}</dd>
            </div>
          </dl>
          {trial.status === "DRAFT" ? (
            <>
              <h3>Lot allocation</h3>
              <p className="nox-design-muted">
                Reservation reduces Available only. Physical stock is consumed atomically when this
                Trial enters PREPARED.
              </p>
              <div className="nox-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Material required</th>
                      <th>Required</th>
                      <th>Allocated</th>
                      <th>Remaining</th>
                      <th>Selected Lot / Location</th>
                      <th>On Hand</th>
                      <th>Reserved</th>
                      <th>Available</th>
                      <th>Expiry / HOLD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preparationPlan?.requirements.flatMap((requirement) => {
                      const rows = allocations.filter(
                        (item) => item.materialId === requirement.materialId
                      );
                      const rendered =
                        rows.length > 0
                          ? rows
                          : [
                              {
                                materialId: requirement.materialId,
                                lotId: "",
                                locationId: "",
                                quantityMg: requirement.requiredMassMg
                              }
                            ];
                      const candidates =
                        inventory?.allocations.filter(
                          (item) => item.materialId === requirement.materialId
                        ) ?? [];
                      return rendered.map((allocation, allocationIndex) => {
                        const candidate = candidates.find(
                          (item) =>
                            item.lotId === allocation.lotId &&
                            item.locationId === allocation.locationId
                        );
                        const allocated = allocatedByMaterial.get(requirement.materialId) ?? 0n;
                        const remaining = BigInt(requirement.requiredMassMg) - allocated;
                        return (
                          <tr key={`${requirement.materialId}:${allocationIndex}`}>
                            <td>{names.get(requirement.materialId) ?? requirement.materialId}</td>
                            <td>{formatMassMg(requirement.requiredMassMg)}</td>
                            <td>
                              <input
                                aria-label="Allocated mass in milligrams"
                                inputMode="numeric"
                                pattern="[1-9][0-9]*"
                                value={allocation.quantityMg}
                                disabled={exactActiveReservation}
                                onChange={(event) =>
                                  setAllocations((current) => {
                                    const matches = current.filter(
                                      (item) => item.materialId === requirement.materialId
                                    );
                                    if (matches.length === 0)
                                      return [
                                        ...current,
                                        { ...allocation, quantityMg: event.target.value }
                                      ];
                                    let seen = -1;
                                    return current.map((item) =>
                                      item.materialId === requirement.materialId &&
                                      ++seen === allocationIndex
                                        ? { ...item, quantityMg: event.target.value }
                                        : item
                                    );
                                  })
                                }
                              />
                            </td>
                            <td>{formatMassMg((remaining > 0n ? remaining : 0n).toString())}</td>
                            <td>
                              <select
                                aria-label="Inventory Lot and Location"
                                value={`${allocation.lotId}:${allocation.locationId}`}
                                disabled={exactActiveReservation}
                                onChange={(event) => {
                                  const selected = candidates.find(
                                    (item) =>
                                      `${item.lotId}:${item.locationId}` === event.target.value
                                  );
                                  if (!selected) return;
                                  setAllocations((current) => {
                                    const matches = current.filter(
                                      (item) => item.materialId === requirement.materialId
                                    );
                                    const next = {
                                      ...allocation,
                                      lotId: selected.lotId,
                                      locationId: selected.locationId
                                    };
                                    if (matches.length === 0) return [...current, next];
                                    let seen = -1;
                                    return current.map((item) =>
                                      item.materialId === requirement.materialId &&
                                      ++seen === allocationIndex
                                        ? next
                                        : item
                                    );
                                  });
                                }}
                              >
                                <option value=":" disabled>
                                  Select eligible stock
                                </option>
                                {candidates.map((item) => (
                                  <option
                                    key={`${item.lotId}:${item.locationId}`}
                                    value={`${item.lotId}:${item.locationId}`}
                                    disabled={!item.eligible}
                                  >
                                    {item.lotCode} · {item.locationCode}
                                    {item.eligible ? "" : ` · ${item.ineligibilityReason}`}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>{candidate ? formatMassMg(candidate.onHandMg) : "—"}</td>
                            <td>{candidate ? formatMassMg(candidate.reservedMg) : "—"}</td>
                            <td>{candidate ? formatMassMg(candidate.availableMg) : "—"}</td>
                            <td>
                              {candidate
                                ? `${candidate.expiresAt ? new Date(candidate.expiresAt).toLocaleDateString() : "No expiry"}${candidate.availabilityStatus === "HOLD" ? " · HOLD" : ""}${candidate.retestAt && new Date(candidate.retestAt) <= new Date() ? " · RETEST DUE" : ""}`
                                : "—"}
                            </td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              </div>
              {!exactActiveReservation && has(modulePermissions, permissions.prepare) ? (
                <div className="nox-trial-actions">
                  <button
                    type="button"
                    disabled={
                      working ||
                      !exactDraftAllocation ||
                      allocations.some((item) => !item.lotId || !item.locationId)
                    }
                    onClick={() =>
                      void action(async () => {
                        await api(`/trials/${trialId}/inventory/reservations`, {
                          method: "POST",
                          tenantId,
                          body: {
                            allocations,
                            operationKey: `trial:${trialId}:allocation:${crypto.randomUUID()}`
                          }
                        });
                        await loadInventory();
                      }, "Exact Trial inventory reserved.")
                    }
                  >
                    Reserve exact allocation
                  </button>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() =>
                      setAllocations((current) => {
                        const last = current.at(-1);
                        return last ? [...current, { ...last, quantityMg: "1" }] : current;
                      })
                    }
                  >
                    Add split-lot row
                  </button>
                </div>
              ) : null}
              {exactActiveReservation ? (
                <p role="status">
                  Exact allocation reserved. Available stock reflects the reservation; on-hand is
                  unchanged.
                </p>
              ) : null}
              <div className="nox-trial-actions">
                {has(modulePermissions, permissions.prepare) ? (
                  <button
                    type="button"
                    disabled={working || !exactActiveReservation}
                    onClick={() =>
                      void action(
                        () => api(`/trials/${trialId}/prepare`, { method: "POST", tenantId }),
                        "Trial prepared with exact G4 scaling."
                      )
                    }
                  >
                    Prepare exact weighing plan
                  </button>
                ) : null}
                {exactActiveReservation ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() =>
                      void action(async () => {
                        await api(`/trials/${trialId}/inventory/release`, {
                          method: "POST",
                          tenantId,
                          body: { operationKey: `trial:${trialId}:release:${crypto.randomUUID()}` }
                        });
                        setAllocations([]);
                        await loadInventory();
                      }, "Draft Trial reservations released without stock movement.")
                    }
                  >
                    Release reservation
                  </button>
                ) : null}
                {has(modulePermissions, permissions.cancel) ? (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() =>
                      void action(
                        () => api(`/trials/${trialId}/cancel`, { method: "POST", tenantId }),
                        "Trial cancelled."
                      )
                    }
                  >
                    Cancel Trial
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
          <h3>Exact weighing table</h3>
          <div className="nox-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Amount</th>
                  <th>Frozen snapshot</th>
                </tr>
              </thead>
              <tbody>
                {trial.lines.map((line) => (
                  <tr key={line.materialId}>
                    <td>{names.get(line.materialId) ?? line.materialId}</td>
                    <td>{formatMassMg(line.scaledMassMg)}</td>
                    <td>
                      <code>{line.materialSnapshotHash.slice(0, 12)}…</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {trial.lines.length === 0 ? <p>No weighing plan until the Trial is prepared.</p> : null}
          {trial.status !== "DRAFT" && inventoryTrace ? (
            <>
              <h3>Consumed Inventory Trace</h3>
              <p className="nox-design-muted">
                This physical preparation consumed the exact Lot set below. Evaluation does not
                change these movements.
              </p>
              <div className="nox-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Lot</th>
                      <th>Location</th>
                      <th>Consumed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventoryTrace.movements.map((movement) => (
                      <tr key={movement.id}>
                        <td>{names.get(movement.materialId) ?? movement.materialId}</td>
                        <td>
                          <a href={`/inventory/lots/${movement.lotId}`}>
                            {movement.lotId.slice(0, 8)}…
                          </a>
                        </td>
                        <td>{movement.fromLocationId ?? "—"}</td>
                        <td>{formatMassMg(movement.quantityMg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {inventoryTrace.movements.length === 0 ? (
                <p className="nox-design-warning">No physical Inventory trace is available.</p>
              ) : null}
            </>
          ) : null}
        </section>
        <section className="nox-design-panel" aria-labelledby="sensory-title">
          <p className="nox-ai-context">
            WHOLE {trial.compositionKind === "FULL_FORMULA" ? "FORMULA" : "ACCORD"}
          </p>
          <h2 id="sensory-title">Sensory Evaluation</h2>
          <ul className="nox-trial-prompts">
            {prompts.map((prompt) => (
              <li key={prompt}>{prompt}</li>
            ))}
          </ul>
          {!evaluation &&
          trial.status === "PREPARED" &&
          has(modulePermissions, permissions.createEvaluation) ? (
            <button
              type="button"
              disabled={working}
              onClick={() =>
                void action(
                  () =>
                    api(`/trials/${trialId}/evaluations`, {
                      method: "POST",
                      tenantId,
                      body: {
                        evaluationMedium: "BLOTTER",
                        sampleAgeMinutes: 0,
                        temperatureC: null,
                        humidityPct: null,
                        evaluationText: "",
                        diagnosticNote: null
                      }
                    }),
                  "Draft evaluation started."
                )
              }
            >
              Start sensory evaluation
            </button>
          ) : null}
          {evaluation ? (
            <>
              <label>
                What did this sample smell like?
                <textarea
                  value={evaluationText}
                  disabled={!canEditEvaluation}
                  onChange={(event) => setEvaluationText(event.target.value)}
                />
              </label>
              <div className="nox-trial-form-grid">
                <label>
                  Medium
                  <select
                    value={medium}
                    disabled={!canEditEvaluation}
                    onChange={(event) => setMedium(event.target.value as typeof medium)}
                  >
                    {["BLOTTER", "SKIN", "PRODUCT", "OTHER"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Sample age (minutes)
                  <input
                    type="number"
                    min="0"
                    value={sampleAgeMinutes}
                    disabled={!canEditEvaluation}
                    onChange={(event) => setSampleAgeMinutes(Number(event.target.value))}
                  />
                </label>
                <label>
                  Temperature (°C)
                  <input
                    type="number"
                    step="0.1"
                    value={temperatureC ?? ""}
                    disabled={!canEditEvaluation}
                    onChange={(event) =>
                      setTemperatureC(event.target.value === "" ? null : Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  Humidity (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={humidityPct ?? ""}
                    disabled={!canEditEvaluation}
                    onChange={(event) =>
                      setHumidityPct(event.target.value === "" ? null : Number(event.target.value))
                    }
                  />
                </label>
              </div>
              <label>
                Diagnostic note (non-canonical hypothesis)
                <textarea
                  value={diagnosticNote}
                  disabled={!canEditEvaluation}
                  onChange={(event) => setDiagnosticNote(event.target.value)}
                />
              </label>
              <h3>Confirmed taxonomy deltas</h3>
              <p className="nox-design-muted">
                OSMO · osmo_v1.2. Deltas describe whole-composition intent; no Material score is
                stored.
              </p>
              <div className="nox-trial-deltas">
                {deltas.map((delta, index) => (
                  <div
                    className="nox-trial-delta"
                    key={`${delta.phase}:${delta.assignmentType}:${delta.taxonomyTerm}`}
                  >
                    <select
                      aria-label="Sensory phase"
                      value={delta.phase}
                      disabled={!canEditEvaluation}
                      onChange={(event) =>
                        setDeltas(
                          deltas.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, phase: event.target.value as SensoryDeltaDraft["phase"] }
                              : item
                          )
                        )
                      }
                    >
                      {["TOP", "MID", "BASE", "CROSS_PHASE"].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Canonical taxonomy term"
                      value={`${delta.assignmentType}:${delta.taxonomyTerm}`}
                      disabled={!canEditEvaluation}
                      onChange={(event) => {
                        const choice = taxonomy.find(
                          (item) =>
                            `${item.assignmentType}:${item.taxonomyTerm}` === event.target.value
                        );
                        if (choice)
                          setDeltas(
                            deltas.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, ...choice } : item
                            )
                          );
                      }}
                    >
                      {taxonomy.map((choice) => (
                        <option
                          key={`${choice.assignmentType}:${choice.taxonomyTerm}`}
                          value={`${choice.assignmentType}:${choice.taxonomyTerm}`}
                        >
                          {choice.assignmentType} · {choice.taxonomyTerm}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="Confirmed delta"
                      type="number"
                      min="-5"
                      max="5"
                      step="1"
                      value={delta.confirmedDelta ?? 0}
                      disabled={!canEditEvaluation}
                      onChange={(event) =>
                        setDeltas(
                          deltas.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, confirmedDelta: Number(event.target.value) }
                              : item
                          )
                        )
                      }
                    />
                    {canEditEvaluation ? (
                      <button
                        type="button"
                        onClick={() =>
                          setDeltas(deltas.filter((_, itemIndex) => itemIndex !== index))
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              {canEditEvaluation ? (
                <>
                  <button type="button" onClick={addDelta} disabled={taxonomy.length === 0}>
                    Add taxonomy delta
                  </button>
                  <button
                    type="button"
                    disabled={working || !has(modulePermissions, permissions.editEvaluation)}
                    onClick={() => void action(saveEvaluation, "Draft sensory evidence saved.")}
                  >
                    Save Draft
                  </button>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() =>
                      void action(
                        () =>
                          api(`/trials/${trialId}/evaluations/${evaluation.id}/interpret`, {
                            method: "POST",
                            tenantId
                          }),
                        "Interpreter suggestions loaded."
                      )
                    }
                  >
                    Interpret text
                  </button>
                  <p className="nox-design-muted">
                    If interpretation is unavailable, manual mapping remains authoritative.
                  </p>
                  <label>
                    Final decision
                    <select
                      value={decision}
                      onChange={(event) =>
                        setDecision(event.target.value as FinalEvaluationDecision)
                      }
                    >
                      <option value="REVISION_REQUIRED">Revision required</option>
                      <option value="READY_FOR_APPROVAL">Ready for approval</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={working || !has(modulePermissions, permissions.finalizeEvaluation)}
                    onClick={() =>
                      void action(async () => {
                        await saveEvaluation();
                        await api(`/trials/${trialId}/evaluations/${evaluation.id}/finalize`, {
                          method: "POST",
                          tenantId,
                          body: { decision, deltas }
                        });
                      }, "Evaluation FINAL; raw evidence is immutable.")
                    }
                  >
                    Finalize Evaluation
                  </button>
                </>
              ) : evaluation.status === "FINAL" ? (
                <p>
                  <strong>FINAL · {evaluation.decision?.replaceAll("_", " ")}</strong>
                </p>
              ) : (
                <p role="status">Draft evidence is locked because the Trial is not PREPARED.</p>
              )}
            </>
          ) : null}
          {evaluation?.status === "FINAL" &&
          evaluation.decision === "REVISION_REQUIRED" &&
          has(modulePermissions, permissions.revision) ? (
            <button
              type="button"
              disabled={working}
              onClick={() =>
                void action(async () => {
                  const response = await api<{ candidates: FormulaCandidate[] }>(
                    `/trials/${trialId}/evaluations/${evaluation.id}/create-revision`,
                    { method: "POST", tenantId }
                  );
                  setRevisionCandidates(response.candidates);
                }, "G4 generated revision candidates from confirmed sensory intent.")
              }
            >
              Create Revision Candidates
            </button>
          ) : null}
          {revisionCandidates.length > 0 ? (
            <div>
              <h3>G4 revision candidates</h3>
              {revisionCandidates.map((candidate) => (
                <button
                  key={candidate.candidateId}
                  type="button"
                  disabled={working || !has(modulePermissions, permissions.freezeRevision)}
                  onClick={() =>
                    void action(
                      () =>
                        api(
                          `/design-studio/formula-versions/${trial.formulaVersionId}/revisions/freeze`,
                          {
                            method: "POST",
                            tenantId,
                            body: {
                              sourceTrialId: trial.id,
                              sourceEvaluationId: evaluation!.id,
                              strategy: candidate.generationStrategy,
                              formulaName: formula?.name ?? "Sensory Revision"
                            }
                          }
                        ),
                      "New immutable FormulaVersion frozen with parent lineage."
                    )
                  }
                >
                  {candidate.generationStrategy} · Freeze Revision
                </button>
              ))}
            </div>
          ) : null}
          {evaluation?.status === "FINAL" &&
          evaluation.decision === "READY_FOR_APPROVAL" &&
          has(modulePermissions, permissions.recommendApproval) ? (
            <button
              type="button"
              disabled={working}
              onClick={() =>
                void action(
                  () =>
                    api(`/trials/${trialId}/evaluations/${evaluation.id}/recommend-approval`, {
                      method: "POST",
                      tenantId
                    }),
                  "Approval evidence validated. Return to Design Studio approval."
                )
              }
            >
              Recommend Approval
            </button>
          ) : null}
          {evaluation?.status === "FINAL" &&
          evaluation.decision === "READY_FOR_APPROVAL" &&
          has(modulePermissions, permissions.approveFormula) ? (
            <button
              type="button"
              disabled={working}
              onClick={() =>
                void action(async () => {
                  await api(`/design-studio/formula-versions/${trial.formulaVersionId}/approve`, {
                    method: "POST",
                    tenantId,
                    body: { sourceTrialId: trial.id, sourceEvaluationId: evaluation.id }
                  });
                  navigate(`/design-studio/formula-versions/${trial.formulaVersionId}`);
                }, "Formula approved by G4 using FINAL G5 evidence.")
              }
            >
              Approve in Design Studio
            </button>
          ) : null}
        </section>
      </div>
      {notice ? (
        <p className="nox-design-warning" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="nox-design-warning" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function TrialSensoryExperience({
  api,
  tenantId,
  modulePermissions
}: {
  api: ApiClient;
  tenantId?: string;
  modulePermissions: readonly string[];
}) {
  if (!tenantId || !has(modulePermissions, permissions.read)) {
    return (
      <section aria-labelledby="trial-denied-title">
        <p className="nox-ai-context">403 · PERMISSION_DENIED</p>
        <h1 id="trial-denied-title">Trial & Sensory access denied</h1>
        <p>An active entitled tenant context is required.</p>
      </section>
    );
  }
  return (
    <Routes>
      <Route
        index
        element={
          <TrialRegistry api={api} tenantId={tenantId} modulePermissions={modulePermissions} />
        }
      />
      <Route
        path=":trialId"
        element={
          <TrialDetail api={api} tenantId={tenantId} modulePermissions={modulePermissions} />
        }
      />
    </Routes>
  );
}
