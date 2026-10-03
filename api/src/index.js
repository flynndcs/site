import { handleStore, isAdmin } from "./store.js";
import { isRateLimited } from "./ratelimit.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigin = env.ALLOWED_ORIGIN;

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-File-Name",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const json = (data, status = 200) =>
      Response.json(data, { status, headers: corsHeaders });

    if (await isRateLimited(request, env, url.pathname)) {
      return Response.json(
        { error: "Too many requests" },
        { status: 429, headers: { ...corsHeaders, "Retry-After": "60" } }
      );
    }

    // --- Feature Flags ---

    if (url.pathname === "/flags" && request.method === "GET") {
      const rows = await env.DB.prepare("SELECT name, enabled FROM flags").all();
      const flags = {};
      for (const row of rows.results) {
        flags[row.name] = row.enabled === 1;
      }
      return json(flags);
    }

    const flagMatch = url.pathname.match(/^\/flags\/([a-z0-9_-]+)$/);
    if (flagMatch) {
      const name = flagMatch[1];

      if (request.method === "GET" || request.method === "PUT") {
        if (!(await isAdmin(request, env))) {
          return json({ error: "Unauthorized" }, 401);
        }
      }

      if (request.method === "GET") {
        const row = await env.DB.prepare("SELECT enabled FROM flags WHERE name = ?").bind(name).first();
        if (!row) return json({ error: "Flag not found" }, 404);
        return json({ name, enabled: row.enabled === 1 });
      }

      if (request.method === "PUT") {
        const body = await request.json();
        const enabled = body.enabled ? 1 : 0;
        await env.DB.prepare(
          "INSERT INTO flags (name, enabled) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET enabled = ?"
        ).bind(name, enabled, enabled).run();
        return json({ name, enabled: body.enabled });
      }
    }

    // --- Hello ---

    if (url.pathname === "/hello" && request.method === "GET") {
      // Cap writes globally (10/min) so a flood can't grow the table or burn D1's write quota.
      // Over the cap, the request still gets stats but isn't recorded.
      await env.DB.prepare(
        "INSERT INTO visits (visited_at) SELECT datetime('now') " +
          "WHERE (SELECT COUNT(*) FROM visits WHERE visited_at > datetime('now', '-1 minute')) < 10"
      ).run();

      const stats = await env.DB.prepare(
        "SELECT COUNT(*) as count, MAX(visited_at) as latest FROM visits"
      ).first();

      return json({
        message: "Hello!",
        visitCount: stats.count,
        lastVisit: stats.latest,
      });
    }

    const storeResponse = await handleStore(request, env, url, json);
    if (storeResponse) return storeResponse;

    return json({ error: "Not found" }, 404);
  },
};
