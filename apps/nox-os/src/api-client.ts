export type ApiClient = <T>(
  path: string,
  options?: { method?: "GET" | "POST" | "PATCH" | "PUT"; body?: unknown; tenantId?: string }
) => Promise<T>;

// Shared transport error identity must not require loading a control-plane screen.
export class NoxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "NoxApiError";
  }
}
