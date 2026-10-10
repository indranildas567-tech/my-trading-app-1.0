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
    const today =
      req.query.date ||
      new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata"
      });

    const requestedLimit = Number(req.query.limit || 5);
    const limit = Math.max(
      1,
      Math.min(
        Number.isFinite(requestedLimit) ? requestedLimit : 5,
        500
      )
    );

    const csvUrl =
      "https://raw.githubusercontent.com/indranildas567-tech/my-trading-app-1.0/main/ind_nifty500list.csv";

    const csvResponse = await fetch(csvUrl);

    if (!csvResponse.ok) {
      return res.status(500).json({
        ok: false,
        message: "NIFTY 500 CSV could not be loaded"
      });
    }

    const csvText = await csvResponse.text();

    const lines = csvText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    const parseCSVLine = line => {
      const values = [];
      let value = "";
      let insideQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
          if (insideQuotes && line[i + 1] === '"') {
            value += '"';
            i++;
          } else {
            insideQuotes = !insideQuotes;
          }
        } else if (char === "," && !insideQuotes) {
          values.push(value.trim());
          value = "";
        } else {
          value += char;
        }
      }

      values.push(value.trim());
      return values;
    };

    if (lines.length < 2) {
      return res.status(500).json({
        ok: false,
        message: "NIFTY 500 CSV is empty or incomplete"
      });
    }

    const headers = parseCSVLine(lines[0]).map(header =>
      header.trim()
    );

    const symbolIndex = headers.indexOf("Symbol");
    const isinIndex = headers.indexOf("ISIN Code");

    if (symbolIndex === -1 || isinIndex === -1) {
      return res.status(500).json({
        ok: false,
        message:
          "CSV does not contain Symbol and ISIN Code columns"
      });
    }

    const stocks = lines
      .slice(1)
      .map(line => {
        const columns = parseCSVLine(line);

        return {
          symbol: columns[symbolIndex]?.trim(),
          isin: columns[isinIndex]?.trim()
        };
      })
      .filter(stock => stock.symbol && stock.isin)
      .slice(0, limit);

    const results = [];
    const errors = [];

    const getPreviousDate = (dateString, daysBack) => {
      const date = new Date(
        `${dateString}T00:00:00+05:30`
      );

      date.setDate(date.getDate() - daysBack);

      return date.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata"
      });
    };

    const previousStartDate = getPreviousDate(today, 7);

    /*
     * SPEED IMPROVEMENT:
     * Space Upstox requests by at least 125 ms.
     * This targets no more than 8 request starts per second
     * for this scanner invocation.
     */
    const REQUEST_INTERVAL_MS = 125;

const wait = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

let requestStartQueue = Promise.resolve();
let lastRequestStartedAt = 0;

