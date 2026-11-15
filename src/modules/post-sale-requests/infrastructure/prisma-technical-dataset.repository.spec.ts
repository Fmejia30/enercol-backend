import { jest } from '@jest/globals';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { PrismaTechnicalDatasetRepository } from './prisma-technical-dataset.repository.js';

describe('PrismaTechnicalDatasetRepository', () => {
  const findUnique = jest.fn<(args: unknown) => Promise<unknown>>();
  const prisma = {
    technicalDataset: { findUnique },
  } as unknown as PrismaService;
  const repository = new PrismaTechnicalDatasetRepository(prisma);

  beforeEach(() => {
    findUnique.mockReset();
  });

  it('loads the dataset of a request ordered by measurement and history', async () => {
    findUnique.mockResolvedValue({
      demandThreshold: decimal('250.000'),
      demandUnit: 'kW',
      evaluationConsumption: null,
      consumptionUnit: 'kWh',
      sourceName: 'Conjunto técnico controlado Act-05',
      sourceKind: 'local-controlled-dataset',
      telemetryReadings: [
        {
          measuredAt: new Date('2026-09-03T15:30:00.000Z'),
          measuredDemand: decimal('267.250'),
        },
      ],
      historicalConsumption: [
        {
          periodStart: new Date('2026-08-01T00:00:00.000Z'),
          periodEnd: new Date('2026-08-31T00:00:00.000Z'),
          consumption: decimal('148750.500'),
        },
      ],
    });

    const dataset = await repository.findByRequestId(
      '6f1c2a10-4b7e-4a1d-9c31-a05000000001',
    );

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        postSaleRequestId: '6f1c2a10-4b7e-4a1d-9c31-a05000000001',
      },
      include: {
        telemetryReadings: { orderBy: { measuredAt: 'asc' } },
        historicalConsumption: { orderBy: { periodStart: 'asc' } },
      },
    });
    expect(dataset).toMatchObject({
      demandThreshold: '250.000',
      demandUnit: 'kW',
      evaluationConsumption: null,
      consumptionUnit: 'kWh',
      sourceKind: 'local-controlled-dataset',
      telemetry: [
        {
          measuredAt: '2026-09-03T15:30:00.000Z',
          measuredDemand: '267.250',
        },
      ],
      historicalConsumption: [
        {
          periodStart: '2026-08-01',
          periodEnd: '2026-08-31',
          consumption: '148750.500',
        },
      ],
    });
  });

  it('reads current-period consumption without a demand threshold', async () => {
    findUnique.mockResolvedValue({
      demandThreshold: null,
      demandUnit: 'kW',
      evaluationConsumption: decimal('124800.000'),
      consumptionUnit: 'kWh',
      sourceName: 'Conjunto técnico controlado Act-05',
      sourceKind: 'local-controlled-dataset',
      telemetryReadings: [],
      historicalConsumption: [
        {
          periodStart: new Date('2026-08-01T00:00:00.000Z'),
          periodEnd: new Date('2026-08-31T00:00:00.000Z'),
          consumption: decimal('99500.750'),
        },
      ],
    });

    const dataset = await repository.findByRequestId(
      '6f1c2a10-4b7e-4a1d-9c31-a05000000002',
    );

    expect(dataset).toMatchObject({
      demandThreshold: null,
      evaluationConsumption: '124800.000',
      consumptionUnit: 'kWh',
      telemetry: [],
      historicalConsumption: [
        {
          periodStart: '2026-08-01',
          periodEnd: '2026-08-31',
          consumption: '99500.750',
        },
      ],
    });
  });
});

function decimal(value: string) {
  return { toFixed: () => value };
}
