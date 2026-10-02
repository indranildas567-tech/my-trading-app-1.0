
export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Only GET requests are allowed"
    });
  }

  if (!process.env.UPSTOX_ACCESS_TOKEN) {
    return res.status(500).json({
      ok: false,
      message: "Upstox token is not configured"
    });
  }

  return res.status(200).json({
    ok: true,
    status: "ready",
    message: "NIFTY 500 scanner backend is ready for integration",
    matches: [],
    scannerConfigured: false,
    condition: "S3 < ORB Low < ORB High < R3"
  });
}
