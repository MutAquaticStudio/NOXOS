export type NoxReadState = "LOADING" | "READY" | "ERROR";

// Shared presentation only. Screens own their queries, cancellation and data.
export function NoxReadFeedback({
  state,
  subject,
  retry,
  disabled = false,
  empty
}: {
  state: NoxReadState;
  subject: string;
  retry: () => void | Promise<void>;
  disabled?: boolean;
  empty?: string;
}) {
  return (
    <div>
      {state === "LOADING" ? <p role="status">Loading {subject} data…</p> : null}
      {state === "ERROR" ? (
        <p role="status">
          Current {subject} data could not be verified. Any retained rows are last-loaded data;
          dependent actions are unavailable.
        </p>
      ) : null}
      {state === "READY" && empty ? <p>{empty}</p> : null}
      <button
        type="button"
        disabled={disabled || state === "LOADING"}
        onClick={() => void Promise.resolve(retry()).catch(() => {})}
      >
        {state === "ERROR" ? "Retry" : "Refresh"} {subject}
      </button>
    </div>
  );
}
