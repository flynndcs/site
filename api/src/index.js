export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN;

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/hello" && request.method === "GET") {
      await env.DB.prepare(
        "INSERT INTO visits (visited_at) VALUES (datetime('now'))"
      ).run();

      const stats = await env.DB.prepare(
        "SELECT COUNT(*) as count, MAX(visited_at) as latest FROM visits"
      ).first();

      return Response.json(
        {
          message: "Hello!",
          visitCount: stats.count,
          lastVisit: stats.latest,
        },
        { headers: corsHeaders }
      );
    }

    return Response.json(
      { error: "Not found" },
      { status: 404, headers: corsHeaders }
    );
  },
};
