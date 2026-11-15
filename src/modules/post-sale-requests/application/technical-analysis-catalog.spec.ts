import { describe, expect, it } from '@jest/globals';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import type { PostSaleRequestService } from './post-sale-request.service.js';
import type { TechnicalDatasetRepository } from './technical-dataset.repository.js';
import type {
  TechnicalAnalysisRecord,
  TechnicalAnalysisRepository,
  VisibleTechnicalAnalysis,
} from './technical-analysis.repository.js';
import { TechnicalAnalysisService } from './technical-analysis.service.js';

const specialist: AuthenticatedUser = {
  userId: 'specialist-sub-catalog',
  roles: [UserRole.SPECIALIST],
};

const analysis: TechnicalAnalysisRecord = {
  id: 'analysis-1',
  requestId: 'request-1',
  status: 'SUCCEEDED',
  executedAt: new Date('2026-11-15T02:10:00.000Z'),
  executedBySub: 'should-not-leak',
  failureMessage: null,
  inputSnapshot: {
    requestType: 'VERIFICACION_DEMANDA',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-07',
    demandThreshold: '250.000',
    demandUnit: 'kW',
    evaluationConsumption: null,
    consumptionUnit: 'kWh',
    telemetry: [],
    historicalConsumption: [],
  },
  findings: [],
};

const visible: VisibleTechnicalAnalysis = {
  analysis,
  ticketCode: 'PV-A05-001',
  customerName: 'Textiles del Altiplano S.A.S.',
  facilityName: 'Planta Fontibón',
  requestType: 'VERIFICACION_DEMANDA',
};

function service() {
  const repository: TechnicalAnalysisRepository = {
    async insert(row) {
      return row;
    },
    async listByRequestId() {
      return [];
    },
    async listVisible(assignedSpecialistSub) {
      if (assignedSpecialistSub === null || assignedSpecialistSub === specialist.userId) {
        return [visible];
      }
      return [];
    },
  };
  return new TechnicalAnalysisService(
    {} as PostSaleRequestService,
    {} as TechnicalDatasetRepository,
    repository,
  );
}

describe('technical analysis catalog', () => {
  it('lists visible executions without the actor subject', async () => {
    const catalog = await service().catalog(specialist);
    expect(catalog).toEqual([
      {
        id: 'analysis-1',
        requestId: 'request-1',
        ticketCode: 'PV-A05-001',
        customerName: 'Textiles del Altiplano S.A.S.',
        facilityName: 'Planta Fontibón',
        requestType: 'VERIFICACION_DEMANDA',
        status: 'SUCCEEDED',
        executedAt: '2026-11-15T02:10:00.000Z',
        failureMessage: null,
        findings: [],
      },
    ]);
    expect(JSON.stringify(catalog)).not.toContain('should-not-leak');
    await expect(
      service().catalog({ userId: 'other-sub', roles: [UserRole.SPECIALIST] }),
    ).resolves.toEqual([]);
  });
});
