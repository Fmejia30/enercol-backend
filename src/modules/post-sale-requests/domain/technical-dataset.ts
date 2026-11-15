const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TelemetryReading {
  readonly measuredAt: string;
  readonly measuredDemand: string;
}

export interface HistoricalConsumption {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly consumption: string;
}

export interface TechnicalDataset {
  readonly requestId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly demandThreshold: string | null;
  readonly demandUnit: string;
  readonly evaluationConsumption: string | null;
  readonly consumptionUnit: string;
  readonly sourceName: string;
  readonly sourceKind: string;
  telemetry: TelemetryReading[];
  historicalConsumption: HistoricalConsumption[];
}

export interface StoredTechnicalDataset {
  readonly demandThreshold: string | null;
  readonly demandUnit: string;
  readonly evaluationConsumption: string | null;
  readonly consumptionUnit: string;
  readonly sourceName: string;
  readonly sourceKind: string;
  readonly telemetry: readonly TelemetryReading[];
  readonly historicalConsumption: readonly HistoricalConsumption[];
}

export function telemetryDuringPeriod(
  readings: readonly TelemetryReading[],
  periodStart: string,
  periodEnd: string,
): TelemetryReading[] {
  const start = Date.parse(`${periodStart}T00:00:00.000Z`);
  const end = Date.parse(`${periodEnd}T00:00:00.000Z`) + DAY_MS;
  return readings.filter((reading) => {
    const measuredAt = Date.parse(reading.measuredAt);
    return measuredAt >= start && measuredAt < end;
  });
}

export function historyBeforePeriod(
  rows: readonly HistoricalConsumption[],
  periodStart: string,
): HistoricalConsumption[] {
  return rows.filter((row) => row.periodEnd < periodStart);
}

export function presentTechnicalDataset(
  request: { id: string; periodStart: string; periodEnd: string },
  stored: StoredTechnicalDataset,
): TechnicalDataset {
  return {
    requestId: request.id,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    demandThreshold: stored.demandThreshold,
    demandUnit: stored.demandUnit,
    evaluationConsumption: stored.evaluationConsumption,
    consumptionUnit: stored.consumptionUnit,
    sourceName: stored.sourceName,
    sourceKind: stored.sourceKind,
    telemetry: telemetryDuringPeriod(
      stored.telemetry,
      request.periodStart,
      request.periodEnd,
    ),
    historicalConsumption: historyBeforePeriod(
      stored.historicalConsumption,
      request.periodStart,
    ),
  };
}

export function utcDateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const text = `${String(year)}-${month}-${day}`;
  if (!DATE_ONLY.test(text)) {
    throw new Error('Technical date is invalid');
  }
  return text;
}
