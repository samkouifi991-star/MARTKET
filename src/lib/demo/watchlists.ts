import { Watchlist } from "../types";

// Every default symbol here must be a LAUNCH_READY (STRICT_LIVE_SYMBOLS)
// market — see services/market-coverage.ts — so a brand-new user's
// starter watchlists never quietly contain a market with no verified real
// data coverage (XPTUSD/COPPER/NAS100 were here before Phase 1's launch
// filtering and have been removed for exactly that reason).
export const DEFAULT_WATCHLISTS: Watchlist[] = [
  { id: "wl-majors", name: "FX Majors", symbols: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD"] },
  { id: "wl-metals", name: "Metals", symbols: ["XAUUSD", "XAGUSD"] },
  { id: "wl-risk", name: "Risk Barometers", symbols: ["SPX500", "BTCUSD", "USDJPY", "XAUUSD"] },
];
