import type { ScientificGateway, ScientificResult } from "@nox-os/contracts";

export class UnavailableScientificAdapter implements ScientificGateway {
  async evaluate<TInput, TResult>(_input: TInput): Promise<ScientificResult<TResult>> {
    return {
      state: "UNAVAILABLE",
      reason: "Scientific Runtime is not configured."
    };
  }
}

export class MockScientificAdapter implements ScientificGateway {
  constructor(private readonly resolver: (input: unknown) => unknown) {}

  async evaluate<TInput, TResult>(input: TInput): Promise<ScientificResult<TResult>> {
    return {
      state: "AVAILABLE",
      value: this.resolver(input) as TResult
    };
  }
}

export type NoxOeAdapterOptions = {
  endpoint: string;
  internalToken: string;
  timeoutMs?: number;
  request?: typeof fetch;
};

/** Server-only adapter. The sidecar never becomes a browser or ERP critical path. */
export class NoxOeScientificAdapter implements ScientificGateway {
  private readonly request: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: NoxOeAdapterOptions) {
    this.request = options.request ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 4_000;
  }

  async evaluate<TInput, TResult>(input: TInput): Promise<ScientificResult<TResult>> {
    try {
      const healthProbe = input === undefined;
      const response = await this.request(
        new URL(healthProbe ? "/ready" : "/v1/evaluate", this.options.endpoint),
        healthProbe
          ? { method: "GET", signal: AbortSignal.timeout(this.timeoutMs) }
          : {
              method: "POST",
              headers: {
                authorization: `Bearer ${this.options.internalToken}`,
                "content-type": "application/json"
              },
              body: JSON.stringify(input),
              signal: AbortSignal.timeout(this.timeoutMs)
            }
      );
      if (!response.ok) {
        return { state: "DEGRADED", reason: "Scientific Runtime rejected the request." };
      }
      const payload = (await response.json()) as
        | { state: "AVAILABLE"; value?: TResult }
        | { state: "UNAVAILABLE"; code?: string; reason?: string }
        | { status: "READY" | "DEGRADED"; scientificCapability: string };
      if ("scientificCapability" in payload) {
        return payload.scientificCapability === "AVAILABLE"
          ? { state: "AVAILABLE" }
          : { state: "UNAVAILABLE", reason: payload.scientificCapability };
      }
      return payload.state === "AVAILABLE"
        ? { state: "AVAILABLE", value: payload.value ?? (payload as TResult) }
        : { state: "UNAVAILABLE", reason: payload.code ?? payload.reason ?? "MODEL_UNAVAILABLE" };
    } catch {
      return { state: "UNAVAILABLE", reason: "SCIENTIFIC_RUNTIME_UNAVAILABLE" };
    }
  }
}
