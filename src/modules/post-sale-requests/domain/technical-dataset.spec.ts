import { describe, expect, it } from '@jest/globals';
import {
  historyBeforePeriod,
  presentTechnicalDataset,
  telemetryDuringPeriod,
} from './technical-dataset.js';

const stored = {
  demandThreshold: '250.000',
  demandUnit: 'kW',
  evaluationConsumption: null,
  consumptionUnit: 'kWh',
  sourceName: 'Conjunto técnico controlado Act-05',
  sourceKind: 'local-controlled-dataset',
  telemetry: [
    { measuredAt: '2026-08-31T23:00:00.000Z', measuredDemand: '300.000' },
    { measuredAt: '2026-09-03T15:30:00.000Z', measuredDemand: '267.250' },
    { measuredAt: '2026-09-08T00:00:00.000Z', measuredDemand: '100.000' },
  ],
  historicalConsumption: [
    {
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      consumption: '148750.500',
    },
    {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      consumption: '150000.000',
    },
    {
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      consumption: '90000.000',
    },
  ],
};

describe('technical dataset period', () => {
  it('keeps telemetry inside the period and history that ends before it', () => {
    expect(
      telemetryDuringPeriod(stored.telemetry, '2026-09-01', '2026-09-07').map(
        (reading) => reading.measuredDemand,
      ),
    ).toEqual(['267.250']);
    expect(
      historyBeforePeriod(stored.historicalConsumption, '2026-09-01').map(
        (row) => row.periodStart,
      ),
    ).toEqual(['2026-08-01']);
  });

  it('returns the dataset of a request without readings outside its period', () => {
    const dataset = presentTechnicalDataset(
      {
        id: '6f1c2a10-4b7e-4a1d-9c31-a05000000001',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-07',
      },
      stored,
    );

    expect(dataset.requestId).toBe('6f1c2a10-4b7e-4a1d-9c31-a05000000001');
    expect(dataset.demandThreshold).toBe('250.000');
    expect(dataset.evaluationConsumption).toBeNull();
    expect(dataset.demandUnit).toBe('kW');
    expect(dataset.telemetry).toEqual([
      { measuredAt: '2026-09-03T15:30:00.000Z', measuredDemand: '267.250' },
    ]);
    expect(dataset.historicalConsumption).toEqual([
      {
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        consumption: '148750.500',
      },
    ]);
  });
});
