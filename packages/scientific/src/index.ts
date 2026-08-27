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
