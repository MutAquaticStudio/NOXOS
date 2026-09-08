import { useRef, useState } from "react";
import { NoxDialog } from "@nox-os/ui";

/** Confirmation UI only. Permission/state and transaction guarantees stay with the caller/server. */
export function CommercialAction({
  label,
  target,
  state,
  version,
  effect,
  permission,
  disabled = false,
  input,
  onConfirm
}: {
  label: string;
  target: string;
  state: string;
  version?: string;
  effect: string;
  permission: string;
  disabled?: boolean;
  input?: { label: string; maxLength: number };
  onConfirm: (value: string) => Promise<void>;
}) {
  const [opened, setOpened] = useState<string>();
  const [value, setValue] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const sending = useRef(false);
  const current = JSON.stringify([target, state, version]);
  const stale = opened !== undefined && opened !== current;
  const close = () => {
    if (!sending.current) setOpened(undefined);
  };
  return (
    <>
      <button
        type="button"
        disabled={disabled || working}
        onClick={() => {
          setValue("");
          setError(undefined);
          setOpened(current);
        }}
      >
        {label}
      </button>
      {opened !== undefined ? (
        <NoxDialog title={label} onClose={close}>
          <form
            className="nox-commercial-dialog"
            onSubmit={async (event) => {
              event.preventDefault();
              if (sending.current || disabled || stale || error || (input && !value.trim())) return;
              sending.current = true;
              setWorking(true);
              try {
                await onConfirm(value.trim());
                setOpened(undefined);
              } catch (reason) {
                setError(
                  reason instanceof Error ? reason.message : "The request could not be confirmed."
                );
              } finally {
                sending.current = false;
                setWorking(false);
              }
            }}
          >
            <dl className="nox-commercial-facts">
              <dt>Target</dt>
              <dd>{target}</dd>
              <dt>Current state</dt>
              <dd>{state}</dd>
              <dt>Required permission</dt>
              <dd>{permission}</dd>
            </dl>
            <p>{effect}</p>
            <p>
              The server rechecks authority and current state. A successful change is audited; this
              workspace reloads the canonical result.
            </p>
            {input ? (
              <label>
                {input.label}
                <input
                  required
                  maxLength={input.maxLength}
                  value={value}
                  disabled={working}
                  onChange={(event) => setValue(event.target.value)}
                />
              </label>
            ) : null}
            {stale || disabled ? (
              <p role="alert">
                State or permission changed. Close this dialog and review the current object.
              </p>
            ) : null}
            {error ? (
              <div role="alert">
                <p>{error}</p>
                <p>No success is assumed. Close and reload current state before trying again.</p>
              </div>
            ) : null}
            <div className="nox-table-actions">
              <button type="button" disabled={working} onClick={close}>
                Back without changes
              </button>
              <button
                type="submit"
                disabled={
                  working || disabled || stale || Boolean(error) || Boolean(input && !value.trim())
                }
              >
                {working ? "Submitting…" : `Confirm ${label}`}
              </button>
            </div>
          </form>
        </NoxDialog>
      ) : null}
    </>
  );
}
