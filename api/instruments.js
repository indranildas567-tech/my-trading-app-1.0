export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Only GET requests are allowed"
    });
  }

  const token = process.env.UPSTOX_ACCESS_TOKEN;

  if (!token) {
    return res.status(500).json({
      ok: false,
      message: "Upstox token is not configured"
    });
  }

  try {
    const instrumentKey = "NSE_EQ|INE466L01038";

    const response = await fetch(
      `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(instrumentKey)}/days/1/2026-10-05/2026-10-01`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: "Historical candle request failed",
        data
      });
    }

    const candles = data.data?.candles || [];

    return res.status(200).json({
      ok: true,
      status: "historical_data_test_success",
      symbol: "360ONE",
      instrumentKey,
      candleCount: candles.length,
      candles: candles.slice(0, 5)
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Historical data test failed",
      error: error.message
    });
  }
}
