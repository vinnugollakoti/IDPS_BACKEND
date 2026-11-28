export const BUS_TRIP_STALE_MS = 90_000;

export function isBusTripStale(lastPingAt: Date, now = Date.now()): boolean {
  return now - lastPingAt.getTime() > BUS_TRIP_STALE_MS;
}

export function staleTripCutoff(now = Date.now()): Date {
  return new Date(now - BUS_TRIP_STALE_MS);
}
