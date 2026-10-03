// Store routes: products, uploads (R2), mock checkout, order fulfillment, downloads.
// Stripe is intentionally mocked — see createCheckout() and handleStripeWebhook().

const DOWNLOAD_TTL_DAYS = 7;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function isAdmin(request, env) {
  const token = (request.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token || !env.ADMIN_TOKEN) return false;
  const [a, b] = await Promise.all([sha256(token), sha256(env.ADMIN_TOKEN)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

const randomHex = (bytes) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

const publicProduct = (p) => ({
  slug: p.slug,
  title: p.title,
  description: p.description,
  priceCents: p.price_cents,
  currency: p.currency,
  hasPreview: !!p.preview_key,
  previewType: p.preview_type,
});

const getProduct = (env, slug) =>
  env.DB.prepare("SELECT * FROM products WHERE slug = ?").bind(slug).first();

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// --- Stripe seam (mocked) ---

// Real version: create a Stripe Checkout Session for `product`, store its id on the
// order (stripe_session_id) and return { url: session.url }.
async function createCheckout(env, product, order) {
  return { mock: true, url: null };
}

// Real version: verify the Stripe-Signature header against env.STRIPE_WEBHOOK_SECRET,
// then on checkout.session.completed call markOrderPaid() for the matching order.
async function handleStripeWebhook(request, env) {
  return { status: 501, body: { error: "Stripe webhook not configured" } };
}

// Marks an order paid and issues its download token. Idempotent.
async function markOrderPaid(env, orderId) {
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  if (!order) return null;
  if (order.status === "paid") return order;
  const token = randomHex(32);
  const expires = new Date(Date.now() + DOWNLOAD_TTL_DAYS * 864e5).toISOString();
  await env.DB.prepare(
    "UPDATE orders SET status = 'paid', paid_at = datetime('now'), download_token = ?, download_expires_at = ? WHERE id = ?"
  ).bind(token, expires, orderId).run();
  // TODO: email the buyer their download link (e.g. Resend).
  return env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
}

// Returns a Response, or null if the path isn't a store route.
export async function handleStore(request, env, url, json) {
  const { pathname } = url;
  const method = request.method;
  let m;

  // --- Public ---

  if (pathname === "/products" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT * FROM products WHERE active = 1 AND file_key IS NOT NULL ORDER BY created_at DESC"
    ).all();
    return json(rows.results.map(publicProduct));
  }

  if ((m = pathname.match(/^\/products\/([a-z0-9-]+)$/)) && method === "GET") {
    const p = await getProduct(env, m[1]);
    if (!p || !p.active) return json({ error: "Not found" }, 404);
    return json(publicProduct(p));
  }

  if ((m = pathname.match(/^\/products\/([a-z0-9-]+)\/preview$/)) && method === "GET") {
    const p = await getProduct(env, m[1]);
    if (!p || !p.active || !p.preview_key) return json({ error: "Not found" }, 404);
    const obj = await env.BUCKET.get(p.preview_key);
    if (!obj) return json({ error: "Not found" }, 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": p.preview_type || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      },
    });
  }

  if (pathname === "/checkout" && method === "POST") {
    const body = await readJson(request);
    const email = body && typeof body.email === "string" ? body.email.trim() : "";
    if (!body || !EMAIL_RE.test(email) || email.length > 254) return json({ error: "Valid email required" }, 400);
    const p = await getProduct(env, String(body.slug || ""));
    if (!p || !p.active || !p.file_key) return json({ error: "Product not found" }, 404);

    const order = {
      id: randomHex(16),
      product_slug: p.slug,
      email,
      amount_cents: p.price_cents,
      currency: p.currency,
    };
    await env.DB.prepare(
      "INSERT INTO orders (id, product_slug, email, amount_cents, currency) VALUES (?, ?, ?, ?, ?)"
    ).bind(order.id, order.product_slug, order.email, order.amount_cents, order.currency).run();

    const session = await createCheckout(env, p, order);
    return json({ orderId: order.id, ...session });
  }

  if (pathname === "/webhooks/stripe" && method === "POST") {
    const r = await handleStripeWebhook(request, env);
    return json(r.body, r.status);
  }

  if ((m = pathname.match(/^\/download\/([a-f0-9]{64})$/)) && method === "GET") {
    const order = await env.DB.prepare(
      "SELECT o.*, p.file_key, p.file_name FROM orders o JOIN products p ON p.slug = o.product_slug WHERE o.download_token = ?"
    ).bind(m[1]).first();
    if (!order || order.status !== "paid") return json({ error: "Not found" }, 404);
    if (new Date(order.download_expires_at) < new Date()) return json({ error: "Link expired" }, 410);
    const obj = await env.BUCKET.get(order.file_key);
    if (!obj) return json({ error: "File missing" }, 404);
    const name = (order.file_name || "download").replace(/[^\w.\- ]/g, "_");
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
        "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      },
    });
  }

  // --- Admin ---

  if (!pathname.startsWith("/admin/")) return null;
  if (!(await isAdmin(request, env))) return json({ error: "Unauthorized" }, 401);

  if (pathname === "/admin/products" && method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM products ORDER BY created_at DESC").all();
    return json(rows.results);
  }

  if (pathname === "/admin/products" && method === "POST") {
    const b = await readJson(request);
    if (!b || !SLUG_RE.test(b.slug || "")) return json({ error: "Invalid slug (a-z, 0-9, -)" }, 400);
    if (!b.title || !Number.isInteger(b.priceCents) || b.priceCents < 50) {
      return json({ error: "title and integer priceCents (>= 50) required" }, 400);
    }
    try {
      await env.DB.prepare(
        "INSERT INTO products (slug, title, description, price_cents, currency) VALUES (?, ?, ?, ?, ?)"
      ).bind(b.slug, b.title, b.description || "", b.priceCents, (b.currency || "usd").toLowerCase()).run();
    } catch {
      return json({ error: "Slug already exists" }, 409);
    }
    return json(await getProduct(env, b.slug), 201);
  }

  if ((m = pathname.match(/^\/admin\/products\/([a-z0-9-]+)$/)) && method === "PATCH") {
    const p = await getProduct(env, m[1]);
    if (!p) return json({ error: "Not found" }, 404);
    const b = (await readJson(request)) || {};
    const next = {
      title: b.title ?? p.title,
      description: b.description ?? p.description,
      price_cents: b.priceCents ?? p.price_cents,
      active: b.active === undefined ? p.active : b.active ? 1 : 0,
    };
    if (!Number.isInteger(next.price_cents) || next.price_cents < 50) return json({ error: "Invalid priceCents" }, 400);
    if (next.active && !p.file_key) return json({ error: "Upload a file before activating" }, 400);
    await env.DB.prepare(
      "UPDATE products SET title = ?, description = ?, price_cents = ?, active = ? WHERE slug = ?"
    ).bind(next.title, next.description, next.price_cents, next.active, p.slug).run();
    return json(await getProduct(env, p.slug));
  }

  // Raw-body upload. `file` = the purchasable file, `preview` = public sample.
  //   curl -X PUT -H "Authorization: Bearer $T" -H "Content-Type: application/pdf" \
  //        -H "X-File-Name: score.pdf" --data-binary @score.pdf $API/admin/products/<slug>/file
  if ((m = pathname.match(/^\/admin\/products\/([a-z0-9-]+)\/(file|preview)$/)) && method === "PUT") {
    const p = await getProduct(env, m[1]);
    if (!p) return json({ error: "Not found" }, 404);
    const len = Number(request.headers.get("Content-Length") || 0);
    if (!len) return json({ error: "Content-Length required" }, 411);
    if (len > MAX_UPLOAD_BYTES) return json({ error: "File too large" }, 413);
    const kind = m[2];
    const type = request.headers.get("Content-Type") || "application/octet-stream";
    const key = `${kind === "file" ? "products" : "previews"}/${p.slug}/${randomHex(8)}`;
    await env.BUCKET.put(key, request.body, { httpMetadata: { contentType: type } });
    const oldKey = kind === "file" ? p.file_key : p.preview_key;
    if (kind === "file") {
      const name = (request.headers.get("X-File-Name") || p.slug).slice(0, 200);
      await env.DB.prepare("UPDATE products SET file_key = ?, file_name = ? WHERE slug = ?").bind(key, name, p.slug).run();
    } else {
      await env.DB.prepare("UPDATE products SET preview_key = ?, preview_type = ? WHERE slug = ?").bind(key, type, p.slug).run();
    }
    if (oldKey) await env.BUCKET.delete(oldKey);
    return json(await getProduct(env, p.slug));
  }

  if (pathname === "/admin/orders" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, product_slug, email, amount_cents, currency, status, created_at, paid_at FROM orders ORDER BY created_at DESC LIMIT 200"
    ).all();
    return json(rows.results);
  }

  // MOCK payment: stands in for the Stripe webhook until Stripe is wired up.
  if ((m = pathname.match(/^\/admin\/orders\/([a-f0-9]{32})\/mock-pay$/)) && method === "POST") {
    const order = await markOrderPaid(env, m[1]);
    if (!order) return json({ error: "Not found" }, 404);
    return json({ orderId: order.id, status: order.status, downloadUrl: `${url.origin}/download/${order.download_token}` });
  }

  return json({ error: "Not found" }, 404);
}
