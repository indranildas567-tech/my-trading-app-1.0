import { gunzipSync } from "zlib";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Only GET requests are allowed"
    });
  }

  try {
    // Download Upstox NSE instrument file
    const response = await fetch(
      "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
    );

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        message: "Unable to download Upstox NSE instrument file"
      });
    }

    // Convert downloaded file to buffer
    const compressedBuffer = Buffer.from(
      await response.arrayBuffer()
    );

    // Decompress the .gz file
    const decompressedBuffer = gunzipSync(compressedBuffer);

    // Convert to JSON
    const instruments = JSON.parse(
      decompressedBuffer.toString("utf8")
    );

    // Keep only NSE equity instruments
    const equityInstruments = instruments.filter(
      item =>
        item.segment === "NSE_EQ" &&
        item.instrument_type === "EQ"
    );

    // Find a few well-known stocks as a test
    const testSymbols = [
      "360ONE",
      "RELIANCE",
      "TCS",
      "INFY"
    ];

    const testResults = testSymbols.map(symbol => {
      const match = equityInstruments.find(
        item => item.trading_symbol === symbol
      );

      if (!match) {
        return {
          symbol,
          found: false
        };
      }

      return {
        symbol,
        found: true,
        instrumentKey: match.instrument_key,
        tradingSymbol: match.trading_symbol,
        segment: match.segment,
        instrumentType: match.instrument_type
      };
    });

    return res.status(200).json({
      ok: true,
      status: "upstox_instruments_loaded",
      totalInstruments: instruments.length,
      nseEquityCount: equityInstruments.length,
      testResults
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Unable to process Upstox instrument file",
      error: error.message
    });
  }
}
