import { useEffect, useState } from "react";
import type { WorkspaceScope } from "./workspace-tabs";

export type ShellPreferences = {
  inspectorOpen: boolean;
  inspectorWidth: number;
  density: "MODULE" | "COMPACT" | "DEFAULT" | "COMFORTABLE";
  interaction: "AUTO" | "POINTER" | "TOUCH";
};
const defaults: ShellPreferences = {
  inspectorOpen: false,
  inspectorWidth: 320,
  density: "MODULE",
  interaction: "AUTO"
};
export const clampInspectorWidth = (width: number) =>
  Number.isFinite(width) ? Math.min(420, Math.max(280, Math.round(width))) : 320;

export function parseShellPreferences(raw: string | null): ShellPreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.schemaVersion !== 1) return { ...defaults };
    return {
      inspectorOpen: value.inspectorOpen === true,
      inspectorWidth:
        typeof value.inspectorWidth === "number" ? clampInspectorWidth(value.inspectorWidth) : 320,
      density: ["COMPACT", "DEFAULT", "COMFORTABLE"].includes(value.density)
        ? value.density
        : "MODULE",
      interaction: ["POINTER", "TOUCH"].includes(value.interaction) ? value.interaction : "AUTO"
    };
  } catch {
    return { ...defaults };
  }
}

function read(key: string | undefined): ShellPreferences {
  try {
    return parseShellPreferences(key ? localStorage.getItem(key) : null);
  } catch {
    return { ...defaults };
  }
}

/** Presentation only; never stores object data or authorization. */
export function useShellPreferences(scope?: WorkspaceScope) {
  const key = scope
    ? `nox:shell:v1:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.tenantId)}`
    : undefined;
  const [state, setState] = useState(() => ({ key, value: read(key) }));
  // Scope can become available after the authenticated context query finishes.
  // Reset before rendering rather than displaying or persisting the previous scope.
  if (state.key !== key) setState({ key, value: read(key) });
  useEffect(() => {
    if (!key || state.key !== key) return;
    try {
      localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, ...state.value }));
    } catch {
      /* Preference storage is optional; in-memory controls remain usable. */
    }
  }, [key, state]);
  const update = (change: Partial<ShellPreferences>) =>
    setState((current) => ({
      key,
      value: { ...(current.key === key ? current.value : read(key)), ...change }
    }));
  return [state.value, update] as const;
}
