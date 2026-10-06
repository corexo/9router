import http from "http";

export async function GET() {
  const rawUrl = process.env.JEVIEW_URL || "http://127.0.0.1:4777";
  const viewerUrl = process.env.JEVIEW_VIEWER_URL || "http://127.0.0.1:4777";

  return new Promise((resolve) => {
    try {
      const parsed = new URL(rawUrl);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 4777,
          path: parsed.pathname || "/",
          method: "GET",
          headers: { host: "127.0.0.1:4777" },
          timeout: 2000,
        },
        (res) => {
          resolve(
            Response.json({
              online: res.statusCode === 200,
              url: viewerUrl,
            })
          );
        }
      );

      req.on("timeout", () => {
        req.destroy();
        resolve(Response.json({ online: false, url: viewerUrl }));
      });

      req.on("error", () => {
        resolve(Response.json({ online: false, url: viewerUrl }));
      });

      req.end();
    } catch {
      resolve(Response.json({ online: false, url: viewerUrl }));
    }
  });
}

