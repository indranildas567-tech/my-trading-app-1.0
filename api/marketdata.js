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
      `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(instrumentKey)}/minutes/1/2026-10-05/2026-10-05`,
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
        message: "1-minute candle request failed",
        data
      });
    }

    const candles = data.data?.candles || [];

    const openingRangeCandles = candles.filter((candle) => {
      const time = candle[0];
      return time >= "2026-10-05T09:15:00+05:30" &&
             time < "2026-10-05T09:30:00+05:30";
    });

    return res.status(200).json({
      ok: true,
      status: "opening_range_1minute_test_success",
      symbol: "360ONE",
      instrumentKey,
      date: "2026-10-05",
      interval: "1 minute",
      openingRange: "09:15–09:30 IST",
      totalCandleCount: candles.length,
      openingRangeCandleCount: openingRangeCandles.length,
      openingRangeCandles
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "1-minute opening range test failed",
      error: error.message
    });
  }
}
