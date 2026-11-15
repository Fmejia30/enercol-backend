import type { PostSaleRequestType } from './post-sale-request.js';
import type {
  HistoricalConsumption,
  StoredTechnicalDataset,
  TelemetryReading,
} from './technical-dataset.js';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const QUANTITY = /^(?:0|[1-9]\d*)\.\d{3}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const ANALYSIS_STATUSES = ['SUCCEEDED', 'FAILED'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const ANALYSIS_INTERPRETATIONS = [
  'confirmed-observation',
  'requires-interpretation',
] as const;
export type AnalysisInterpretation = (typeof ANALYSIS_INTERPRETATIONS)[number];

export interface AnalysisEvidence {
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly measuredAt: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

export interface AnalysisFinding {
  readonly findingType: string;
  readonly description: string;
  readonly measuredValue: string;
  readonly referenceValue: string;
  readonly difference: string;
  readonly percentage: string;
  readonly unit: string;
  readonly interpretation: AnalysisInterpretation;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly evidence: readonly AnalysisEvidence[];
}

export interface AnalysisInputSnapshot {
  readonly requestType: PostSaleRequestType;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly demandThreshold: string | null;
  readonly demandUnit: string;
  readonly evaluationConsumption: string | null;
  readonly consumptionUnit: string;
  readonly telemetry: readonly TelemetryReading[];
  readonly historicalConsumption: readonly HistoricalConsumption[];
}

export interface AnalysisOutcome {
  readonly status: AnalysisStatus;
  readonly failureMessage: string | null;
  readonly findings: readonly AnalysisFinding[];
  readonly inputSnapshot: AnalysisInputSnapshot;
}

export function analyzeTechnicalDataset(
  request: {
    type: PostSaleRequestType;
    periodStart: string;
    periodEnd: string;
  },
  stored: StoredTechnicalDataset,
): AnalysisOutcome {
  const snapshot = snapshotOf(request, stored);
  const problem = validate(request, stored);
  if (problem) {
    return {
      status: 'FAILED',
      failureMessage: problem,
      findings: [],
      inputSnapshot: snapshot,
    };
  }
  if (request.type === 'VERIFICACION_DEMANDA') {
    return {
      status: 'SUCCEEDED',
      failureMessage: null,
      findings: [demandFinding(request, stored)],
      inputSnapshot: snapshot,
    };
  }
  return {
    status: 'SUCCEEDED',
    failureMessage: null,
    findings: [consumptionFinding(request, stored)],
    inputSnapshot: snapshot,
  };
}

function validate(
  request: {
    type: PostSaleRequestType;
    periodStart: string;
    periodEnd: string;
  },
  stored: StoredTechnicalDataset,
): string | null {
  if (!isDateOnly(request.periodStart) || !isDateOnly(request.periodEnd)) {
    return 'El periodo de evaluación no es válido.';
  }
  if (request.periodStart > request.periodEnd) {
    return 'El periodo de evaluación no es válido.';
  }
  if (
    request.type !== 'VERIFICACION_DEMANDA' &&
    request.type !== 'CONSUMO_ATIPICO'
  ) {
    return 'Este tipo de solicitud no tiene un análisis determinista en esta versión.';
  }
  if (hasInvalidHistory(stored.historicalConsumption, request.periodStart)) {
    return 'Hay consumos históricos que no terminan antes del periodo de evaluación.';
  }
  if (hasTelemetryOutsidePeriod(stored.telemetry, request)) {
    return 'Hay lecturas de telemetría fuera del periodo de evaluación.';
  }
  if (request.type === 'VERIFICACION_DEMANDA') {
    return validateDemand(request, stored);
  }
  return validateConsumption(stored);
}

function validateDemand(
  request: { periodStart: string; periodEnd: string },
  stored: StoredTechnicalDataset,
): string | null {
  if (stored.demandUnit !== 'kW') {
    return 'La unidad de demanda debe ser kW.';
  }
  if (
    stored.historicalConsumption.length > 0 &&
    stored.consumptionUnit !== 'kWh'
  ) {
    return 'La unidad de consumo debe ser kWh.';
  }
  if (
    stored.historicalConsumption.some(
      (row) => parseMilli(row.consumption) === null,
    )
  ) {
    return 'Hay valores técnicos con un formato inválido.';
  }
  if (stored.demandThreshold === null) {
    return 'El caso de demanda no tiene umbral contractual.';
  }
  const threshold = parseMilli(stored.demandThreshold);
  if (threshold === null) {
    return 'Hay valores técnicos con un formato inválido.';
  }
  if (threshold <= 0) {
    return 'El umbral contractual debe ser mayor que cero.';
  }
  if (stored.telemetry.length === 0) {
    return 'No hay lecturas de demanda dentro del periodo de evaluación.';
  }
  if (
    stored.telemetry.some(
      (reading) => parseMilli(reading.measuredDemand) === null,
    )
  ) {
    return 'Hay valores técnicos con un formato inválido.';
  }
  if (
    stored.telemetry.some(
      (reading) => !instantInPeriod(reading.measuredAt, request),
    )
  ) {
    return 'Hay lecturas de telemetría fuera del periodo de evaluación.';
  }
  return null;
}

function validateConsumption(stored: StoredTechnicalDataset): string | null {
  if (stored.consumptionUnit !== 'kWh') {
    return 'La unidad de consumo debe ser kWh.';
  }
  if (stored.demandThreshold !== null) {
    return 'El caso de consumo no usa un umbral contractual de demanda.';
  }
  if (stored.telemetry.length > 0) {
    return 'El caso de consumo incluye lecturas de demanda que no corresponden a la comparación en kWh.';
  }
  if (stored.evaluationConsumption === null) {
    return 'El caso de consumo no tiene el consumo del periodo de evaluación.';
  }
  const current = parseMilli(stored.evaluationConsumption);
  if (current === null || current < 0) {
    return 'Hay valores técnicos con un formato inválido.';
  }
  if (stored.historicalConsumption.length === 0) {
    return 'El caso de consumo no tiene meses históricos anteriores al periodo.';
  }
  if (
    stored.historicalConsumption.some(
      (row) => parseMilli(row.consumption) === null,
    )
  ) {
    return 'Hay valores técnicos con un formato inválido.';
  }
  const average = divideRound(
    stored.historicalConsumption.reduce(
      (total, row) => total + (parseMilli(row.consumption) ?? 0),
      0,
    ),
    stored.historicalConsumption.length,
  );
  if (average <= 0) {
    return 'El promedio histórico es cero y no permite calcular una variación.';
  }
  return null;
}

function demandFinding(
  request: { periodStart: string; periodEnd: string },
  stored: StoredTechnicalDataset,
): AnalysisFinding {
  const threshold = parseMilli(stored.demandThreshold ?? '') ?? 0;
  const readings = stored.telemetry.map((reading) => ({
    ...reading,
    milli: parseMilli(reading.measuredDemand) ?? 0,
  }));
  const maximum = readings.reduce((best, reading) =>
    reading.milli > best.milli ? reading : best,
  );
  const difference = maximum.milli - threshold;
  const exceeding = readings.filter((reading) => reading.milli > threshold);
  const above = difference > 0;
  return {
    findingType: above ? 'DEMAND_EXCEEDANCE' : 'DEMAND_WITHIN_CONTRACT',
    description: above
      ? `La demanda máxima medida es ${formatMilli(maximum.milli)} kW y el umbral contractual es ${formatMilli(threshold)} kW. La diferencia es ${formatMilli(difference)} kW (${formatMilli(percentageMilli(difference, threshold))} %).`
      : `La demanda máxima medida es ${formatMilli(maximum.milli)} kW y no supera el umbral contractual de ${formatMilli(threshold)} kW.`,
    measuredValue: formatMilli(maximum.milli),
    referenceValue: formatMilli(threshold),
    difference: formatMilli(difference),
    percentage: formatMilli(percentageMilli(difference, threshold)),
    unit: 'kW',
    interpretation: 'confirmed-observation',
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    evidence: (exceeding.length > 0 ? exceeding : [maximum]).map((reading) => ({
      label: 'Lectura de demanda',
      value: formatMilli(reading.milli),
      unit: 'kW',
      measuredAt: reading.measuredAt,
      periodStart: null,
      periodEnd: null,
    })),
  };
}

function consumptionFinding(
  request: { periodStart: string; periodEnd: string },
  stored: StoredTechnicalDataset,
): AnalysisFinding {
  const current = parseMilli(stored.evaluationConsumption ?? '') ?? 0;
  const rows = stored.historicalConsumption.map((row) => ({
    ...row,
    milli: parseMilli(row.consumption) ?? 0,
  }));
  const average = divideRound(
    rows.reduce((total, row) => total + row.milli, 0),
    rows.length,
  );
  const difference = current - average;
  const direction =
    difference > 0 ? 'mayor' : difference < 0 ? 'menor' : 'igual';
  return {
    findingType:
      difference > 0
        ? 'CONSUMPTION_INCREASE'
        : difference < 0
          ? 'CONSUMPTION_DECREASE'
          : 'CONSUMPTION_UNCHANGED',
    description: `El consumo del periodo es ${formatMilli(current)} kWh. El promedio de los meses históricos anteriores es ${formatMilli(average)} kWh. La diferencia es ${formatMilli(difference)} kWh (${formatMilli(percentageMilli(difference, average))} %). El consumo del periodo es ${direction} que ese promedio. Es una observación numérica y no confirma una anomalía técnica.`,
    measuredValue: formatMilli(current),
    referenceValue: formatMilli(average),
    difference: formatMilli(difference),
    percentage: formatMilli(percentageMilli(difference, average)),
    unit: 'kWh',
    interpretation: 'requires-interpretation',
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    evidence: [
      {
        label: 'Consumo del periodo de evaluación',
        value: formatMilli(current),
        unit: 'kWh',
        measuredAt: null,
        periodStart: request.periodStart,
        periodEnd: request.periodEnd,
      },
      ...rows.map((row) => ({
        label: 'Consumo histórico',
        value: formatMilli(row.milli),
        unit: 'kWh',
        measuredAt: null,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
      })),
    ],
  };
}

function snapshotOf(
  request: {
    type: PostSaleRequestType;
    periodStart: string;
    periodEnd: string;
  },
  stored: StoredTechnicalDataset,
): AnalysisInputSnapshot {
  return {
    requestType: request.type,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    demandThreshold: stored.demandThreshold,
    demandUnit: stored.demandUnit,
    evaluationConsumption: stored.evaluationConsumption,
    consumptionUnit: stored.consumptionUnit,
    telemetry: stored.telemetry,
    historicalConsumption: stored.historicalConsumption,
  };
}

function hasInvalidHistory(
  rows: readonly HistoricalConsumption[],
  periodStart: string,
): boolean {
  return rows.some(
    (row) =>
      !isDateOnly(row.periodStart) ||
      !isDateOnly(row.periodEnd) ||
      row.periodStart > row.periodEnd ||
      row.periodEnd >= periodStart,
  );
}

function hasTelemetryOutsidePeriod(
  readings: readonly TelemetryReading[],
  request: { periodStart: string; periodEnd: string },
): boolean {
  return readings.some(
    (reading) => !instantInPeriod(reading.measuredAt, request),
  );
}

function instantInPeriod(
  measuredAt: string,
  request: { periodStart: string; periodEnd: string },
): boolean {
  const measured = Date.parse(measuredAt);
  const start = Date.parse(`${request.periodStart}T00:00:00.000Z`);
  const end = Date.parse(`${request.periodEnd}T00:00:00.000Z`) + DAY_MS;
  return Number.isFinite(measured) && measured >= start && measured < end;
}

function isDateOnly(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseMilli(value: string): number | null {
  if (!QUANTITY.test(value)) {
    return null;
  }
  const [whole, fraction] = value.split('.');
  return Number(whole) * 1000 + Number(fraction);
}

function formatMilli(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute / 1000);
  const fraction = String(absolute % 1000).padStart(3, '0');
  return `${sign}${String(whole)}.${fraction}`;
}

function percentageMilli(difference: number, reference: number): number {
  return divideRound(difference * 100_000, reference);
}

function divideRound(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  const absolute = Math.abs(numerator);
  const quotient = Math.floor(absolute / denominator);
  const remainder = absolute % denominator;
  const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient;
  return sign * rounded;
}
