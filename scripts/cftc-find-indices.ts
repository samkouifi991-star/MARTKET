// cftc-verify.ts flagged NAS100 and DJ30's configured reportName values as
// wrong: "NASDAQ-100 CONSOLIDATED - CHICAGO MERCANTILE EXCHANGE" and "DJIA
// CONSOLIDATED - CHICAGO BOARD OF TRADE" both resolve (contract discovery
// finds a market_and_exchange_names match) but return 0 rows — same
// symptom the GBP rename bug had (see cftc-find-gbp.ts): the exchange-name
// string CFTC actually publishes under today has drifted from what's
// configured. Queries the raw financial_futures dataset for anything
// NASDAQ/DJIA-related by commodity_name/contract_market_name (more
// rename-resistant than market_and_exchange_names) to surface every
// current naming variant directly.
//
// Usage: npm run test:cftc-find-indices
export {}; // force module scope — cftc-find-gbp.ts uses the same identifier names as a global script

const CFTC_BASE = "https://publicreporting.cftc.gov/resource";
const FINANCIAL_FUTURES_DATASET = "gpe5-46if";

type RawRow = Record<string, string | number | undefined>;

async function findFor(label: string, filter: string) {
  const url = new URL(`${CFTC_BASE}/${FINANCIAL_FUTURES_DATASET}.json`);
  url.searchParams.set("$where", filter);
  url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
  url.searchParams.set("$limit", "2000");

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.log(`CFTC_FIND_INDICES: ${label} — request failed ${res.status} ${res.statusText}`);
    return;
  }
  const rows = (await res.json()) as RawRow[];
  console.log(`CFTC_FIND_INDICES: ${label} — fetched ${rows.length} rows`);

  const byName = new Map<string, { latest: string; commodity: string; contract: string; code: string }>();
  for (const r of rows) {
    const name = String(r["market_and_exchange_names"] ?? "");
    const date = String(r["report_date_as_yyyy_mm_dd"] ?? "");
    if (!name || !date) continue;
    const existing = byName.get(name);
    if (!existing || date > existing.latest) {
      byName.set(name, {
        latest: date,
        commodity: String(r["commodity_name"] ?? ""),
        contract: String(r["contract_market_name"] ?? ""),
        code: String(r["cftc_contract_market_code"] ?? ""),
      });
    }
  }

  const sorted = [...byName.entries()].sort((a, b) => (a[1].latest < b[1].latest ? 1 : -1));
  console.log(`CFTC_FIND_INDICES: ${label} — ${sorted.length} distinct market_and_exchange_names found, newest first:`);
  for (const [name, info] of sorted.slice(0, 15)) {
    console.log(`CFTC_FIND_INDICES:   "${name}" | latest=${info.latest} | commodity="${info.commodity}" | contract="${info.contract}" | code="${info.code}"`);
  }
}

async function main() {
  await findFor("NAS100", `upper(commodity_name) like '%NASDAQ%' OR upper(contract_market_name) like '%NASDAQ%' OR upper(market_and_exchange_names) like '%NASDAQ%'`);
  await findFor(
    "DJ30",
    `upper(commodity_name) like '%DJIA%' OR upper(commodity_name) like '%DOW JONES%' OR upper(contract_market_name) like '%DJIA%' OR upper(contract_market_name) like '%DOW JONES%' OR upper(market_and_exchange_names) like '%DJIA%' OR upper(market_and_exchange_names) like '%DOW JONES%'`
  );
}

main().catch((err) => console.log(`CFTC_FIND_INDICES: unexpected error ${err instanceof Error ? err.message : String(err)}`));
