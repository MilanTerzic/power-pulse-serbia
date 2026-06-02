// SEEPEX/Serbia day-ahead forecast — ARIMA-lite cascade.
// Pure JS so it runs in the worker. Model order:
//   1. AR(p) least-squares with seasonal (168h) differencing
//   2. Seasonal naive (168h)
//   3. Rolling mean fallback
export interface ForecastPoint { ts: string; forecast: number; lo80: number; hi80: number; }
export interface ForecastResult {
  model: "sarima_lite" | "seasonal_naive" | "rolling_mean";
  history_points: number;
  horizon_h: number;
  forecast: ForecastPoint[];
  mae?: number;
  mape?: number;
  warnings: string[];
}

const SEASON = 168; // hourly, weekly

function rollingMean(history: number[], horizon: number): number[] {
  const tail = history.slice(-Math.min(history.length, 48));
  const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
  return Array.from({ length: horizon }, () => mean);
}

function seasonalNaive(history: number[], horizon: number): number[] {
  if (history.length < SEASON) return rollingMean(history, horizon);
  const out: number[] = [];
  for (let i = 0; i < horizon; i++) {
    const ref = history[history.length - SEASON + (i % SEASON)];
    out.push(ref);
  }
  return out;
}

// AR(p) on seasonally differenced series, then re-integrate
function sarimaLite(history: number[], horizon: number, p = 24): { fc: number[]; resid_std: number } {
  if (history.length < SEASON + p + 24) {
    return { fc: seasonalNaive(history, horizon), resid_std: stdev(history) * 0.5 };
  }
  // Seasonal diff
  const d: number[] = [];
  for (let i = SEASON; i < history.length; i++) d.push(history[i] - history[i - SEASON]);
  // Build design matrix for AR(p) least squares
  const Y: number[] = [];
  const X: number[][] = [];
  for (let i = p; i < d.length; i++) {
    Y.push(d[i]);
    X.push(d.slice(i - p, i).slice().reverse());
  }
  const coef = leastSquares(X, Y);
  if (!coef) return { fc: seasonalNaive(history, horizon), resid_std: stdev(history) * 0.5 };
  // Residual std for CI
  const resid: number[] = [];
  for (let i = 0; i < X.length; i++) {
    let pred = 0;
    for (let j = 0; j < p; j++) pred += coef[j] * X[i][j];
    resid.push(Y[i] - pred);
  }
  const rstd = stdev(resid);
  // Iterative forecast on diff, re-add seasonal component
  const dExt = d.slice();
  const hExt = history.slice();
  const fc: number[] = [];
  for (let step = 0; step < horizon; step++) {
    const lags = dExt.slice(-p).slice().reverse();
    let next = 0;
    for (let j = 0; j < p; j++) next += coef[j] * lags[j];
    dExt.push(next);
    const seasonalBase = hExt[hExt.length - SEASON + (step % SEASON)];
    const value = seasonalBase + next;
    hExt.push(value);
    fc.push(value);
  }
  return { fc, resid_std: rstd };
}

function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

// Solve normal equations via Gaussian elimination on (X^T X) β = X^T Y
function leastSquares(X: number[][], Y: number[]): number[] | null {
  const p = X[0]?.length ?? 0;
  if (p === 0) return null;
  const XtX: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  const XtY: number[] = Array(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < p; a++) {
      XtY[a] += X[i][a] * Y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  // Solve
  for (let i = 0; i < p; i++) {
    let max = i;
    for (let r = i + 1; r < p; r++) if (Math.abs(XtX[r][i]) > Math.abs(XtX[max][i])) max = r;
    [XtX[i], XtX[max]] = [XtX[max], XtX[i]];
    [XtY[i], XtY[max]] = [XtY[max], XtY[i]];
    const pivot = XtX[i][i];
    if (Math.abs(pivot) < 1e-12) return null;
    for (let j = i; j < p; j++) XtX[i][j] /= pivot;
    XtY[i] /= pivot;
    for (let r = 0; r < p; r++) {
      if (r === i) continue;
      const f = XtX[r][i];
      for (let j = i; j < p; j++) XtX[r][j] -= f * XtX[i][j];
      XtY[r] -= f * XtY[i];
    }
  }
  return XtY;
}

// Backtest: hold out last 168h, score the model
function backtest(history: number[]): { mae: number; mape: number } | null {
  if (history.length < SEASON * 2 + 48) return null;
  const train = history.slice(0, -SEASON);
  const test = history.slice(-SEASON);
  const { fc } = sarimaLite(train, test.length);
  let abs = 0, pct = 0, n = 0;
  for (let i = 0; i < test.length; i++) {
    abs += Math.abs(test[i] - fc[i]);
    if (Math.abs(test[i]) > 0.1) { pct += Math.abs((test[i] - fc[i]) / test[i]); n++; }
  }
  return { mae: abs / test.length, mape: n > 0 ? (pct / n) * 100 : 0 };
}

export function forecastPrices(history: Array<{ ts: string; price: number }>, horizon_h: number): ForecastResult {
  const warnings: string[] = [];
  const series = history.map(h => h.price);
  if (series.length < 48) {
    const fc = rollingMean(series, horizon_h);
    const ts0 = history.length ? new Date(history[history.length - 1].ts).getTime() + 3600_000 : Date.now();
    return {
      model: "rolling_mean",
      history_points: series.length,
      horizon_h,
      warnings: ["Not enough history (< 48 h). Using rolling mean."],
      forecast: fc.map((v, i) => ({ ts: new Date(ts0 + i * 3600_000).toISOString(), forecast: v, lo80: v - 5, hi80: v + 5 })),
    };
  }
  let model: ForecastResult["model"] = "sarima_lite";
  let fc: number[]; let resid_std = stdev(series) * 0.5;
  if (series.length >= SEASON + 48) {
    const r = sarimaLite(series, horizon_h);
    fc = r.fc; resid_std = r.resid_std;
  } else if (series.length >= SEASON) {
    model = "seasonal_naive"; fc = seasonalNaive(series, horizon_h);
    warnings.push("History < 8 days, AR fallback to seasonal naive.");
  } else {
    model = "rolling_mean"; fc = rollingMean(series, horizon_h);
    warnings.push("History < 1 week, fallback to rolling mean.");
  }
  const bt = backtest(series);
  const ts0 = new Date(history[history.length - 1].ts).getTime() + 3600_000;
  const z = 1.28;
  return {
    model,
    history_points: series.length,
    horizon_h,
    warnings,
    mae: bt?.mae, mape: bt?.mape,
    forecast: fc.map((v, i) => ({
      ts: new Date(ts0 + i * 3600_000).toISOString(),
      forecast: v,
      lo80: v - z * resid_std,
      hi80: v + z * resid_std,
    })),
  };
}
