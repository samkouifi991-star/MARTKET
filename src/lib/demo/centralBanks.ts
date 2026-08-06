import { CentralBank } from "../types";
import { Rng } from "../rng";
import { daysAgo, isoOffset } from "../time";
import { countryCycle } from "./cycle";

type BankSpec = { code: string; name: string; currency: string; rateBase: number; countryCode: string };

const BANK_SPECS: BankSpec[] = [
  { code: "FED", name: "Federal Reserve", currency: "USD", rateBase: 5.25, countryCode: "US" },
  { code: "ECB", name: "European Central Bank", currency: "EUR", rateBase: 3.75, countryCode: "EU" },
  { code: "BOE", name: "Bank of England", currency: "GBP", rateBase: 5.0, countryCode: "GB" },
  { code: "BOJ", name: "Bank of Japan", currency: "JPY", rateBase: 0.25, countryCode: "JP" },
  { code: "BOC", name: "Bank of Canada", currency: "CAD", rateBase: 4.5, countryCode: "CA" },
  { code: "RBA", name: "Reserve Bank of Australia", currency: "AUD", rateBase: 4.35, countryCode: "AU" },
  { code: "RBNZ", name: "Reserve Bank of New Zealand", currency: "NZD", rateBase: 5.5, countryCode: "NZ" },
  { code: "SNB", name: "Swiss National Bank", currency: "CHF", rateBase: 1.25, countryCode: "CH" },
];

const STATEMENTS: Record<string, string[]> = {
  Hawkish: [
    "Policymakers reiterated that further progress on inflation is needed before considering cuts.",
    "The committee signaled rates may need to stay higher for longer given persistent price pressures.",
  ],
  Neutral: [
    "The committee said it will remain data-dependent ahead of the next meeting.",
    "Policymakers noted a balanced set of risks to the inflation and growth outlook.",
  ],
  Dovish: [
    "Officials pointed to slowing inflation as opening the door to gradual policy easing.",
    "The statement emphasized growing concern over labor-market softening.",
  ],
};

function buildBank(spec: BankSpec): CentralBank {
  const rng = new Rng(`cb:${spec.code}`);
  // A central bank's stance mostly reflects its own economy's cycle (hot
  // economy -> more likely hawkish), plus independent policy-committee noise.
  const cycle = countryCycle(spec.countryCode);
  const stanceRoll = cycle * 0.7 + rng.float(-0.7, 0.7);
  const stance = stanceRoll > 0.3 ? ("Hawkish" as const) : stanceRoll < -0.3 ? ("Dovish" as const) : ("Neutral" as const);
  const stanceScore = stance === "Hawkish" ? rng.float(2, 9) : stance === "Dovish" ? rng.float(-9, -2) : rng.float(-2, 2);
  const previousRate = spec.rateBase;
  const moveDirection = stance === "Hawkish" ? 1 : stance === "Dovish" ? -1 : 0;
  const currentRate = Number((previousRate + moveDirection * rng.pick([0, 0, 0.25])).toFixed(2));

  let probHike = 5;
  let probCut = 5;
  let probHold = 90;
  if (stance === "Hawkish") {
    probHike = rng.int(20, 55);
    probHold = 100 - probHike - rng.int(2, 8);
    probCut = 100 - probHike - probHold;
  } else if (stance === "Dovish") {
    probCut = rng.int(25, 65);
    probHold = 100 - probCut - rng.int(2, 8);
    probHike = 100 - probCut - probHold;
  } else {
    probHold = rng.int(60, 85);
    const remainder = 100 - probHold;
    probHike = Math.round(remainder / 2);
    probCut = remainder - probHike;
  }

  const yield2y = Number((currentRate - rng.float(-0.3, 1.1)).toFixed(2));
  const yield10y = Number((yield2y + rng.float(-1.2, 0.6)).toFixed(2));

  return {
    code: spec.code,
    name: spec.name,
    currency: spec.currency,
    currentRate,
    previousRate,
    nextMeeting: isoOffset(rng.int(5, 55) * 24),
    probHike,
    probHold,
    probCut,
    yield2y,
    yield10y,
    yieldCurveSlope: Number((yield10y - yield2y).toFixed(2)),
    stance,
    stanceScore: Number(stanceScore.toFixed(1)),
    lastStatement: rng.pick(STATEMENTS[stance]) + ` (${spec.name}, ${new Date(daysAgo(rng.int(3, 20))).toDateString()})`,
  };
}

export const CENTRAL_BANKS: CentralBank[] = BANK_SPECS.map(buildBank);

export function getCentralBankByCurrency(currency: string): CentralBank {
  const bank = CENTRAL_BANKS.find((b) => b.currency === currency);
  if (!bank) throw new Error(`No central bank for currency ${currency}`);
  return bank;
}