const fetchUpstoxJson = async url => {
  let releaseTurn;

  const currentTurn = new Promise(resolve => {
    releaseTurn = resolve;
  });

  const previousTurn = requestStartQueue;
  requestStartQueue = currentTurn;

  let response;

  try {
    await previousTurn;

    const elapsed = Date.now() - lastRequestStartedAt;

    if (
      lastRequestStartedAt > 0 &&
      elapsed < REQUEST_INTERVAL_MS
    ) {
      await wait(REQUEST_INTERVAL_MS - elapsed);
    }

    lastRequestStartedAt = Date.now();

    response = fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      }
    });
  } finally {
    releaseTurn();
  }

  const resolvedResponse = await response;

  let data;

  try {
    data = await resolvedResponse.json();
  } catch {
    data = {
      message: "Upstox returned an invalid JSON response"
    };
  }

  return {
    response: resolvedResponse,
    data
  };
};
    const processStock = async stock => {
      const instrumentKey = `NSE_EQ|${stock.isin}`;

      try {
        /*
         * Today's 1-minute candles
         */
        const isToday =
          today ===
          new Date().toLocaleDateString("en-CA", {
            timeZone: "Asia/Kolkata"
          });

        const minuteUrl = isToday
          ? `https://api.upstox.com/v3/historical-candle/intraday/${encodeURIComponent(
              instrumentKey
            )}/minutes/1`
          : `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(
              instrumentKey
            )}/minutes/1/${today}/${today}`;

        const {
          response: minuteResponse,
          data: minuteData
        } = await fetchUpstoxJson(minuteUrl);

        if (!minuteResponse.ok) {
          errors.push({
            symbol: stock.symbol,
            stage: "1-minute-data",
            data: minuteData
          });

          return;
        }

        const candles = minuteData.data?.candles || [];

        const openingRangeCandles = candles.filter(candle => {
          const time = candle[0];

          return (
            time >= `${today}T09:15:00+05:30` &&
            time < `${today}T09:30:00+05:30`
          );
        });

        if (openingRangeCandles.length !== 15) {
          errors.push({
            symbol: stock.symbol,
            stage: "opening-range",
            message:
              `Expected 15 candles but received ${openingRangeCandles.length}`
          });

          return;
        }

        const orbHigh = Math.max(
          ...openingRangeCandles.map(candle =>
            Number(candle[2])
          )
        );

        const orbLow = Math.min(
          ...openingRangeCandles.map(candle =>
            Number(candle[3])
          )
        );

        /*
         * Previous trading day's OHLC
         */
        const dailyUrl =
          `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(
            instrumentKey
          )}/days/1/${today}/${previousStartDate}`;

        const {
          response: dailyResponse,
          data: dailyData
        } = await fetchUpstoxJson(dailyUrl);

        if (!dailyResponse.ok) {
          errors.push({
            symbol: stock.symbol,
            stage: "daily-data",
            data: dailyData
          });

          return;
        }

        const dailyCandles = dailyData.data?.candles || [];

        const previousCandle = dailyCandles.find(candle =>
          candle[0] < `${today}T00:00:00+05:30`
        );

        if (!previousCandle) {
          errors.push({
            symbol: stock.symbol,
            stage: "previous-day",
            message: "Previous trading day candle not found"
          });

          return;
        }

        const previousHigh = Number(previousCandle[2]);
        const previousLow = Number(previousCandle[3]);
        const previousClose = Number(previousCandle[4]);

        /*
         * Standard Camarilla S3 / R3
         */
        const range = previousHigh - previousLow;

        const r3 =
          previousClose + (range * 1.1) / 4;

        const s3 =
          previousClose - (range * 1.1) / 4;

        /*
         * Required strategy:
         * S3 < ORB Low < ORB High < R3
         */
        const matches =
          s3 < orbLow &&
          orbLow < orbHigh &&
          orbHigh < r3;

        if (!matches) {
          return;
        }

        /*
         * Find the completed 9:30–9:31 AM candle.
         */
        const candle930 = candles.find(candle =>
          candle[0] >= `${today}T09:30:00+05:30` &&
          candle[0] < `${today}T09:31:00+05:30`
        );

        if (!candle930) {
          errors.push({
            symbol: stock.symbol,
            stage: "930-candle",
            message: "9:30 AM candle not available yet"
          });

          return;
        }

        const close930 = Number(candle930[4]);

        let group;

        if (close930 > orbHigh) {
          group = "Group 1 - Above ORB High";
        } else if (close930 < orbLow) {
          group = "Group 2 - Below ORB Low";
        } else {
          group = "Group 3 - Between ORB High and ORB Low";
        }

        results.push({
          symbol: stock.symbol,
          instrumentKey,
          previousHigh,
          previousLow,
          previousClose,
          s3,
          orbLow,
          orbHigh,
          r3,
          close930,
          group
        });

      } catch (error) {
        errors.push({
          symbol: stock.symbol,
          stage: "unexpected-error",
          message: error.message
        });
      }
    };

    /*
     * SPEED IMPROVEMENT:
     * Run up to five stock-processing workers concurrently.
     */
    const WORKER_COUNT = 5;
    let nextStockIndex = 0;

    const worker = async () => {
      while (true) {
        const index = nextStockIndex++;

        if (index >= stocks.length) {
          return;
        }

        await processStock(stocks[index]);
      }
    };

    const activeWorkers = Math.min(
      WORKER_COUNT,
      stocks.length
    );

    await Promise.all(
      Array.from(
        { length: activeWorkers },
        () => worker()
      )
    );

    return res.status(200).json({
      ok: true,
      status: "scanner_test_complete",
      date: today,
      stocksChecked: stocks.length,
      condition: "S3 < ORB Low < ORB High < R3",
      openingRange: "09:15–09:30 IST",
      camarilla: "Standard",
      matches: results,
      matchCount: results.length,
      errors
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Scanner failed",
      error: error.message
    });
  }
}
