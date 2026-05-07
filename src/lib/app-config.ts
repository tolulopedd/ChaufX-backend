export const appConfig = {
  brandName: "ChaufX",
  tripActivationMinutesBeforeStart: 15,
  tripCompletionGraceMinutes: 30,
  defaultCurrency: "CAD",
  driverLocationFreshnessMinutes: 30,
  driverDispatchFanout: 5
} as const;

export type ActivationWindow = {
  startsAt: Date;
  endsAt: Date;
};

export function buildActivationWindow(scheduledStartAt: Date, expectedDurationMinutes: number): ActivationWindow {
  const startsAt = new Date(scheduledStartAt.getTime() - appConfig.tripActivationMinutesBeforeStart * 60_000);
  const endsAt = new Date(
    scheduledStartAt.getTime() + (expectedDurationMinutes + appConfig.tripCompletionGraceMinutes) * 60_000
  );

  return { startsAt, endsAt };
}

export function isTripWindowActive(now: Date, startsAt: Date, endsAt: Date) {
  return now >= startsAt && now <= endsAt;
}

export const defaultServiceZones = [
  {
    code: "WPG-CENTRAL",
    name: "Winnipeg Central",
    centerLat: 49.8951,
    centerLng: -97.1384,
    radiusKm: 22
  },
  {
    code: "WPG-SOUTH",
    name: "Winnipeg South",
    centerLat: 49.8175,
    centerLng: -97.1518,
    radiusKm: 18
  }
] as const;
