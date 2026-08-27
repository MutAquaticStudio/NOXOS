import type { ModuleDescriptor } from "@nox-os/contracts";

export function FoundationModuleSurface({ descriptor }: { descriptor: ModuleDescriptor }) {
  return (
    <section aria-labelledby="foundation-module-title">
      <p className="nox-ai-context">GATE 1 FOUNDATION · {descriptor.id}</p>
      <h1 id="foundation-module-title">{descriptor.displayName}</h1>
      <p>
        This route proves registry ownership, shell composition, and lazy module loading. Business
        workflows and domain records are intentionally not implemented here.
      </p>
      <dl>
        <div>
          <dt>Lifecycle</dt>
          <dd>{descriptor.lifecycle}</dd>
        </div>
        <div>
          <dt>UX profile</dt>
          <dd>{descriptor.uxProfileId}</dd>
        </div>
        <div>
          <dt>API namespace</dt>
          <dd>{descriptor.apiNamespace}</dd>
        </div>
      </dl>
    </section>
  );
}
