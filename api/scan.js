

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
    const symbol = "360ONE";

    const response = await fetch(
      `https://api.upstox.com/v2/instruments/search?query=${encodeURIComponent(symbol)}&segment=NSE_EQ`,
      {
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        message: "Upstox instrument search failed",
        data
      });
    }

    const match = data.data?.find(
      item =>
        item.segment === "NSE_EQ" &&
        item.instrument_type === "EQ" &&
        item.trading_symbol === symbol
    );

    if (!match) {
      return res.status(404).json({
        ok: false,
        message: `Instrument not found for ${symbol}`,
        searchResults: data.data || []
      });
    }

    return res.status(200).json({
      ok: true,
      status: "instrument_mapping_success",
      symbol,
      instrumentKey: match.instrument_key,
      tradingSymbol: match.trading_symbol,
      segment: match.segment,
      instrumentType: match.instrument_type
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Instrument mapping failed",
      error: error.message
    });
  }
}
