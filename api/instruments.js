export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Only GET requests are allowed"
    });
  }

  try {
    const response = await fetch(
      "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
    );

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        message: "Unable to download Upstox NSE instrument file"
      });
    }

    const buffer = await response.arrayBuffer();

    return res.status(200).json({
      ok: true,
      status: "upstox_instrument_file_reachable",
      fileBytes: buffer.byteLength,
      message: "Upstox NSE instrument file is reachable"
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Instrument file test failed",
      error: error.message
    });
  }
}
