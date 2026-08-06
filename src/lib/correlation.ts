import { PricePoint } from "./types";

function returns(series: PricePoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) out.push((series[i].price - series[i - 1].price) / series[i - 1].price);
  return out;
}

export function pearsonCorrelation(a: PricePoint[], b: PricePoint[]): number {
  const n = Math.min(a.length, b.length);
  const ra = returns(a.slice(-n));
  const rb = returns(b.slice(-n));
  const len = Math.min(ra.length, rb.length);
  const meanA = ra.reduce((s, v) => s + v, 0) / len;
  const meanB = rb.reduce((s, v) => s + v, 0) / len;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < len; i++) {
    const da = ra[i] - meanA;
    const db = rb[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denom = Math.sqrt(varA * varB);
  return denom === 0 ? 0 : cov / denom;
}
