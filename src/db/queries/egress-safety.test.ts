// Static regression guard for the Supabase free-tier egress incident: a
// customer-facing history/event-table query with no LIMIT and no date-range
// filter can return every row ever written (market_candles, in particular,
// is append-only and grows forever — see cron/candles/route.ts). This test
// doesn't run the queries; it reads each flagged function's own source text
// and asserts it contains a real bound (.limit(...), or a date/timestamp
// comparison like gte/lte/gt/lt/between) — the same rule requested for this
// codebase going forward: "no history query without LIMIT, a date range, or
// cursor pagination." A function added later that reads one of these tables
// without a bound should fail this test, not silently ship.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

/** Extracts one exported function's full source, from its `export async
 * function name(` (or `export function name(`) signature through the
 * matching closing brace — brace-depth counting, not a regex body match, so
 * nested blocks/objects inside the function don't truncate it early. */
function extractFunctionSource(source: string, functionName: string): string {
  const signature = new RegExp(`export\\s+async\\s+function\\s+${functionName}\\s*\\(|export\\s+function\\s+${functionName}\\s*\\(`);
  const match = signature.exec(source);
  if (!match) throw new Error(`Could not find function "${functionName}" — has it been renamed or moved? Update this test's coverage list.`);

  const start = source.indexOf("{", match.index);
  if (start === -1) throw new Error(`Could not find the opening brace for "${functionName}".`);

  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(match.index, i + 1);
    }
  }
  throw new Error(`Could not find the closing brace for "${functionName}" — malformed extraction.`);
}

// A real, enforced bound: an explicit row cap, or a comparison against a
// date/timestamp column (the date-range half of the rule). Cursor
// pagination (the third allowed form) shows up as a `.limit(` + a `gt`/`lt`
// cursor comparison in this codebase's actual paginated reads, so it's
// already covered by the same two checks.
function hasBoundedRead(functionSource: string): boolean {
  const hasLimit = /\.limit\(/.test(functionSource);
  const hasDateRangeFilter = /\b(gte|lte|gt|lt|between)\(/.test(functionSource);
  return hasLimit || hasDateRangeFilter;
}

// Every function in this codebase that SELECTs from a history/event table a
// customer-facing page or the scoring pipeline can trigger on a normal
// render — see market-data.ts, scores.ts. Deliberately excludes write-only
// functions (upsert/insert/record*) and single-row-by-key reads that are
// inherently bounded by their own primary/unique key (those still pass this
// check today via their own .limit(1), but aren't the point of this test).
const HISTORY_QUERY_FUNCTIONS: { file: string; functions: string[] }[] = [
  {
    file: "market-data.ts",
    functions: [
      "getLatestStoredCandles",
      "getLatestStoredEconomicSeries",
      "getEconomicEventsInRange",
      "getUpcomingHighImpactEvents",
      "getRecentNews",
      "getHighGeopoliticalRelevanceNews",
      "getLatestStoredPositioning",
    ],
  },
  {
    file: "scores.ts",
    functions: ["getScoreHistory", "getFactorChangesSince"],
  },
];

describe("egress safety: every history-table read is bounded", () => {
  for (const { file, functions } of HISTORY_QUERY_FUNCTIONS) {
    const source = readSource(file);
    for (const fn of functions) {
      it(`${file} — ${fn}() has a LIMIT or a date-range filter (never an unbounded SELECT)`, () => {
        const fnSource = extractFunctionSource(source, fn);
        expect(hasBoundedRead(fnSource)).toBe(true);
      });
    }
  }

  // The specific regression this whole test file exists to catch: before
  // the Supabase egress fix, getLatestStoredCandles had NEITHER a .limit()
  // NOR a date filter — it read every row ever stored for a symbol/
  // timeframe. market_candles is append-only (upsertCandles never
  // deletes — see cron/candles/route.ts), so that grows without bound for
  // as long as the app has been running. This case is named explicitly so
  // a future refactor can't silently drop the .limit() and still pass the
  // generic loop above by accident.
  it("getLatestStoredCandles specifically has a real .limit(...) call, not just a truthy match", () => {
    const source = readSource("market-data.ts");
    const fnSource = extractFunctionSource(source, "getLatestStoredCandles");
    expect(fnSource).toMatch(/\.limit\(\s*limit\s*\)/);
  });
});
