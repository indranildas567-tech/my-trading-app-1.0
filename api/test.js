
export default async function handler(req, res) {
  const token = process.env.UPSTOX_ACCESS_TOKEN;

  if (!token) {
    return res.status(500).json({
      ok: false,
      message: "UPSTOX_ACCESS_TOKEN is not configured"
    });
  }

  try {
    const url =
      "https://api.upstox.com/v2/market-quote/ohlc?instrument_key=NSE_EQ%7CINE669E01016&interval=1d";

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();

    return res.status(response.status).json({
      ok: response.ok,
      message: response.ok
        ? "Upstox market data connection successful"
        : "Upstox market data request failed",
      data
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Backend request failed",
      error: error.message
    });
  }
}
