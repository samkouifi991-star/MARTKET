import { Rng } from "../rng";

// A per-country "where are we in the economic cycle" seed that growth,
// inflation, labor and central-bank stance generation all read from, so a
// single country's indicators cohere (strong growth tends to run alongside
// firming labor, firmer inflation, and a more hawkish central bank) instead
// of each metric being independently random noise.
export function countryCycle(code: string): number {
  const rng = new Rng(`cycle:${code}`);
  const raw = rng.float(-1, 1);
  return Math.sign(raw) * Math.pow(Math.abs(raw), 0.6);
}
