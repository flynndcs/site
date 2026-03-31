export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigin = env.ALLOWED_ORIGIN;

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const json = (data, status = 200) =>
      Response.json(data, { status, headers: corsHeaders });

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
        const token = (request.headers.get("Authorization") || "").replace("Bearer ", "");
        if (!token || token !== env.ADMIN_TOKEN) {
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
      await env.DB.prepare(
        "INSERT INTO visits (visited_at) VALUES (datetime('now'))"
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

    return json({ error: "Not found" }, 404);
  },
};
