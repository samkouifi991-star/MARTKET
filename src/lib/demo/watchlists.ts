import { Watchlist } from "../types";

export const DEFAULT_WATCHLISTS: Watchlist[] = [
  { id: "wl-majors", name: "FX Majors", symbols: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD"] },
  { id: "wl-metals", name: "Metals", symbols: ["XAUUSD", "XAGUSD", "XPTUSD", "COPPER"] },
  { id: "wl-risk", name: "Risk Barometers", symbols: ["SPX500", "NAS100", "BTCUSD", "USDJPY", "XAUUSD"] },
];
