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

  const wait = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  const getTodayIST = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

  const getTimeIST = () =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(new Date());

  try {
    const today = req.query.date || getTodayIST();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid date. Use YYYY-MM-DD."
      });
    }

    const requestedLimit = Number(req.query.limit || 50);
    const limit = Math.max(
      1,
      Math.min(
        Number.isFinite(requestedLimit)
          ? Math.floor(requestedLimit)
          : 50,
        50
      )
    );

    const requestedOffset = Number(req.query.offset || 0);
    const offset = Math.max(
      0,
      Number.isFinite(requestedOffset)
        ? Math.floor(requestedOffset)
        : 0
    );

    /*
     * Do not classify today's stocks until the 09:30
     * one-minute candle has had time to complete.
     */
    if (
      today === getTodayIST() &&
      getTimeIST() < "09:31"
    ) {
      return res.status(200).json({
        ok: true,
        status: "waiting_for_930_candle",
        date: today,
        message:
          "Scanning can begin after the 09:30 candle closes at 09:31 IST.",
        stocksChecked: 0,
        matches: [],
        matchCount: 0,
        errors: []
      });
    }

    /*
     * Load the NIFTY 500 list.
     * Keep the source CSV on the original main branch.
     */
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
      header.replace(/^\uFEFF/, "").trim()
    );

    const symbolIndex = headers.indexOf("Symbol");
    const isinIndex = headers.indexOf("ISIN Code");

    if (symbolIndex === -1 || isinIndex === -1) {
      return res.status(500).json({
        ok: false,
        message:
          "CSV must contain Symbol and ISIN Code columns"
      });
    }

    const allStocks = lines
      .slice(1)
      .map(line => {
        const columns = parseCSVLine(line);

        return {
          symbol: columns[symbolIndex]?.trim(),
          isin: columns[isinIndex]?.trim()
        };
      })
      .filter(stock =>
        stock.symbol &&
        stock.isin &&
        /^[A-Z0-9]+$/i.test(stock.isin)
      );

    const stocks = allStocks.slice(offset, offset + limit);

    const results = [];
    const errors = [];

    /*
     * Find a date seven calendar days earlier.
     */
    const getPreviousDate = (dateString, daysBack) => {
      const date = new Date(
        `${dateString}T00:00:00+05:30`
      );

      date.setUTCDate(date.getUTCDate() - daysBack);

      return date.toISOString().slice(0, 10);
    };

    const previousStartDate = getPreviousDate(today, 7);

    /*
     * Keep requests sequential.
     * Retry temporary HTTP 429 and 5xx errors.
     *
     * Sequential requests are slower, but avoid launching
     * many simultaneous requests against Upstox.
     */
    const REQUEST_INTERVAL_MS = 200;
    const MAX_ATTEMPTS = 3;

    let lastRequestStartedAt = 0;

    const fetchUpstoxJson = async url => {
      let lastResult = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const elapsed =
          Date.now() - lastRequestStartedAt;

        if (
          lastRequestStartedAt > 0 &&
          elapsed < REQUEST_INTERVAL_MS
        ) {
          await wait(REQUEST_INTERVAL_MS - elapsed);
        }

        lastRequestStartedAt = Date.now();

        let response;
        let data;

        try {
          response = await fetch(url, {
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`
            },
            signal: AbortSignal.timeout(20000)
          });

          try {
            data = await response.json();
          } catch {
            data = {
              message: "Invalid JSON response from Upstox"
            };
          }
        } catch (error) {
          lastResult = {
            ok: false,
            status: 0,
            data: {
              message: error.message || "Network request failed"
            }
          };

          if (attempt < MAX_ATTEMPTS) {
            await wait(1000 * attempt);
            continue;
          }

          return lastResult;
        }

        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            data
          };
        }

        lastResult = {
          ok: false,
          status: response.status,
          data
        };

        const shouldRetry =
          response.status === 429 ||
          response.status >= 500;

        if (!shouldRetry || attempt === MAX_ATTEMPTS) {
          return lastResult;
        }

        const retryAfter = Number(
          response.headers.get("Retry-After")
        );

        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30000)
            : 2000 * attempt;

        await wait(delay);
      }

      return lastResult;
    };

    /*
     * Process stocks one at a time.
     */
    for (const stock of stocks) {
      const instrumentKey = `NSE_EQ|${stock.isin}`;

      try {
        /*
         * 1. Retrieve one-minute candles.
         */
        const isToday = today === getTodayIST();

        const minuteUrl = isToday
          ? `https://api.upstox.com/v3/historical-candle/intraday/${encodeURIComponent(
              instrumentKey
            )}/minutes/1`
          : `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(
              instrumentKey
            )}/minutes/1/${today}/${today}`;

        const minuteResult =
          await fetchUpstoxJson(minuteUrl);

        if (!minuteResult.ok) {
          errors.push({
            symbol: stock.symbol,
            stage: "1-minute-data",
            status: minuteResult.status,
            message: minuteResult.data?.message ||
              "Unable to retrieve minute candles"
          });

          continue;
        }

        const candles =
          minuteResult.data?.data?.candles || [];

        /*
         * 2. Calculate the 09:15–09:30 opening range.
         * The range uses the 15 candles from 09:15
         * through 09:29, excluding the 09:30 candle.
         */
        const openingRangeCandles = candles.filter(
          candle => {
            const time = candle[0];

            return (
              time >= `${today}T09:15:00+05:30` &&
              time < `${today}T09:30:00+05:30`
            );
          }
        );

        if (openingRangeCandles.length !== 15) {
          errors.push({
            symbol: stock.symbol,
            stage: "opening-range",
            message:
              `Expected 15 candles; received ${openingRangeCandles.length}`
          });

          continue;
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
         * 3. Retrieve previous daily candles.
         */
        const dailyUrl =
          `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(
            instrumentKey
          )}/days/1/${today}/${previousStartDate}`;

        const dailyResult =
          await fetchUpstoxJson(dailyUrl);

        if (!dailyResult.ok) {
          errors.push({
            symbol: stock.symbol,
            stage: "daily-data",
            status: dailyResult.status,
            message: dailyResult.data?.message ||
              "Unable to retrieve daily candles"
          });

          continue;
        }

        const dailyCandles =
          dailyResult.data?.data?.candles || [];

        const previousCandles = dailyCandles
          .filter(candle =>
            candle[0] < `${today}T00:00:00+05:30`
          )
          .sort((a, b) =>
            new Date(b[0]).getTime() -
            new Date(a[0]).getTime()
          );

        const previousCandle = previousCandles[0];

        if (!previousCandle) {
          errors.push({
            symbol: stock.symbol,
            stage: "previous-day",
            message: "Previous trading day candle not found"
          });

          continue;
        }

        const previousHigh = Number(previousCandle[2]);
        const previousLow = Number(previousCandle[3]);
        const previousClose = Number(previousCandle[4]);

        /*
         * 4. Standard Camarilla S3 / R3.
         */
        const range = previousHigh - previousLow;

        const r3 =
          previousClose + (range * 1.1) / 4;

        const s3 =
          previousClose - (range * 1.1) / 4;

        /*
         * 5. Apply the exact strategy condition.
         */
        const matches =
          s3 < orbLow &&
          orbLow < orbHigh &&
          orbHigh < r3;

        if (!matches) {
          continue;
        }

        /*
         * 6. Read the 09:30–09:31 candle.
         */
        const candle930 = candles.find(candle =>
          candle[0] >= `${today}T09:30:00+05:30` &&
          candle[0] < `${today}T09:31:00+05:30`
        );

        if (!candle930) {
          errors.push({
            symbol: stock.symbol,
            stage: "930-candle",
            message: "09:30 candle is not available"
          });

          continue;
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
          message: error.message || "Unexpected error"
        });
      }
    }

    return res.status(200).json({
      ok: true,
      status: "scanner_batch_complete",
      date: today,
      totalStocks: allStocks.length,
      stocksChecked: stocks.length,
      offset,
      limit,
      nextOffset:
        offset + stocks.length < allStocks.length
          ? offset + stocks.length
          : null,
      hasMore:
        offset + stocks.length < allStocks.length,
      condition: "S3 < ORB Low < ORB High < R3",
      openingRange: "09:15–09:30 IST",
      camarilla: "Standard",
      matches: results,
      matchCount: results.length,
      errorCount: errors.length,
      errors
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Scanner failed",
      error: error.message || "Unknown error"
    });
  }
}
