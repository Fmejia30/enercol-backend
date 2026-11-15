import { jest } from '@jest/globals';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { PostSaleRequestService } from '../application/post-sale-request.service.js';
import {
  PostSaleRequestConflictError,
  PostSaleRequestForbiddenError,
  PostSaleRequestNotFoundError,
  PostSaleRequestPersistenceError,
  PostSaleRequestQueryError,
} from '../domain/post-sale-request-error.js';
import {
  InvalidEvaluationPeriodError,
  InvalidPostSaleRequestError,
  createPostSaleRequest,
  type PostSaleRequest,
  type PostSaleRequestType,
} from '../domain/post-sale-request.js';
import type {
  ListPostSaleRequestsCriteria,
  PostSaleRequestPage,
  PostSaleRequestRepository,
} from './post-sale-request.repository.js';

const NORTE = 'specialist-norte';
const SUR = 'specialist-sur';

function actor(userId: string, ...roles: UserRole[]): AuthenticatedUser {
  return { userId, roles };
}

function request(id: string, assignedSpecialistSub: string): PostSaleRequest {
  return createPostSaleRequest({
    id,
    ticketCode: id,
    customerId: 'CLI-10421',
    customerName: 'Textiles del Altiplano S.A.S.',
    facilityName: 'Planta Fontibón',
    assignedSpecialistSub,
    type: 'VERIFICACION_DEMANDA',
    description: 'Revisión de demanda.',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status: 'ABIERTA',
    createdAt: new Date('2026-10-02T15:00:00.000Z'),
  });
}

class RecordingRepository implements PostSaleRequestRepository {
  readonly criteria: ListPostSaleRequestsCriteria[] = [];

  constructor(private readonly requests: readonly PostSaleRequest[]) {}

  list(criteria: ListPostSaleRequestsCriteria): Promise<PostSaleRequestPage> {
    this.criteria.push(criteria);
    return Promise.resolve({
      items: this.requests,
      page: criteria.page,
      pageSize: criteria.pageSize,
      total: this.requests.length,
    });
  }

  findById(id: string): Promise<PostSaleRequest | null> {
    return Promise.resolve(
      this.requests.find((item) => item.id === id) ?? null,
    );
  }

  allocateTicketCode(): Promise<string> {
    return Promise.resolve('PV-000001');
  }

  insert(request: PostSaleRequest): Promise<PostSaleRequest> {
    return Promise.resolve(request);
  }

  appendActivity(): Promise<void> {
    return Promise.resolve();
  }

  listActivity(): Promise<readonly []> {
    return Promise.resolve([]);
  }
}

const emptyTechnicalData = {
  findByRequestId: () => Promise.resolve(null),
};

const emptyProfiles = {
  findProfiles: () => Promise.resolve([]),
};

describe('PostSaleRequestService', () => {
  const norteRequest = request('6f1c2a10-4b7e-4a1d-9c31-000000000001', NORTE);
  const surRequest = request('6f1c2a10-4b7e-4a1d-9c31-000000000003', SUR);
  const repository = new RecordingRepository([norteRequest, surRequest]);
  const profiles = {
    findProfiles: jest.fn(async () => [
      {
        cognitoSub: NORTE,
        firstName: 'Carlos',
        lastName: 'Méndez',
        phoneNumber: '3000000000',
      },
    ]),
  };
  const service = new PostSaleRequestService(
    repository,
    emptyTechnicalData,
    profiles,
  );
  const norte = actor(NORTE, UserRole.SPECIALIST);
  const validator = actor('validator-sub', UserRole.VALIDATOR);
  const administrator = actor('admin-sub', UserRole.ADMINISTRATOR);

  it('passes assignment visibility for a specialist and a validator', async () => {
    await service.list(norte, { status: 'ABIERTA', search: 'Fontibón' });
    await service.list(validator, {});

    expect(repository.criteria[0]).toEqual({
      visibility: { kind: 'assigned', specialistSub: NORTE },
      status: 'ABIERTA',
      search: 'Fontibón',
      page: 1,
      pageSize: 20,
    });
    expect(repository.criteria[1]).toEqual({
      visibility: { kind: 'assigned', specialistSub: 'validator-sub' },
      page: 1,
      pageSize: 20,
    });
  });

  it('passes unrestricted visibility when the caller is an administrator', async () => {
    const page = await service.list(
      actor('admin-sub', UserRole.ADMINISTRATOR, UserRole.SPECIALIST),
      { page: 2, pageSize: 3 },
    );

    expect(repository.criteria.at(-1)?.visibility).toEqual({ kind: 'all' });
    expect(page).toMatchObject({ page: 2, pageSize: 3, total: 2 });
  });

  it('returns an assigned request and hides another assignment the same way as a missing one', async () => {
    await expect(service.get(norte, norteRequest.id)).resolves.toBe(
      norteRequest,
    );
    const hidden = service.get(norte, surRequest.id);
    const missing = service.get(norte, '6f1c2a10-4b7e-4a1d-9c31-000000000099');
    await expect(hidden).rejects.toBeInstanceOf(PostSaleRequestNotFoundError);
    await expect(missing).rejects.toBeInstanceOf(PostSaleRequestNotFoundError);
    await expect(hidden).rejects.toThrow('Post-sale request was not found');
    await expect(missing).rejects.toThrow('Post-sale request was not found');
  });

  it('returns the specialist name without the Cognito subject or other profile fields', async () => {
    profiles.findProfiles.mockClear();
    const detail = await service.getDetail(norte, norteRequest.id);

    expect(detail.assignedSpecialist).toEqual({
      firstName: 'Carlos',
      lastName: 'Méndez',
    });
    expect(detail).not.toHaveProperty('phoneNumber');
    expect(JSON.stringify(detail.assignedSpecialist)).not.toContain(NORTE);
    await expect(
      service.getDetail(norte, surRequest.id),
    ).rejects.toBeInstanceOf(PostSaleRequestNotFoundError);
    expect(profiles.findProfiles).toHaveBeenCalledTimes(1);
  });

  it('rejects a page that is outside the supported range before querying', async () => {
    const callsBefore = repository.criteria.length;
    await expect(
      service.list(administrator, { page: 0 }),
    ).rejects.toBeInstanceOf(PostSaleRequestQueryError);
    await expect(
      service.list(administrator, { pageSize: 101 }),
    ).rejects.toBeInstanceOf(PostSaleRequestQueryError);
    expect(repository.criteria).toHaveLength(callsBefore);
  });
});

