const SOURCE = "https://feee.io/v1/init/config";
const TIERS = [64400, 130400];

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
    const response = await fetch(SOURCE, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error("Rental source unavailable");
    const quote = quoteFromConfig(await response.json());
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
