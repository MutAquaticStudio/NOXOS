/**
 * The trusted Preview verifier is deliberately compatible with the two
 * accepted browser contracts that can exist during a Gate transition:
 *
 * - G1's public structural shell has no /me endpoint yet.
 * - G2's Platform Core must fail closed before showing protected shell UI.
 *
 * Any other response is an unexpected deployment contract and fails closed.
 */
export function resolvePreviewBrowserContract(response) {
  const code = response?.body?.error?.code;

  if (response?.status === 401 && code === "AUTH_REQUIRED") {
    return "AUTHENTICATED_PLATFORM";
  }

  if (response?.status === 404 && code === "NOT_FOUND") {
    return "LEGACY_G1_SHELL";
  }

  throw new Error(
    "Preview browser contract is neither the legacy G1 shell nor the authenticated Platform Core."
  );
}
