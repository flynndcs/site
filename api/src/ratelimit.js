// Per-IP rate limiting using Workers rate limiting bindings (see wrangler.toml).
// If a binding isn't configured (e.g. older local setup) this fails open.

// Which limiter guards which route. First match wins.
const RULES = [
  { binding: "CHECKOUT_LIMITER", test: (m, p) => m === "POST" && p === "/checkout" },
  { binding: "ADMIN_LIMITER", test: (m, p) => p.startsWith("/admin/") || p.startsWith("/flags/") },
  { binding: "DOWNLOAD_LIMITER", test: (m, p) => p.startsWith("/download/") },
  { binding: "HELLO_LIMITER", test: (m, p) => p === "/hello" },
];

export async function isRateLimited(request, env, pathname) {
  const rule = RULES.find((r) => r.test(request.method, pathname));
  const limiter = rule && env[rule.binding];
  if (!limiter) return false;
  const key = request.headers.get("CF-Connecting-IP") || "unknown";
  const { success } = await limiter.limit({ key });
  return !success;
}
