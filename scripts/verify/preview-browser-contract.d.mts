export interface PreviewBrowserContractResponse {
  status?: number;
  body?: {
    error?: {
      code?: string;
    };
  } & Record<string, unknown>;
}

export function resolvePreviewBrowserContract(
  response: PreviewBrowserContractResponse
): "AUTHENTICATED_PLATFORM" | "LEGACY_G1_SHELL";
