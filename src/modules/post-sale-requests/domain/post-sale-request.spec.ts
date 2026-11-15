import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import {
  InvalidEvaluationPeriodError,
  createPostSaleRequest,
  isRequestVisible,
  requestVisibility,
  type PostSaleRequestDraft,
} from './post-sale-request.js';

const createdAt = new Date('2026-10-02T15:00:00.000Z');

function draft(
  overrides: Partial<PostSaleRequestDraft> = {},
): PostSaleRequestDraft {
  return {
    id: '6f1c2a10-4b7e-4a1d-9c31-000000000001',
    ticketCode: 'PV-24018',
    customerId: 'CLI-10421',
    customerName: 'Textiles del Altiplano S.A.S.',
    facilityName: 'Planta Fontibón',
    assetId: 'MED-FTB-014',
    assignedSpecialistSub: 'demo-specialist-norte',
    type: 'VERIFICACION_DEMANDA',
    description: 'Revisión del periodo.',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status: 'ABIERTA',
    createdAt,
    ...overrides,
  };
}

describe('post-sale request period', () => {
  it('accepts a period that starts and ends on the same day', () => {
    const request = createPostSaleRequest(
      draft({ periodStart: '2026-09-15', periodEnd: '2026-09-15' }),
    );
    expect(request.periodStart).toBe('2026-09-15');
    expect(request.periodEnd).toBe('2026-09-15');
  });

  it('rejects a start later than the end', () => {
    expect(() =>
      createPostSaleRequest(
        draft({ periodStart: '2026-10-02', periodEnd: '2026-10-01' }),
      ),
    ).toThrow(InvalidEvaluationPeriodError);
  });

  it('rejects a calendar date that does not exist', () => {
    expect(() =>
      createPostSaleRequest(draft({ periodEnd: '2026-02-31' })),
    ).toThrow(InvalidEvaluationPeriodError);
    expect(() =>
      createPostSaleRequest(draft({ periodStart: '2026/09/01' })),
    ).toThrow(InvalidEvaluationPeriodError);
  });

  it('stores a blank specialist as unassigned', () => {
    const request = createPostSaleRequest(
      draft({ assignedSpecialistSub: '   ' }),
    );
    expect(request.assignedSpecialistSub).toBeNull();
  });

  it('stores an empty asset as absent and keeps the creation instant in UTC', () => {
    const request = createPostSaleRequest(draft({ assetId: '  ' }));
    expect(request.assetId).toBeNull();
    expect(request.createdAt.toISOString()).toBe('2026-10-02T15:00:00.000Z');
  });
});

describe('post-sale request visibility', () => {
  const request = createPostSaleRequest(draft());
  const specialist: AuthenticatedUser = {
    userId: 'demo-specialist-norte',
    roles: [UserRole.SPECIALIST],
  };
  const other: AuthenticatedUser = {
    userId: 'demo-specialist-sur',
    roles: [UserRole.SPECIALIST],
  };
  const administrator: AuthenticatedUser = {
    userId: 'demo-admin',
    roles: [UserRole.ADMINISTRATOR, UserRole.SPECIALIST],
  };

  it('limits a specialist or validator to their own subject and lets an administrator see every request', () => {
    expect(isRequestVisible(requestVisibility(specialist), request)).toBe(true);
    expect(isRequestVisible(requestVisibility(other), request)).toBe(false);
    expect(requestVisibility(administrator)).toEqual({ kind: 'all' });
    expect(isRequestVisible(requestVisibility(administrator), request)).toBe(
      true,
    );
  });

  it('hides a request that has no assigned specialist from a specialist', () => {
    const unassigned = createPostSaleRequest(
      draft({ assignedSpecialistSub: null }),
    );
    expect(unassigned.assignedSpecialistSub).toBeNull();
    expect(isRequestVisible(requestVisibility(specialist), unassigned)).toBe(
      false,
    );
    expect(isRequestVisible(requestVisibility(administrator), unassigned)).toBe(
      true,
    );
  });
});
