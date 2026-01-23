const CACHE_TTL_MS = 20_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;
const POLYMARKET_GAMMA_URL = "https://gamma-api.polymarket.com/markets";
const FEATURED_MARKET_ID = 1242900;
const FEATURED_SLUG = "bitcoin-up-or-down-on-january-24";
const SOURCE = "polymarket-gamma";

const state = {
  cache: null,
  cacheTime: 0,
  lastFetchTime: null,
  lastLatencyMs: null,
  lastError: null,
  lastCacheHit: null,
};

export function getDiagnostics() {
  return {
    lastFetchTime: state.lastFetchTime,
    lastLatencyMs: state.lastLatencyMs,
    lastError: state.lastError,
    lastCacheHit: state.lastCacheHit,
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

async function fetchGammaMarket() {
  let lastError = null;
  const url = `${POLYMARKET_GAMMA_URL}?id=${FEATURED_MARKET_ID}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetchWithTimeout(url, {
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: { accept: "application/json" },
      });

      const latencyMs = Date.now() - startedAt;
      state.lastLatencyMs = latencyMs;

      if (!response.ok) {
        throw new Error(`Upstream status ${response.status}`);
      }

      const data = await response.json();
      console.info(`[polymarket] featured fetch ok in ${latencyMs}ms`);
      return data;
    } catch (error) {
      lastError = error;
      console.error(
        `[polymarket] featured fetch failed (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
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
  return num > 1 ? num / 100 : num;
}

function extractUpDown(market) {
  const outcomes = parseArray(
    market.outcomes ?? market.outcomeNames ?? market.outcome_names
  );
  const prices = parseArray(
    market.outcomePrices ?? market.outcome_prices ?? market.prices
  );

  const upIndex = outcomes.findIndex(
    (outcome) => String(outcome).toLowerCase() === "up"
  );
  const downIndex = outcomes.findIndex(
    (outcome) => String(outcome).toLowerCase() === "down"
  );

  let upPrice = null;
  let downPrice = null;

  if (prices.length > 0) {
    if (upIndex >= 0) upPrice = toNumber(prices[upIndex]);
    if (downIndex >= 0) downPrice = toNumber(prices[downIndex]);
  }

  if (upPrice === null) upPrice = toNumber(market.upPrice);
  if (downPrice === null) downPrice = toNumber(market.downPrice);

  let up = normalizePrice(upPrice);
  let down = normalizePrice(downPrice);

  if (up === null && down !== null) up = 1 - down;
  if (down === null && up !== null) down = 1 - up;

  if (up === null || down === null) {
    up = 0.5;
    down = 0.5;
  }

  up = clamp(up, 0, 1);
  down = clamp(down, 0, 1);

  const upPct = Math.round(up * 100);
  const downPct = clamp(100 - upPct, 0, 100);

  return { upPct, downPct };
}

function parseEndTime(market) {
  const raw =
    market.endTime ??
    market.endDate ??
    market.end_time ??
    market.end_date ??
    market.expiration ??
    market.closeTime ??
    market.close_time;

  if (!raw) return "";

  if (typeof raw === "number") {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
}

function normalizeMarket(market) {
  const id = String(market.id ?? market.market_id ?? FEATURED_MARKET_ID);
  const question = String(market.question ?? market.title ?? "").trim();
  const endTime = parseEndTime(market);
  const { upPct, downPct } = extractUpDown(market);
  const url = String(market.url ?? market.marketUrl ?? market.market_url ?? "");

  return {
    id,
    question,
    endTime,
    marketUpPct: upPct,
    marketDownPct: downPct,
    url,
    source: SOURCE,
    slug: FEATURED_SLUG,
  };
}

export async function getFeaturedMarket({ forceRefresh = false } = {}) {
  const now = Date.now();
  const cacheFresh = state.cache && now - state.cacheTime < CACHE_TTL_MS;

  if (cacheFresh && !forceRefresh) {
    state.lastCacheHit = true;
    return state.cache;
  }

  state.lastCacheHit = false;

  try {
    const data = await fetchGammaMarket();
    const rawMarkets = Array.isArray(data) ? data : data?.markets ?? data?.data ?? [];
    const market = rawMarkets?.[0];
    if (!market) {
      throw new Error("Featured market not found in response.");
    }

    const normalized = normalizeMarket(market);
    state.cache = normalized;
    state.cacheTime = now;
    state.lastFetchTime = now;
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
