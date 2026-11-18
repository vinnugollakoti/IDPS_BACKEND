export type BusTripPeriodValue = "MORNING" | "EVENING";

function configuredHour(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 && value <= 23 ? value : fallback;
}

export function isBusTripWindowOpen(period: BusTripPeriodValue, at = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(at));
  if (period === "MORNING") return hour >= configuredHour("BUS_MORNING_START_HOUR", 5) && hour < configuredHour("BUS_MORNING_END_HOUR", 11);
  return hour >= configuredHour("BUS_EVENING_START_HOUR", 13) && hour < configuredHour("BUS_EVENING_END_HOUR", 21);
}
