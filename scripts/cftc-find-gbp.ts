// One-off diagnostic: cftc-verify.ts just proved that searching
// market_and_exchange_names for "BRITISH POUND STERLING" only turns up rows
// through 2022-02-01, even via the new discoverCftcContract() logic — i.e.
// CFTC's current naming for GBP futures likely no longer contains that
// exact substring at all (a rename, not a data gap). This queries the raw
// financial_futures dataset for anything GBP/pound-related by
// commodity_name/contract_market_name instead, to find today's real string.
const CFTC_BASE = "https://publicreporting.cftc.gov/resource";
const FINANCIAL_FUTURES_DATASET = "gpe5-46if";

type RawRow = Record<string, string | number | undefined>;

async function main() {
  const url = new URL(`${CFTC_BASE}/${FINANCIAL_FUTURES_DATASET}.json`);
  url.searchParams.set(
    "$where",
    `upper(commodity_name) like '%POUND%' OR upper(contract_market_name) like '%POUND%' OR upper(market_and_exchange_names) like '%POUND%' OR upper(market_and_exchange_names) like '%GBP%'`
  );
  url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
  url.searchParams.set("$limit", "2000");

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.log(`CFTC_FIND_GBP: request failed ${res.status} ${res.statusText}`);
    return;
  }
  const rows = (await res.json()) as RawRow[];
  console.log(`CFTC_FIND_GBP: fetched ${rows.length} rows matching a pound/GBP filter`);

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
  console.log(`CFTC_FIND_GBP: ${sorted.length} distinct market_and_exchange_names found, newest first:`);
  for (const [name, info] of sorted.slice(0, 15)) {
    console.log(`CFTC_FIND_GBP:   "${name}" | latest=${info.latest} | commodity="${info.commodity}" | contract="${info.contract}" | code="${info.code}"`);
  }
}

main().catch((err) => console.log(`CFTC_FIND_GBP: unexpected error ${err instanceof Error ? err.message : String(err)}`));
