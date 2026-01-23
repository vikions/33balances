import { getFeaturedMarket, getDiagnostics } from "../../api/polymarket/_shared.js";

// Vite-only middleware that mirrors serverless endpoints for local dev.

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export function polymarketMiddleware() {
  return async (req, res, next) => {
    const url = new URL(req.url || "", "http://localhost");

    if (url.pathname === "/api/polymarket/featured") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      try {
        const featured = await getFeaturedMarket();
        sendJson(res, 200, featured);
      } catch (error) {
        sendJson(res, 502, { error: error?.message || "Upstream error" });
      }
      return;
    }

    if (url.pathname === "/api/polymarket/diagnostics") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      sendJson(res, 200, getDiagnostics());
      return;
    }

    next();
  };
}
