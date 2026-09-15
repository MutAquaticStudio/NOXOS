export type PhaseNode = {
  label: string;
  state: "complete" | "current" | "available" | "blocked" | "not-started";
  detail: string;
  href?: string;
};
export type DevelopmentContext = {
  currentLabel: string;
  detail: string;
  nodes: readonly PhaseNode[];
};

const symbols = { complete: "✓", current: "●", available: "↗", blocked: "—", "not-started": "○" };

/** Read-only navigation. Domain commands deliberately do not enter the shell. */
export function DevelopmentSpine({
  context,
  onNavigate
}: {
  context: DevelopmentContext;
  onNavigate: (href: string) => void;
}) {
  const nodes = context.nodes.map((node) => (
    <li key={node.label} data-state={node.state}>
      {node.href ? (
        <button
          type="button"
          onClick={() => onNavigate(node.href!)}
          aria-current={node.state === "current" ? "step" : undefined}
          title={`${node.state}: ${node.detail}`}
        >
          <span aria-hidden="true">{symbols[node.state]}</span> {node.label}
          <span className="nox-phase-state"> · {node.state}</span>
        </button>
      ) : (
        <span title={node.detail}>
          <span aria-hidden="true">{symbols[node.state]}</span> {node.label}
          <span className="nox-phase-state"> · {node.state}</span>
        </span>
      )}
    </li>
  ));
  return (
    <nav className="nox-development-spine" aria-label="Development lifecycle">
      <div className="nox-spine-desktop">
        <ol>{nodes}</ol>
        <span className="nox-spine-context">
          {context.currentLabel} · {context.detail}
        </span>
      </div>
      <details
        className="nox-spine-compact"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}
      >
        <summary>
          {context.currentLabel} · {context.detail}
        </summary>
        <ol>{nodes}</ol>
      </details>
    </nav>
  );
}
