import { CityFeed, type ReadQuery, type ReadResult } from "./feed.js";

const SECURITY: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://server.arcgisonline.com; connect-src 'self'; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function text(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      ...SECURITY,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function queryFrom(url: URL): ReadQuery {
  const demo = url.searchParams.get("demo") === "1";
  if (!demo || !url.searchParams.has("p"))
    return { demo, p: null, live: demo && url.searchParams.get("live") === "1" };
  const raw = Number(url.searchParams.get("p"));
  const p = Number.isFinite(raw) ? Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100 : 0.5;
  return { demo, p, live: false };
}

async function jsonResult(
  request: Request,
  result: ReadResult,
  ctx: ExecutionContext,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...SECURITY,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": result.cacheControl,
    ETag: result.etag,
  };
  if (request.headers.get("if-none-match") === result.etag)
    return new Response(null, { status: 304, headers });
  const response = new Response(request.method === "HEAD" ? null : result.body, {
    status: 200,
    headers,
  });
  if (request.method === "GET") {
    const cacheKey = new Request(request.url, { method: "GET" });
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()).catch(() => undefined));
  }
  return response;
}

export { CityFeed };

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const headOrGet = request.method === "GET" || request.method === "HEAD";
    if (url.pathname === "/healthz") {
      if (!headOrGet) return text(405, "Method not allowed", { Allow: "GET, HEAD" });
      try {
        const status = await env.CITY_FEED.getByName("toronto").health();
        const body = JSON.stringify(status);
        return new Response(request.method === "HEAD" ? null : body, {
          status: 200,
          headers: {
            ...SECURITY,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "healthz failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return text(500, "Server error");
      }
    }
    if (url.pathname === "/api/state") {
      if (!headOrGet) return text(405, "Method not allowed", { Allow: "GET, HEAD" });
      if (request.method === "GET") {
        const hit = await caches.default.match(new Request(request.url, { method: "GET" }));
        if (hit) return hit;
      }
      try {
        const result = await env.CITY_FEED.getByName("toronto").read(queryFrom(url));
        return jsonResult(request, result, ctx);
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "api state failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        const body = JSON.stringify({
          mode: "live",
          sample: false,
          error: { at: Date.now(), message: "City feed unreachable" },
          mayor: null,
          wards: [],
          history: [],
        });
        return new Response(body, {
          status: 200,
          headers: {
            ...SECURITY,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
    }
    if (!headOrGet) return text(405, "Method not allowed", { Allow: "GET, HEAD" });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
