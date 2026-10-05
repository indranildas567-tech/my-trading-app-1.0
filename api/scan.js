

import fs from "fs";
import path from "path";

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Only GET requests are allowed"
    });
  }

  try {
    const filePath = path.join(
      process.cwd(),
      "ind_nifty500list.csv"
    );

    const csv = fs.readFileSync(filePath, "utf8");

    const lines = csv
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      return res.status(500).json({
        ok: false,
        message: "NIFTY 500 CSV is empty or invalid"
      });
    }

    const headers = lines[0].split(",").map(h => h.trim());

    const symbolIndex = headers.findIndex(
      h => h.toLowerCase() === "symbol"
    );

    if (symbolIndex === -1) {
      return res.status(500).json({
        ok: false,
        message: "Symbol column not found in NIFTY 500 CSV"
      });
    }

    const symbols = lines
      .slice(1)
      .map(line => line.split(",")[symbolIndex]?.trim())
      .filter(Boolean);

    return res.status(200).json({
      ok: true,
      status: "nifty500_list_loaded",
      scannerConfigured: false,
      stockCount: symbols.length,
      sampleStocks: symbols.slice(0, 10),
      condition: "S3 < ORB Low < ORB High < R3",
      openingRange: "09:15–09:30 IST"
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Unable to read NIFTY 500 CSV",
      error: error.message
    });
  }
}
