/**
 * GET /api/jeview/proxy/[...path]
 * Proxy für JEViews interne /_/api/ Endpunkte.
 * Ermöglicht zukünftige tiefere Integration (Records lesen, suchen, etc.)
 * ohne CORS-Probleme im Browser.
 *
 * Beispiel: GET /api/jeview/proxy/records?after=0
 *  → proxied zu: http://127.0.0.1:4777/_/api/records?after=0
 */

import http from "http";

const JEVIEW_URL = process.env.JEVIEW_URL || "http://127.0.0.1:4777";

export async function GET(request, { params }) {
  const resolvedParams = await params;
  const path = Array.isArray(resolvedParams.path)
    ? resolvedParams.path.join("/")
    : resolvedParams.path || "";

  const url = new URL(request.url);
  const rawUrl = JEVIEW_URL;

  return new Promise((resolve) => {
    try {
      const parsed = new URL(rawUrl);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 4777,
          path: `/_/api/${path}${url.search}`,
          method: "GET",
          headers: {
            accept: "application/json",
            host: "127.0.0.1:4777",
          },
          timeout: 8000,
        },
        (res) => {
          let chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            try {
              const data = JSON.parse(body);
              resolve(Response.json(data, { status: res.statusCode }));
            } catch {
              resolve(
                Response.json(
                  { error: `Invalid JSON from JEView: ${body.slice(0, 100)}` },
                  { status: 502 }
                )
              );
            }
          });
        }
      );

      req.on("timeout", () => {
        req.destroy();
        resolve(Response.json({ error: "JEView timeout" }, { status: 504 }));
      });

      req.on("error", (err) => {
        resolve(
          Response.json(
            { error: `JEView unreachable: ${err.message}` },
            { status: 502 }
          )
        );
      });

      req.end();
    } catch (err) {
      resolve(
        Response.json(
          { error: `JEView proxy error: ${err.message}` },
          { status: 502 }
        )
      );
    }
  });
}

