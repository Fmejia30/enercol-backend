import { describe, expect, it } from '@jest/globals';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { PostSaleRequestService } from './post-sale-request.service.js';
import { TechnicalAnalysisService } from './technical-analysis.service.js';
import type { TechnicalAnalysisRecord } from './technical-analysis.repository.js';
import {
  PostSaleRequestForbiddenError,
  PostSaleRequestNotFoundError,
  TechnicalDatasetNotFoundError,
} from '../domain/post-sale-request-error.js';
import { createPostSaleRequest } from '../domain/post-sale-request.js';
import { nextRequestStatus } from '../domain/request-activity.js';
import type { StoredTechnicalDataset } from '../domain/technical-dataset.js';

const NORTE = 'specialist-norte';
const REQUEST_ID = '6f1c2a10-4b7e-4a1d-9c31-a05000000001';

const dataset: StoredTechnicalDataset = {
  demandThreshold: '250.000',
  demandUnit: 'kW',
  evaluationConsumption: null,
  consumptionUnit: 'kWh',
  sourceName: 'Conjunto técnico controlado Act-05',
  sourceKind: 'local-controlled-dataset',
  telemetry: [
    { measuredAt: '2026-09-03T15:30:00.000Z', measuredDemand: '267.250' },
  ],
  historicalConsumption: [],
};

describe('technical analysis execution', () => {
  const requests = new Map([
    [
      REQUEST_ID,
      createPostSaleRequest({
        id: REQUEST_ID,
        ticketCode: 'PV-A05-001',
        customerId: 'CLI-A05-001',
        customerName: 'Textiles del Altiplano S.A.S.',
        facilityName: 'Planta Fontibón',
        assignedSpecialistSub: NORTE,
        type: 'VERIFICACION_DEMANDA',
        description: 'Caso controlado.',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-07',
        status: 'ABIERTA',
        createdAt: new Date('2026-09-08T12:00:00.000Z'),
      }),
    ],
  ]);
  const stored = new Map<string, StoredTechnicalDataset>([
    [REQUEST_ID, dataset],
  ]);
  const saved: TechnicalAnalysisRecord[] = [];
  const datasetReads = { count: 0 };
  const requestService = new PostSaleRequestService(
    {
      list: () => Promise.reject(new Error('unused')),
      findById: (id) => Promise.resolve(requests.get(id) ?? null),
      allocateTicketCode: () => Promise.reject(new Error('unused')),
      insert: () => Promise.reject(new Error('unused')),
      appendActivity: (activity) => {
        const current = requests.get(activity.requestId);
        if (!current) return Promise.resolve();
        requests.set(activity.requestId, {
          ...current,
          status: nextRequestStatus(current.status, activity.eventType),
        });
        return Promise.resolve();
      },
      listActivity: () => Promise.resolve([]),
    },
    { findByRequestId: (id) => Promise.resolve(stored.get(id) ?? null) },
    { findProfiles: () => Promise.resolve([]) },
  );
  const analyses = {
    insert: (analysis: TechnicalAnalysisRecord) => {
      saved.push(analysis);
      return Promise.resolve(analysis);
    },
    listByRequestId: (requestId: string) =>
      Promise.resolve(
        saved
          .filter((analysis) => analysis.requestId === requestId)
          .sort(
            (left, right) =>
              right.executedAt.getTime() - left.executedAt.getTime(),
          ),
      ),
  };
  const service = new TechnicalAnalysisService(
    requestService,
    {
      findByRequestId: (id) => {
        datasetReads.count += 1;
        return Promise.resolve(stored.get(id) ?? null);
      },
    },
    analyses,
  );

  it('persists each execution and keeps the previous result', async () => {
    const first = await service.execute(
      actor(NORTE, UserRole.SPECIALIST),
      REQUEST_ID,
    );
    const second = await service.execute(
      actor(NORTE, UserRole.SPECIALIST),
      REQUEST_ID,
    );

    expect(first.id).not.toBe(second.id);
    expect(first.status).toBe('SUCCEEDED');
    expect(first.findings[0]?.measuredValue).toBe('267.250');
    expect(first.executedAt.toISOString()).toMatch(/Z$/);
    expect(second.executedBySub).toBe(NORTE);
    const history = await service.list(
      actor(NORTE, UserRole.SPECIALIST),
      REQUEST_ID,
    );
    expect(history.map((analysis) => analysis.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(history[0]?.executedAt.getTime()).toBeGreaterThanOrEqual(
      history[1]?.executedAt.getTime() ?? 0,
    );
  });

  it('does not analyze a hidden request, a request without data, or a validator execution', async () => {
    const readsBefore = datasetReads.count;
    const savedBefore = saved.length;
    await expect(
      service.execute(
        actor('other-specialist', UserRole.SPECIALIST),
        REQUEST_ID,
      ),
    ).rejects.toBeInstanceOf(PostSaleRequestNotFoundError);
    stored.delete(REQUEST_ID);
    await expect(
      service.execute(actor(NORTE, UserRole.SPECIALIST), REQUEST_ID),
    ).rejects.toBeInstanceOf(TechnicalDatasetNotFoundError);
    stored.set(REQUEST_ID, dataset);
    await expect(
      service.execute(actor(NORTE, UserRole.VALIDATOR), REQUEST_ID),
    ).rejects.toBeInstanceOf(PostSaleRequestForbiddenError);
    expect(saved).toHaveLength(savedBefore);
    expect(datasetReads.count - readsBefore).toBe(1);
  });
});

function actor(userId: string, role: UserRole): AuthenticatedUser {
  return { userId, roles: [role] };
}
