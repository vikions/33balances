const CACHE_TTL_MS = 20_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;
const POLYMARKET_GAMMA_URL = "https://gamma-api.polymarket.com/markets";
const SOURCE = "polymarket-gamma";

const state = {
  cache: null,
  cacheTime: 0,
  lastFetchTime: null,
  lastCount: 0,
  lastLatencyMs: null,
  lastError: null,
  lastCacheHit: null,
};

function getDiagnostics() {
  return {
    lastFetchTime: state.lastFetchTime,
    lastCount: state.lastCount,
    lastCacheHit: state.lastCacheHit,
    lastError: state.lastError,
    lastLatencyMs: state.lastLatencyMs,
  };
}

async function fetchWithTimeout(url, { timeoutMs, ...options } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchGammaMarkets() {
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetchWithTimeout(POLYMARKET_GAMMA_URL, {
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: { "accept": "application/json" },
      });

      const latencyMs = Date.now() - startedAt;
      state.lastLatencyMs = latencyMs;

      if (!response.ok) {
        throw new Error(`Upstream status ${response.status}`);
      }

      const data = await response.json();
      console.info(`[polymarket] fetch ok in ${latencyMs}ms`);
      return data;
    } catch (error) {
      lastError = error;
      console.error(
        `[polymarket] fetch failed (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
        error
      );
    }
  }

  throw lastError || new Error("Unknown upstream error");
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizePrice(value) {
  const num = toNumber(value);
  if (num === null) return null;
  if (num > 1) return num / 100;
  return num;
}

function extractYesNo(market) {
  const outcomes = parseArray(
    market.outcomes ?? market.outcomeNames ?? market.outcome_names
  );
  const prices = parseArray(
    market.outcomePrices ?? market.outcome_prices ?? market.prices
  );

  const yesIndex = outcomes.findIndex(
    (outcome) => String(outcome).toLowerCase() === "yes"
  );
  const noIndex = outcomes.findIndex(
    (outcome) => String(outcome).toLowerCase() === "no"
  );

  let yesPrice = null;
  let noPrice = null;

  if (prices.length > 0) {
    if (yesIndex >= 0) yesPrice = toNumber(prices[yesIndex]);
    if (noIndex >= 0) noPrice = toNumber(prices[noIndex]);
  }

  if (yesPrice === null) {
    yesPrice = toNumber(market.yesPrice ?? market.probabilityYes);
  }
  if (noPrice === null) {
    noPrice = toNumber(market.noPrice ?? market.probabilityNo);
  }

  let yes = normalizePrice(yesPrice);
  let no = normalizePrice(noPrice);

  if (yes === null && no !== null) yes = 1 - no;
  if (no === null && yes !== null) no = 1 - yes;

  if (yes === null || no === null) {
    yes = 0.5;
    no = 0.5;
  }

  yes = clamp(yes, 0, 1);
  no = clamp(no, 0, 1);

  const yesPct = Math.round(yes * 100);
  const noPct = clamp(100 - yesPct, 0, 100);

  return { yesPct, noPct };
}

function parseEndTime(market) {
  const raw =
    market.endTime ??
    market.endDate ??
    market.end_time ??
    market.end_date ??
    market.expiration ??
    market.closeTime;

  if (!raw) return null;

  if (typeof raw === "number") {
    return raw < 1e12 ? raw * 1000 : raw;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function isResolvedMarket(market) {
  if (!market || typeof market !== "object") return true;
  if (market.resolved === true || market.isResolved === true) return true;
  if (market.closed === true || market.settled === true) return true;
  if (market.outcome !== null && market.outcome !== undefined) return true;
  if (market.resolution !== null && market.resolution !== undefined) return true;

  const status = String(market.status ?? "").toLowerCase();
  if (status.includes("resolved") || status.includes("settled")) return true;

  return false;
}

function normalizeMarket(market) {
  if (isResolvedMarket(market)) return null;

  const id = String(market.id ?? market.market_id ?? market.slug ?? "");
  const question = String(market.question ?? market.title ?? "").trim();
  const endTimeMs = parseEndTime(market);

  if (!id || !question) return null;

  const { yesPct, noPct } = extractYesNo(market);
  const url = String(market.url ?? market.marketUrl ?? market.market_url ?? "");

  return {
    id,
    question,
    endTime: endTimeMs ? new Date(endTimeMs).toISOString() : "",
    marketYesPct: yesPct,
    marketNoPct: noPct,
    url,
    source: SOURCE,
  };
}

async function getMarkets({ forceRefresh = false } = {}) {
  const now = Date.now();
  // In-memory cache keeps the API fast without adding external storage.
  const cacheFresh = state.cache && now - state.cacheTime < CACHE_TTL_MS;

  if (cacheFresh && !forceRefresh) {
    state.lastCacheHit = true;
    return state.cache;
  }

  state.lastCacheHit = false;

  try {
    const data = await fetchGammaMarkets();
    const rawMarkets = Array.isArray(data) ? data : data?.markets ?? data?.data ?? [];
    const normalized = rawMarkets
      .map(normalizeMarket)
      .filter(Boolean)
      .sort((a, b) => {
        const aTime = Date.parse(a.endTime || "");
        const bTime = Date.parse(b.endTime || "");
        const aScore = Number.isFinite(aTime) ? aTime : Number.POSITIVE_INFINITY;
        const bScore = Number.isFinite(bTime) ? bTime : Number.POSITIVE_INFINITY;
        return aScore - bScore;
      });

    state.cache = normalized;
    state.cacheTime = now;
    state.lastFetchTime = now;
    state.lastCount = normalized.length;
    state.lastError = null;

    return normalized;
  } catch (error) {
    state.lastError = error?.message || String(error);
    if (state.cache) {
      state.lastCacheHit = true;
      return state.cache;
    }
    throw error;
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export function polymarketMiddleware() {
  return async (req, res, next) => {
    const url = new URL(req.url || "", "http://localhost");
    if (url.pathname === "/api/polymarket/markets") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      try {
        const forceRefresh = url.searchParams.get("refresh") === "1";
        const markets = await getMarkets({ forceRefresh });
        sendJson(res, 200, markets);
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

      const forceRefresh = url.searchParams.get("refresh") === "1";
      if (forceRefresh) {
        // Refresh warms the cache for diagnostics without changing the API contract.
        try {
          await getMarkets({ forceRefresh: true });
        } catch {
          // Diagnostics should still respond even if refresh fails.
        }
      }

      sendJson(res, 200, getDiagnostics());
      return;
    }

    next();
  };
}
