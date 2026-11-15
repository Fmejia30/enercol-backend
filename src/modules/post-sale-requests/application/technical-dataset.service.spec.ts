import { describe, expect, it } from '@jest/globals';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import {
  PostSaleRequestNotFoundError,
  TechnicalDatasetNotFoundError,
} from '../domain/post-sale-request-error.js';
import { createPostSaleRequest } from '../domain/post-sale-request.js';
import type { StoredTechnicalDataset } from '../domain/technical-dataset.js';
import type { PostSaleRequestRepository } from './post-sale-request.repository.js';
import { PostSaleRequestService } from './post-sale-request.service.js';
import type { TechnicalDatasetRepository } from './technical-dataset.repository.js';

const NORTE = 'specialist-norte';
const SUR = 'specialist-sur';
const NORTE_ID = '6f1c2a10-4b7e-4a1d-9c31-a05000000001';
const SUR_ID = '6f1c2a10-4b7e-4a1d-9c31-a05000000002';

const dataset: StoredTechnicalDataset = {
  demandThreshold: '250.000',
  demandUnit: 'kW',
  evaluationConsumption: null,
  consumptionUnit: 'kWh',
  sourceName: 'Conjunto técnico controlado Act-05',
  sourceKind: 'local-controlled-dataset',
  telemetry: [
    { measuredAt: '2026-08-31T23:00:00.000Z', measuredDemand: '300.000' },
    { measuredAt: '2026-09-03T15:30:00.000Z', measuredDemand: '267.250' },
  ],
  historicalConsumption: [
    {
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      consumption: '148750.500',
    },
    {
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      consumption: '90000.000',
    },
  ],
};

describe('technical dataset access', () => {
  const requests = new Map([
    [NORTE_ID, caseRequest(NORTE_ID, NORTE)],
    [SUR_ID, caseRequest(SUR_ID, SUR)],
  ]);
  const datasets = new Map<string, StoredTechnicalDataset>([
    [NORTE_ID, dataset],
  ]);
  const requestRepository: PostSaleRequestRepository = {
    list: () => Promise.reject(new Error('unused')),
    findById: (id) => Promise.resolve(requests.get(id) ?? null),
    allocateTicketCode: () => Promise.reject(new Error('unused')),
    insert: () => Promise.reject(new Error('unused')),
    appendActivity: () => Promise.resolve(),
    listActivity: () => Promise.resolve([]),
  };
  const technicalData: TechnicalDatasetRepository = {
    findByRequestId: (id) => Promise.resolve(datasets.get(id) ?? null),
  };
  const service = new PostSaleRequestService(requestRepository, technicalData, {
    findProfiles: () => Promise.resolve([]),
  });

  it('returns the assigned dataset for its evaluation period', async () => {
    const result = await service.getTechnicalDataset(
      actor(NORTE, UserRole.SPECIALIST),
      NORTE_ID,
    );

    expect(result.periodStart).toBe('2026-09-01');
    expect(result.periodEnd).toBe('2026-09-07');
    expect(result.demandThreshold).toBe('250.000');
    expect(result.evaluationConsumption).toBeNull();
    expect(result.demandUnit).toBe('kW');
    expect(result.telemetry).toEqual([
      { measuredAt: '2026-09-03T15:30:00.000Z', measuredDemand: '267.250' },
    ]);
    expect(result.historicalConsumption.map((row) => row.periodStart)).toEqual([
      '2026-08-01',
    ]);
  });

  it('hides another specialist dataset and a case without technical data', async () => {
    await expect(
      service.getTechnicalDataset(actor(NORTE, UserRole.SPECIALIST), SUR_ID),
    ).rejects.toBeInstanceOf(PostSaleRequestNotFoundError);
    await expect(
      service.getTechnicalDataset(actor(SUR, UserRole.SPECIALIST), NORTE_ID),
    ).rejects.toBeInstanceOf(PostSaleRequestNotFoundError);
    datasets.set(SUR_ID, dataset);
    await expect(
      service.getTechnicalDataset(
        actor('admin-sub', UserRole.ADMINISTRATOR),
        SUR_ID,
      ),
    ).resolves.toMatchObject({ requestId: SUR_ID });
    datasets.delete(SUR_ID);
    await expect(
      service.getTechnicalDataset(
        actor('admin-sub', UserRole.ADMINISTRATOR),
        SUR_ID,
      ),
    ).rejects.toBeInstanceOf(TechnicalDatasetNotFoundError);
  });
});

function actor(userId: string, role: UserRole): AuthenticatedUser {
  return { userId, roles: [role] };
}

function caseRequest(id: string, assignedSpecialistSub: string) {
  return createPostSaleRequest({
    id,
    ticketCode: id,
    customerId: 'CLI-A05-001',
    customerName: 'Textiles del Altiplano S.A.S.',
    facilityName: 'Planta Fontibón',
    assignedSpecialistSub,
    type: 'VERIFICACION_DEMANDA',
    description: 'Caso controlado.',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-07',
    status: 'ABIERTA',
    createdAt: new Date('2026-09-08T12:00:00.000Z'),
  });
}
