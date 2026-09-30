export default async function handler(req, res) {
  try {
    const token = process.env.UPSTOX_ACCESS_TOKEN;

    if (!token) {
      return res.status(500).json({
        ok: false,
        message: "UPSTOX_ACCESS_TOKEN is not configured"
      });
    }

    const response = await fetch(
      "https://api.upstox.com/v2/user/profile",
      {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    return res.status(response.status).json({
      ok: response.ok,
      data: data
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
}
export default async function handler(req, res) {
  try {
    const token = process.env.UPSTOX_ACCESS_TOKEN;

    if (!token) {
      return res.status(500).json({
        ok: false,
        message: "UPSTOX_ACCESS_TOKEN is not configured"
      });
    }

    const response = await fetch(
      "https://api.upstox.com/v2/user/profile",
      {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`
        }
      }
    );

    const data = await response.json();

    return res.status(response.status).json({
      ok: response.ok,
      data: data
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
}