const newRequest = {
  customerId: 'CLI-20001',
  customerName: 'Cerámicas del Valle S.A.S.',
  facilityName: 'Planta Madrid',
  assetId: null,
  type: 'CONSUMO_ATIPICO' as PostSaleRequestType,
  description: 'El consumo del mes se apartó de la referencia.',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
};

describe('PostSaleRequestService creation', () => {
  function repository() {
    let tickets = 0;
    const inserted: PostSaleRequest[] = [];
    const conflicts = new Set<string>();
    return {
      inserted,
      conflicts,
      allocateTicketCode: jest.fn(async () => {
        tickets += 1;
        return `PV-${String(tickets).padStart(6, '0')}`;
      }),
      insert: jest.fn(async (request: PostSaleRequest) => {
        if (conflicts.has(request.ticketCode)) {
          throw new PostSaleRequestConflictError();
        }
        inserted.push(request);
        return request;
      }),
      list: jest.fn(),
      findById: jest.fn(async (id: string) => {
        return inserted.find((item) => item.id === id) ?? null;
      }),
      appendActivity: jest.fn(async () => undefined),
      listActivity: jest.fn(async () => []),
    };
  }

  it('stores a received unassigned request and ignores the caller as specialist', async () => {
    const requests = repository();
    const service = new PostSaleRequestService(
      requests,
      emptyTechnicalData,
      emptyProfiles,
    );
    const created = await service.create(
      actor('creator-sub', UserRole.SPECIALIST),
      newRequest,
    );

    expect(created.status).toBe('RECEIVED');
    expect(requests.appendActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'REQUEST_REGISTERED',
        actorSub: 'creator-sub',
        actorRole: 'SPECIALIST',
      }),
    );
    expect(JSON.stringify(requests.inserted)).not.toContain('cognito');
    expect(created.assignedSpecialistSub).toBeNull();
    expect(created.ticketCode).toBe('PV-000001');
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(requests.allocateTicketCode).toHaveBeenCalledTimes(1);
    await expect(
      service.get(actor('creator-sub', UserRole.SPECIALIST), created.id),
    ).rejects.toBeInstanceOf(PostSaleRequestNotFoundError);
    await expect(
      service.get(actor('admin-sub', UserRole.ADMINISTRATOR), created.id),
    ).resolves.toBe(created);
  });

  it('rejects a validator, an inverted period and a blank description before allocating a ticket', async () => {
    const requests = repository();
    const service = new PostSaleRequestService(
      requests,
      emptyTechnicalData,
      emptyProfiles,
    );

    await expect(
      service.create(actor('validator-sub', UserRole.VALIDATOR), newRequest),
    ).rejects.toBeInstanceOf(PostSaleRequestForbiddenError);
    await expect(
      service.create(actor('admin-sub', UserRole.ADMINISTRATOR), {
        ...newRequest,
        periodStart: '2026-10-02',
        periodEnd: '2026-09-01',
      }),
    ).rejects.toBeInstanceOf(InvalidEvaluationPeriodError);
    await expect(
      service.create(actor('admin-sub', UserRole.ADMINISTRATOR), {
        ...newRequest,
        description: '   ',
      }),
    ).rejects.toBeInstanceOf(InvalidPostSaleRequestError);
    expect(requests.allocateTicketCode).not.toHaveBeenCalled();
  });

  it('retries a duplicate ticket and surfaces a persistence failure', async () => {
    const requests = repository();
    requests.conflicts.add('PV-000001');
    const service = new PostSaleRequestService(
      requests,
      emptyTechnicalData,
      emptyProfiles,
    );
    const created = await service.create(
      actor('admin-sub', UserRole.ADMINISTRATOR),
      newRequest,
    );

    expect(created.ticketCode).toBe('PV-000002');
    expect(requests.allocateTicketCode).toHaveBeenCalledTimes(2);

    requests.insert.mockRejectedValueOnce(
      new PostSaleRequestPersistenceError(),
    );
    await expect(
      service.create(actor('admin-sub', UserRole.ADMINISTRATOR), newRequest),
    ).rejects.toBeInstanceOf(PostSaleRequestPersistenceError);
  });
});
