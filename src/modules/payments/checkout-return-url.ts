const allowedMobileProtocols = new Set(["ca.chaufx.customer:"]);

export function safeCheckoutReturnUrl(
  requestedUrl: string | undefined,
  fallbackUrl: string,
  clientAppUrl: string
) {
  const fallback = new URL(fallbackUrl);
  if (!requestedUrl) return fallback;

  try {
    const requested = new URL(requestedUrl);
    const client = new URL(clientAppUrl);
    const isConfiguredWebClient =
      (requested.protocol === "https:" || requested.protocol === "http:") &&
      requested.origin === client.origin;
    const isCustomerApp = allowedMobileProtocols.has(requested.protocol);

    return isConfiguredWebClient || isCustomerApp ? requested : fallback;
  } catch {
    return fallback;
  }
}
