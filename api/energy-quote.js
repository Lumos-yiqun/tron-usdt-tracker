const SOURCE = "https://feee.io/v1/init/config";
const USD_SOURCE = "https://api.coingecko.com/api/v3/simple/price?ids=tron&vs_currencies=usd&include_last_updated_at=true";
const TIERS = [64400, 130400];

function usdPriceFromResponse(data, now = Date.now()) {
  const price = data?.tron?.usd;
  const updatedAt = data?.tron?.last_updated_at;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 ||
      typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || Math.abs(now - updatedAt * 1000) > 15 * 60 * 1000) return null;
  return { currency: "USD", trxPrice: price, asOf: new Date(updatedAt * 1000).toISOString(), source: "CoinGecko" };
}

function quoteFromConfig(config) {
  const data = config?.data;
  const price = data?.price_b2c?.energy;
  const unitSun = Number(price?.sun_m);
  const serviceTrx = Number(price?.service_amount);
  const serviceLimit = Number(price?.service_amount_limit);
  const options = data?.order?.energy_b2c_quick_options;
  const durations = data?.order?.time_range_b2c;
  if (config?.code !== 0 || !Number.isFinite(unitSun) || unitSun <= 0 || unitSun > 1000 ||
      !Number.isFinite(serviceTrx) || serviceTrx < 0 || serviceTrx > 100 ||
      !Number.isFinite(serviceLimit) || serviceLimit < 0 ||
      !Array.isArray(options) || !TIERS.every((energy) => options.includes(energy)) ||
      !Array.isArray(durations) || !durations.includes(600)) {
    throw new Error("Invalid rental pricing data");
  }
  return {
    provider: "Feee.io",
    durationMinutes: 10,
    asOf: new Date().toISOString(),
    tiers: TIERS.map((energy) => ({
      energy,
      costTrx: Math.round((energy * unitSun / 1e6 + (energy < serviceLimit ? serviceTrx : 0)) * 1e6) / 1e6,
    })),
  };
}

async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const getJSON = async (url, headers) => {
      const response = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: controller.signal });
      if (!response.ok) throw new Error("Price source unavailable");
      return response.json();
    };
    const [rentalResult, fiatResult] = await Promise.allSettled([
      getJSON(SOURCE),
      getJSON(USD_SOURCE, process.env.COINGECKO_DEMO_API_KEY ? { "x-cg-demo-api-key": process.env.COINGECKO_DEMO_API_KEY } : {}),
    ]);
    if (rentalResult.status !== "fulfilled") throw new Error("Rental source unavailable");
    const quote = quoteFromConfig(rentalResult.value);
    const fiat = fiatResult.status === "fulfilled" ? usdPriceFromResponse(fiatResult.value) : null;
    if (fiat) quote.fiat = fiat;
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=60");
    res.statusCode = 200;
    res.end(JSON.stringify(quote));
  } catch {
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "Rental quote unavailable" }));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = handler;
module.exports.quoteFromConfig = quoteFromConfig;
module.exports.usdPriceFromResponse = usdPriceFromResponse;
