import { daysAgo } from "../time";

export type FailedJob = { id: string; job: string; error: string; failedAt: string; retries: number };
export const FAILED_JOBS: FailedJob[] = [
  { id: "j1", job: "retail-sentiment-sync:NZDUSD", error: "Upstream broker feed timeout after 30s", failedAt: daysAgo(0.3), retries: 2 },
  { id: "j2", job: "cot-positioning-sync:NATGAS", error: "Report not yet published by exchange for this contract", failedAt: daysAgo(1.1), retries: 3 },
  { id: "j3", job: "news-classifier:batch-2216", error: "Model confidence below publish threshold on 2 of 14 stories", failedAt: daysAgo(2.4), retries: 1 },
];

export type AuditLogEntry = { id: string; actor: string; action: string; detail: string; at: string };
export const AUDIT_LOGS: AuditLogEntry[] = [
  { id: "a1", actor: "admin@marketintelligence.ai", action: "Updated factor weight", detail: "Technical trend weight 0.18 → 0.20", at: daysAgo(4) },
  { id: "a2", actor: "admin@marketintelligence.ai", action: "Updated bias threshold", detail: "Bullish threshold +5 → +4", at: daysAgo(9) },
  { id: "a3", actor: "system", action: "Re-ran calculations", detail: "Full recalculation after data-source outage on XPTUSD", at: daysAgo(9.2) },
  { id: "a4", actor: "admin@marketintelligence.ai", action: "Disabled instrument", detail: "Temporarily disabled NATGAS pending exchange report delay", at: daysAgo(15) },
  { id: "a5", actor: "admin@marketintelligence.ai", action: "Added instrument", detail: "Added ETHUSD to Crypto asset class", at: daysAgo(30) },
];

export const API_USAGE = {
  requestsToday: 48213,
  requestsMonth: 1284933,
  rateLimitPerMin: 300,
  activeApiKeys: 27,
};

// Single-plan product (Pro only, with a 3-day free trial) — subscribers are
// tracked by trial-vs-paid status, not by plan tier.
export const USER_ACTIVITY = {
  dailyActiveUsers: 1842,
  weeklyActiveUsers: 6210,
  trialUsers: 214,
  subscriberUsers: 1320,
};

export const SYSTEM_ANNOUNCEMENTS = [
  { id: "an1", title: "Seasonality module lookback extended to 25 years", publishedAt: daysAgo(6) },
  { id: "an2", title: "New instrument: Platinum (XPTUSD) added to Commodities", publishedAt: daysAgo(20) },
];
