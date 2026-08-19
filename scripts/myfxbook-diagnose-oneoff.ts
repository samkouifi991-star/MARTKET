// One-off: run diagnoseMyfxbookConnection("GBPUSD") against the real
// Myfxbook API from inside a Vercel build (this sandbox cannot reach
// myfxbook.com directly) to confirm the new same-execution diagnostic
// logging and the unavailable-vs-error classification work against a real
// response, not just mocks. Will be removed after the result is captured.
import { diagnoseMyfxbookConnection } from "../src/services/market-data/retail-sentiment/myfxbook";

async function main() {
  const diag = await diagnoseMyfxbookConnection("GBPUSD");
  console.log(`MYFXBOOK_ONEOFF_RESULT: ${JSON.stringify(diag)}`);
}

main().catch((err) => console.log(`MYFXBOOK_ONEOFF_RESULT: unexpected error ${err instanceof Error ? err.message : String(err)}`));
