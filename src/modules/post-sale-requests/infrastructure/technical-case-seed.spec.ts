import { describe, expect, it } from '@jest/globals';
import { historyBeforePeriod } from '../domain/technical-dataset.js';
import {
  applyTechnicalTestCases,
  assertSeedTarget,
  readSeedSpecialistSub,
  technicalTestCases,
  type TechnicalSeedHistory,
  type TechnicalSeedReading,
  type TechnicalSeedRequest,
  type TechnicalSeedStore,
  type TechnicalSeedDataset,
} from './technical-case-seed.js';

const SPECIALIST = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('technical case seed', () => {
  it('requires the existing specialist subject and does not echo an invalid value', () => {
    expect(() => readSeedSpecialistSub({})).toThrow(/SEED_SPECIALIST_SUB/);
    expect(() =>
      readSeedSpecialistSub({ SEED_SPECIALIST_SUB: 'not-a-subject' }),
    ).toThrow(/SEED_SPECIALIST_SUB/);
    try {
      readSeedSpecialistSub({ SEED_SPECIALIST_SUB: 'not-a-subject' });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('not-a-subject');
    }
    expect(readSeedSpecialistSub({ SEED_SPECIALIST_SUB: SPECIALIST })).toBe(
      SPECIALIST,
    );
  });

  it('allows the local database and the configured demonstration host, including production mode', () => {
    expect(() =>
      assertSeedTarget({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/enercol',
      }),
    ).not.toThrow();
    expect(() =>
      assertSeedTarget({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:secret@demo.internal:5432/enercol',
        SEED_DATABASE_HOST: 'demo.internal',
      }),
    ).not.toThrow();
    expect(() =>
      assertSeedTarget({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1:5432/enercol',
      }),
    ).not.toThrow();
  });

  it('refuses an unrelated database without revealing the connection string', () => {
    expect(() =>
      assertSeedTarget({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://postgres:secret@db.example:5432/enercol',
        SEED_DATABASE_HOST: 'demo.internal',
      }),
    ).toThrow(/SEED_DATABASE_HOST/);
    try {
      assertSeedTarget({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://postgres:secret@db.example:5432/enercol',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('secret');
      expect((error as Error).message).not.toContain('db.example');
    }
  });

  it('assigns both cases to the supplied specialist and replaces them on a second run', async () => {
    const store = memoryStore();
    await applyTechnicalTestCases(store, SPECIALIST);
    await applyTechnicalTestCases(store, OTHER);

    expect(store.requests.size).toBe(2);
    expect(store.datasets.size).toBe(2);
    expect(store.telemetry.size).toBe(4);
    expect(store.history.size).toBe(5);
    expect(
      [...store.requests.values()].map((row) => row.assignedSpecialistSub),
    ).toEqual([OTHER, OTHER]);
    expect([...store.requests.values()].map((row) => row.ticketCode)).toEqual([
      'PV-A05-001',
      'PV-A05-002',
    ]);
    expect(technicalTestCases(SPECIALIST)[0]?.dataset.demandUnit).toBe('kW');
    expect(technicalTestCases(SPECIALIST)[0]?.dataset.consumptionUnit).toBe(
      'kWh',
    );
    expect(technicalTestCases(SPECIALIST)[0]?.dataset.sourceKind).toBe(
      'local-controlled-dataset',
    );
  });

  it('keeps demand exceedance and consumption periods in the same unit', () => {
    const [demand, consumption] = technicalTestCases(SPECIALIST);
    if (!demand || !consumption) {
      throw new Error('expected two demonstration cases');
    }

    expect(demand.request).toMatchObject({
      id: '6f1c2a10-4b7e-4a1d-9c31-a05000000001',
      ticketCode: 'PV-A05-001',
      type: 'VERIFICACION_DEMANDA',
    });
    expect(demand.dataset).toMatchObject({
      id: '6f1c2a10-4b7e-4a1d-9c31-a05000000011',
      demandThreshold: '250.000',
      demandUnit: 'kW',
      evaluationConsumption: null,
    });
    expect(demand.telemetry.map((reading) => reading.measuredDemand)).toEqual([
      '210.000',
      '248.500',
      '267.250',
      '241.000',
    ]);
    expect(
      demand.telemetry.filter(
        (reading) =>
          Number(reading.measuredDemand) >
          Number(demand.dataset.demandThreshold),
      ),
    ).toEqual([
      expect.objectContaining({
        measuredAt: new Date('2026-09-03T15:30:00.000Z'),
        measuredDemand: '267.250',
      }),
    ]);
    expect(priorMonths(demand)).toEqual(demand.historicalConsumption);

    expect(consumption.request).toMatchObject({
      id: '6f1c2a10-4b7e-4a1d-9c31-a05000000002',
      ticketCode: 'PV-A05-002',
      type: 'CONSUMO_ATIPICO',
    });
    expect(consumption.dataset).toMatchObject({
      id: '6f1c2a10-4b7e-4a1d-9c31-a05000000012',
      demandThreshold: null,
      evaluationConsumption: '124800.000',
      consumptionUnit: 'kWh',
    });
    expect(consumption.telemetry).toEqual([]);
    expect(
      consumption.historicalConsumption.map((row) => row.consumption),
    ).toEqual(['98000.000', '101250.000', '99500.750']);
    expect(
      consumption.historicalConsumption.every(
        (row) =>
          Number(row.consumption) <
          Number(consumption.dataset.evaluationConsumption),
      ),
    ).toBe(true);
    expect(priorMonths(consumption)).toEqual(consumption.historicalConsumption);
  });
});

function priorMonths(testCase: {
  request: TechnicalSeedRequest;
  historicalConsumption: readonly TechnicalSeedHistory[];
}): TechnicalSeedHistory[] {
  const periodStart = testCase.request.periodStart.toISOString().slice(0, 10);
  const rows = testCase.historicalConsumption.map((row) => ({
    periodStart: row.periodStart.toISOString().slice(0, 10),
    periodEnd: row.periodEnd.toISOString().slice(0, 10),
    consumption: row.consumption,
  }));
  const included = new Set(
    historyBeforePeriod(rows, periodStart).map((row) => row.periodStart),
  );
  return testCase.historicalConsumption.filter((row) =>
    included.has(row.periodStart.toISOString().slice(0, 10)),
  );
}

function memoryStore(): TechnicalSeedStore & {
  requests: Map<string, TechnicalSeedRequest>;
  datasets: Map<string, TechnicalSeedDataset>;
  telemetry: Map<string, TechnicalSeedReading>;
  history: Map<string, TechnicalSeedHistory>;
} {
  const requests = new Map<string, TechnicalSeedRequest>();
  const datasets = new Map<string, TechnicalSeedDataset>();
  const telemetry = new Map<string, TechnicalSeedReading>();
  const history = new Map<string, TechnicalSeedHistory>();
  return {
    requests,
    datasets,
    telemetry,
    history,
    postSaleRequest: {
      upsert: ({ where, create, update }) => {
        requests.set(
          where.id,
          requests.has(where.id) ? { ...update, id: where.id } : create,
        );
        return Promise.resolve(undefined);
      },
    },
    technicalDataset: {
      upsert: ({ where, create, update }) => {
        datasets.set(
          where.id,
          datasets.has(where.id) ? { ...update, id: where.id } : create,
        );
        return Promise.resolve(undefined);
      },
    },
    telemetryReading: {
      deleteMany: ({ where }) => {
        for (const [id, row] of telemetry) {
          if (row.datasetId === where.datasetId) telemetry.delete(id);
        }
        return Promise.resolve(undefined);
      },
      createMany: ({ data }) => {
        for (const row of data) telemetry.set(row.id, row);
        return Promise.resolve(undefined);
      },
    },
    historicalConsumption: {
      deleteMany: ({ where }) => {
        for (const [id, row] of history) {
          if (row.datasetId === where.datasetId) history.delete(id);
        }
        return Promise.resolve(undefined);
      },
      createMany: ({ data }) => {
        for (const row of data) history.set(row.id, row);
        return Promise.resolve(undefined);
      },
    },
  };
}
