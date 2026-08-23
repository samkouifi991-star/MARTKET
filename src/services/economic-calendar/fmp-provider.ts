// The only EconomicCalendarProvider implementation today — wraps the
// existing FMP economics-calendar integration (services/market-data/fmp.ts,
// already used by the V1 /economic-calendar page and its cron) and adds the
// taxonomy classification FMP itself doesn't provide. FMP has no
// "revised previous" field, so revisedPrevious always comes back honestly
// null here — never fabricated. A future dedicated vendor adapter can
// populate it for real.
import * as fmp from "../market-data/fmp";
import { Provenance } from "../types";
import { EconomicCalendarProvider, EconomicRelease } from "./provider";
import { importanceTierFor, matchIndicator } from "./indicator-taxonomy";

export const fmpEconomicCalendarProvider: EconomicCalendarProvider = {
  async getReleases(fromISO: string, toISO: string): Promise<Provenance<EconomicRelease[]>> {
    const result = await fmp.getEconomicCalendar(fromISO, toISO);
    if (!result.value) return { ...result, value: null };

    const releases: EconomicRelease[] = result.value.map((e) => {
      const indicatorKey = matchIndicator(e.event);
      return {
        id: e.id,
        country: e.country,
        event: e.event,
        indicatorKey,
        importanceTier: indicatorKey ? importanceTierFor(indicatorKey) : null,
        dateTime: e.dateTime,
        actual: e.actual,
        forecast: e.forecast,
        previous: e.previous,
        revisedPrevious: null,
      };
    });

    return { ...result, value: releases };
  },
};
