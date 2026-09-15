import { useEffect, useState } from "react";
import { NoxDialog, useUnsavedChanges } from "@nox-os/ui";
import type { ApiClient } from "./platform-control";

type OrderLine = { id: string; line_kind: string; title_snapshot: string };
type Allocation = {
  id: string;
  order_line_id: string;
  state: string;
  material_lot_id: string | null;
  production_batch_id: string | null;
  quantity_value: string;
};
type Draft = { orderLineId: string; allocationId: string; quantityValue: string };

export function FulfillmentLines({
  api,
  fulfillmentId,
  orderId,
  orderLines,
  allocations,
  onClose
}: {
  api: ApiClient;
  fulfillmentId: string;
  orderId: string;
  orderLines: readonly OrderLine[];
  allocations: readonly Allocation[];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  useUnsavedChanges(dirty);
  useEffect(() => {
    let current = true;
    void api<{
      fulfillment: { id: string; order_id: string; status: string };
      lines: Array<{ order_line_id: string; allocation_id: string | null; quantity_value: string }>;
    }>(`/commercial-orders/fulfillments/${fulfillmentId}`)
      .then((result) => {
        if (!current) return;
        if (
          result.fulfillment.id !== fulfillmentId ||
          result.fulfillment.order_id !== orderId ||
          result.fulfillment.status !== "DRAFT"
        )
          throw Error("This fulfillment is not an editable draft for the current Order.");
        setDraft(
          result.lines.map((line) => ({
            orderLineId: line.order_line_id,
            allocationId: line.allocation_id ?? "",
            quantityValue: line.quantity_value
          }))
        );
        setLoaded(true);
      })
      .catch(
        (reason) =>
          current &&
          setError(
            reason instanceof Error ? reason.message : "Fulfillment lines could not be loaded."
          )
      );
    return () => {
      current = false;
    };
  }, [api, fulfillmentId, orderId]);
  const change = (index: number, patch: Partial<Draft>) => {
    setDraft((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setDirty(true);
  };
  const close = () => (dirty ? setDiscard(true) : onClose());
  return (
    <NoxDialog title="Fulfillment lines" onClose={close}>
      <div className="nox-commercial-dialog">
        <p>
          Draft fulfillment <code>{fulfillmentId}</code>. Physical lines require exact active
          allocations; service lines do not consume inventory.
        </p>
        {error ? (
          <p role="alert">{error}</p>
        ) : !loaded ? (
          <p role="status" aria-busy="true">
            Loading saved fulfillment lines…
          </p>
        ) : (
          <>
            {draft.map((row, index) => {
              const line = orderLines.find((item) => item.id === row.orderLineId);
              const service = line?.line_kind === "SERVICE_SCOPE";
              const eligible = allocations.filter(
                (item) => item.order_line_id === row.orderLineId && item.state === "ACTIVE"
              );
              return (
                <fieldset key={index}>
                  <legend>Line {index + 1}</legend>
                  <label>
                    Order line {index + 1}
                    <select
                      value={row.orderLineId}
                      onChange={(event) => {
                        const next = orderLines.find((item) => item.id === event.target.value);
                        change(index, {
                          orderLineId: event.target.value,
                          allocationId: "",
                          quantityValue: next?.line_kind === "SERVICE_SCOPE" ? "1" : ""
                        });
                      }}
                    >
                      <option value="">Select an Order line</option>
                      {orderLines.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title_snapshot} · {item.line_kind}
                        </option>
                      ))}
                    </select>
                  </label>
                  {service ? (
                    <p>Service scope: no allocation.</p>
                  ) : (
                    <label>
                      Active allocation {index + 1}
                      <select
                        value={row.allocationId}
                        onChange={(event) => change(index, { allocationId: event.target.value })}
                      >
                        <option value="">Select an exact active allocation</option>
                        {eligible.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.material_lot_id ?? item.production_batch_id} ·{" "}
                            {item.quantity_value} mg · {item.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {row.allocationId && !eligible.some((item) => item.id === row.allocationId) ? (
                    <p role="alert">
                      The saved allocation is no longer active or does not match this Order line.
                      Reload before saving.
                    </p>
                  ) : null}
                  <label>
                    Quantity {index + 1} ({service ? "service" : "mg"})
                    <input
                      inputMode="numeric"
                      pattern="[1-9][0-9]*"
                      value={row.quantityValue}
                      readOnly={service}
                      onChange={(event) => change(index, { quantityValue: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft((rows) => rows.filter((_, i) => i !== index));
                      setDirty(true);
                    }}
                  >
                    Remove line {index + 1}
                  </button>
                </fieldset>
              );
            })}
            {!draft.length ? <p>No saved fulfillment lines.</p> : null}
            <button
              type="button"
              disabled={draft.length >= 100}
              onClick={() => {
                setDraft((rows) => [
                  ...rows,
                  { orderLineId: "", allocationId: "", quantityValue: "" }
                ]);
                setDirty(true);
              }}
            >
              Add fulfillment line
            </button>
            <p role="status">
              Saving is blocked pending PostgreSQL transaction verification of replay and
              stale-write protection. This editor has not sent any changes.
            </p>
            <button type="button" disabled>
              Save exact lines — blocked
            </button>
          </>
        )}
        {discard ? (
          <div role="alert">
            <p>Discard the unsaved line changes?</p>
            <button type="button" onClick={() => setDiscard(false)}>
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => {
                setDirty(false);
                onClose();
              }}
            >
              Discard changes
            </button>
          </div>
        ) : (
          <button type="button" onClick={close}>
            Back to Order
          </button>
        )}
      </div>
    </NoxDialog>
  );
}
