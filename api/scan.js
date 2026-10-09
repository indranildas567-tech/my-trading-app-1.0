

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

    const limit = Math.min(Number(req.query.limit || 5), 500);

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

    const parseCSVLine = (line) => {
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

    const headers = parseCSVLine(lines[0]).map(header =>
      header.trim()
    );

    const symbolIndex = headers.indexOf("Symbol");
    const isinIndex = headers.indexOf("ISIN Code");

    if (symbolIndex === -1 || isinIndex === -1) {
      return res.status(500).json({
        ok: false,
        message: "CSV does not contain Symbol and ISIN Code columns"
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
      const date = new Date(`${dateString}T00:00:00+05:30`);
      date.setDate(date.getDate() - daysBack);

      return date.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata"
      });
    };

    const previousStartDate = getPreviousDate(today, 7);

    for (const stock of stocks) {
      const instrumentKey = `NSE_EQ|${stock.isin}`;

      try {
        /*
         * Today's 1-minute candles
         */
        const minuteUrl =
          today ===
          new Date().toLocaleDateString("en-CA", {
            timeZone: "Asia/Kolkata"
          })
            ? `https://api.upstox.com/v3/historical-candle/intraday/${encodeURIComponent(
                instrumentKey
              )}/minutes/1`
            : `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(
                instrumentKey
              )}/minutes/1/${today}/${today}`;

        const minuteResponse = await fetch(minuteUrl, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`
          }
        });

        const minuteData = await minuteResponse.json();

        if (!minuteResponse.ok) {
          errors.push({
            symbol: stock.symbol,
            stage: "1-minute-data",
            data: minuteData
          });
          continue;
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
          continue;
        }

        const orbHigh = Math.max(
          ...openingRangeCandles.map(candle => Number(candle[2]))
        );

        const orbLow = Math.min(
          ...openingRangeCandles.map(candle => Number(candle[3]))
        );
      
        /*
         * Previous trading day's OHLC
         */
        const dailyResponse = await fetch(
          `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(
            instrumentKey
          )}/days/1/${today}/${previousStartDate}`,
          {
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`
            }
          }
        );

        const dailyData = await dailyResponse.json();

        if (!dailyResponse.ok) {
          errors.push({
            symbol: stock.symbol,
            stage: "daily-data",
            data: dailyData
          });
          continue;
        }

        const dailyCandles = dailyData.data?.candles || [];

        const previousCandle = dailyCandles.find(candle => {
          return candle[0] < `${today}T00:00:00+05:30`;
        });

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
         * Standard Camarilla S3 / R3
         */
        const range = previousHigh - previousLow;

        const r3 =
          previousClose + (range * 1.1) / 4;

        const s3 =
          previousClose - (range * 1.1) / 4;

        /*
         * Required strategy:
         *
         * S3 < ORB Low < ORB High < R3
         */
        const matches =
          s3 < orbLow &&
          orbLow < orbHigh &&
          orbHigh < r3;

        

               if (matches) {

          /*
           * Find the completed 9:30–9:31 AM candle
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
        }
       

      } catch (error) {
        errors.push({
          symbol: stock.symbol,
          stage: "unexpected-error",
          message: error.message
        });
      }
    }

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
