import { describe, expect, it } from '@jest/globals';
import { analyzeTechnicalDataset } from './technical-analysis.js';
import type { StoredTechnicalDataset } from './technical-dataset.js';

const demandDataset: StoredTechnicalDataset = {
  demandThreshold: '250.000',
  demandUnit: 'kW',
  evaluationConsumption: null,
  consumptionUnit: 'kWh',
  sourceName: 'Conjunto técnico controlado Act-05',
  sourceKind: 'local-controlled-dataset',
  telemetry: [
    { measuredAt: '2026-09-03T15:00:00.000Z', measuredDemand: '210.000' },
    { measuredAt: '2026-09-03T15:15:00.000Z', measuredDemand: '248.500' },
    { measuredAt: '2026-09-03T15:30:00.000Z', measuredDemand: '267.250' },
    { measuredAt: '2026-09-03T15:45:00.000Z', measuredDemand: '241.000' },
  ],
  historicalConsumption: [
    {
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      consumption: '142300.000',
    },
    {
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      consumption: '148750.500',
    },
  ],
};

const consumptionDataset: StoredTechnicalDataset = {
  demandThreshold: null,
  demandUnit: 'kW',
  evaluationConsumption: '124800.000',
  consumptionUnit: 'kWh',
  sourceName: 'Conjunto técnico controlado Act-05',
  sourceKind: 'local-controlled-dataset',
  telemetry: [],
  historicalConsumption: [
    {
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      consumption: '98000.000',
    },
    {
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      consumption: '101250.000',
    },
    {
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      consumption: '99500.750',
    },
  ],
};

describe('deterministic technical analysis', () => {
  it('identifies the contractual demand exceedance from the stored readings', () => {
    const outcome = analyzeTechnicalDataset(
      {
        type: 'VERIFICACION_DEMANDA',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-07',
      },
      demandDataset,
    );

    expect(outcome.status).toBe('SUCCEEDED');
    expect(outcome.findings).toEqual([
      expect.objectContaining({
        findingType: 'DEMAND_EXCEEDANCE',
        measuredValue: '267.250',
        referenceValue: '250.000',
        difference: '17.250',
        percentage: '6.900',
        unit: 'kW',
        interpretation: 'confirmed-observation',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-07',
      }),
    ]);
    expect(outcome.findings[0]?.evidence).toEqual([
      {
        label: 'Lectura de demanda',
        value: '267.250',
        unit: 'kW',
        measuredAt: '2026-09-03T15:30:00.000Z',
        periodStart: null,
        periodEnd: null,
      },
    ]);
    expect(outcome.inputSnapshot.telemetry).toHaveLength(4);
  });

  it('quantifies the consumption increase without treating it as a confirmed anomaly', () => {
    const outcome = analyzeTechnicalDataset(
      {
        type: 'CONSUMO_ATIPICO',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
      },
      consumptionDataset,
    );
    const finding = outcome.findings[0];

    expect(outcome.status).toBe('SUCCEEDED');
    expect(finding).toMatchObject({
      findingType: 'CONSUMPTION_INCREASE',
      measuredValue: '124800.000',
      referenceValue: '99583.583',
      difference: '25216.417',
      percentage: '25.322',
      unit: 'kWh',
      interpretation: 'requires-interpretation',
    });
    expect(finding?.description).toContain('no confirma una anomalía técnica');
    expect(finding?.evidence.map((item) => item.value)).toEqual([
      '124800.000',
      '98000.000',
      '101250.000',
      '99500.750',
    ]);
  });

  it('rejects inconsistent units, missing values, and periods that do not match the evaluation window', () => {
    expect(
      analyzeTechnicalDataset(
        {
          type: 'VERIFICACION_DEMANDA',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-07',
        },
        { ...demandDataset, demandUnit: 'MW' },
      ),
    ).toMatchObject({
      status: 'FAILED',
      failureMessage: 'La unidad de demanda debe ser kW.',
      findings: [],
    });
    expect(
      analyzeTechnicalDataset(
        {
          type: 'VERIFICACION_DEMANDA',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-07',
        },
        { ...demandDataset, demandThreshold: null, telemetry: [] },
      ).failureMessage,
    ).toBe('El caso de demanda no tiene umbral contractual.');
    expect(
      analyzeTechnicalDataset(
        {
          type: 'VERIFICACION_DEMANDA',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-07',
        },
        { ...demandDataset, telemetry: [] },
      ).failureMessage,
    ).toBe('No hay lecturas de demanda dentro del periodo de evaluación.');
    expect(
      analyzeTechnicalDataset(
        {
          type: 'VERIFICACION_DEMANDA',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-07',
        },
        {
          ...demandDataset,
          telemetry: [
            {
              measuredAt: '2026-08-31T23:00:00.000Z',
              measuredDemand: '300.000',
            },
          ],
        },
      ).failureMessage,
    ).toBe('Hay lecturas de telemetría fuera del periodo de evaluación.');
    expect(
      analyzeTechnicalDataset(
        {
          type: 'CONSUMO_ATIPICO',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
        },
        { ...consumptionDataset, evaluationConsumption: null },
      ).failureMessage,
    ).toBe('El caso de consumo no tiene el consumo del periodo de evaluación.');
    expect(
      analyzeTechnicalDataset(
        {
          type: 'CONSUMO_ATIPICO',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
        },
        { ...consumptionDataset, historicalConsumption: [] },
      ).failureMessage,
    ).toBe(
      'El caso de consumo no tiene meses históricos anteriores al periodo.',
    );
    expect(
      analyzeTechnicalDataset(
        {
          type: 'CONSUMO_ATIPICO',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
        },
        {
          ...consumptionDataset,
          historicalConsumption: [
            {
              periodStart: '2026-09-01',
              periodEnd: '2026-09-30',
              consumption: '98000.000',
            },
          ],
        },
      ).failureMessage,
    ).toBe(
      'Hay consumos históricos que no terminan antes del periodo de evaluación.',
    );
    expect(
      analyzeTechnicalDataset(
        {
          type: 'CALIDAD_DE_POTENCIA',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
        },
        consumptionDataset,
      ).failureMessage,
    ).toBe(
      'Este tipo de solicitud no tiene un análisis determinista en esta versión.',
    );
  });
});
