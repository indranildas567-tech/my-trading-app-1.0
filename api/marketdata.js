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

    // Today's 1-minute candles
    const intradayResponse = await fetch(
      `https://api.upstox.com/v3/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/minutes/1`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`
        }
      }
    );

    const intradayData = await intradayResponse.json();

    if (!intradayResponse.ok) {
      return res.status(intradayResponse.status).json({
        ok: false,
        message: "Intraday candle request failed",
        data: intradayData
      });
    }

    const candles = intradayData.data?.candles || [];

    return res.status(200).json({
      ok: true,
      status: "market_data_test_success",
      symbol: "360ONE",
      instrumentKey,
      candleCount: candles.length,
      firstFiveCandles: candles.slice(0, 5),
      lastFiveCandles: candles.slice(-5)
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Market data test failed",
      error: error.message
    });
  }
}
