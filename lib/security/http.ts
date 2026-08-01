import { configuredUsercontentOrigin } from "@/lib/security/usercontent";

const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export function secureJson(
  body: unknown,
  init: ResponseInit & { status?: number } = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function publicSecurityHeaders(): Headers {
  const usercontentOrigin = configuredUsercontentOrigin();
  const usercontentSource = usercontentOrigin ? ` ${usercontentOrigin}` : "";
  return new Headers({
    "Content-Security-Policy":
      `default-src 'self'; script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://*.clerk.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:${usercontentSource}; media-src 'self' blob:${usercontentSource}; connect-src 'self' https://*.clerk.accounts.dev https://api.clerk.com; frame-src https://*.clerk.accounts.dev${usercontentSource}; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://*.clerk.accounts.dev; object-src 'none'; upgrade-insecure-requests`,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
}
