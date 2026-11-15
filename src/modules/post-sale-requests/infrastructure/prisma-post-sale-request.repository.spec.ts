import { jest } from '@jest/globals';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { ListPostSaleRequestsCriteria } from '../application/post-sale-request.repository.js';
import {
  InvalidEvaluationPeriodError,
  InvalidPostSaleRequestError,
} from '../domain/post-sale-request.js';
import {
  PostSaleRequestConflictError,
  PostSaleRequestPersistenceError,
} from '../domain/post-sale-request-error.js';
import { PrismaPostSaleRequestRepository } from './prisma-post-sale-request.repository.js';

const row = {
  id: '6f1c2a10-4b7e-4a1d-9c31-000000000001',
  ticketCode: 'PV-24018',
  customerId: 'CLI-10421',
  customerName: 'Textiles del Altiplano S.A.S.',
  facilityName: 'Planta Fontibón',
  assetId: 'MED-FTB-014',
  assignedSpecialistSub: 'specialist-norte',
  type: 'VERIFICACION_DEMANDA',
  description: 'Revisión de demanda.',
  periodStart: new Date('2026-09-01T00:00:00.000Z'),
  periodEnd: new Date('2026-09-30T00:00:00.000Z'),
  status: 'ABIERTA',
  createdAt: new Date('2026-10-02T15:00:00.000Z'),
  updatedAt: new Date('2026-10-02T15:00:00.000Z'),
};

describe('PrismaPostSaleRequestRepository', () => {
  const findMany = jest.fn<(args: unknown) => Promise<unknown[]>>();
  const count = jest.fn<(args: unknown) => Promise<number>>();
  const findUnique = jest.fn<(args: unknown) => Promise<unknown>>();
  const create = jest.fn<(args: unknown) => Promise<unknown>>();
  const allocate = jest.fn<(args: unknown) => Promise<{ lastValue: number }>>();
  const prisma = {
    postSaleRequest: { findMany, count, findUnique, create },
    postSaleRequestTicket: { update: allocate },
  } as unknown as PrismaService;
  const repository = new PrismaPostSaleRequestRepository(prisma);

  beforeEach(() => {
    findMany.mockReset();
    count.mockReset();
    findUnique.mockReset();
    create.mockReset();
    allocate.mockReset();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    findUnique.mockResolvedValue(null);
  });

  it('filters by assignment, status and search in one database query', async () => {
    const criteria: ListPostSaleRequestsCriteria = {
      visibility: { kind: 'assigned', specialistSub: 'specialist-norte' },
      status: 'EN_ANALISIS',
      search: '  Fontibón  ',
      page: 2,
      pageSize: 3,
    };

    await repository.list(criteria);

    const expectedWhere = {
      assignedSpecialistSub: 'specialist-norte',
      status: 'EN_ANALISIS',
      OR: [
        { ticketCode: { contains: 'Fontibón', mode: 'insensitive' } },
        { customerId: { contains: 'Fontibón', mode: 'insensitive' } },
        { customerName: { contains: 'Fontibón', mode: 'insensitive' } },
        { facilityName: { contains: 'Fontibón', mode: 'insensitive' } },
      ],
    };
    expect(findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 3,
      take: 3,
    });
    expect(count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('does not restrict an administrator and ignores a blank search', async () => {
    await repository.list({
      visibility: { kind: 'all' },
      search: '   ',
      page: 1,
      pageSize: 20,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    });
    expect(count).toHaveBeenCalledWith({ where: {} });
  });

  it('maps persisted rows and keeps the database total', async () => {
    findMany.mockResolvedValue([
      row,
      { ...row, id: 'without-asset', assetId: null, ticketCode: 'PV-24025' },
    ]);
    count.mockResolvedValue(8);

    const page = await repository.list({
      visibility: { kind: 'all' },
      page: 1,
      pageSize: 20,
    });

    expect(page.total).toBe(8);
    expect(page.items[0]).toMatchObject({
      id: row.id,
      ticketCode: 'PV-24018',
      assetId: 'MED-FTB-014',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      status: 'ABIERTA',
      createdAt: row.createdAt,
    });
    expect(page.items[1]?.assetId).toBeNull();
  });

  it('looks up one request by id and returns null when it is missing', async () => {
    findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(null);

    await expect(repository.findById(row.id)).resolves.toMatchObject({
      ticketCode: 'PV-24018',
    });
    await expect(repository.findById('missing')).resolves.toBeNull();
    expect(findUnique).toHaveBeenNthCalledWith(1, { where: { id: row.id } });
    expect(findUnique).toHaveBeenNthCalledWith(2, { where: { id: 'missing' } });
  });

  it('rejects a persisted row whose period or status is invalid', async () => {
    findUnique.mockResolvedValueOnce({
      ...row,
      periodEnd: new Date('2026-08-01T00:00:00.000Z'),
    });
    await expect(repository.findById(row.id)).rejects.toBeInstanceOf(
      InvalidEvaluationPeriodError,
    );

    findUnique.mockResolvedValueOnce({ ...row, status: 'CERRADA' });
    await expect(repository.findById(row.id)).rejects.toBeInstanceOf(
      InvalidPostSaleRequestError,
    );
  });

  it('allocates the next ticket from the database counter', async () => {
    allocate.mockResolvedValue({ lastValue: 1 });

    await expect(repository.allocateTicketCode()).resolves.toBe('PV-000001');
    expect(allocate).toHaveBeenCalledWith({
      where: { id: 'post-sale' },
      data: { lastValue: { increment: 1 } },
    });
  });

  it('persists an unassigned request and reports a duplicate identifier', async () => {
    create.mockResolvedValueOnce({
      ...row,
      id: 'created-id',
      ticketCode: 'PV-000001',
      assignedSpecialistSub: null,
      assetId: null,
    });

    const created = await repository.insert({
      id: 'created-id',
      ticketCode: 'PV-000001',
      customerId: 'CLI-10421',
      customerName: 'Textiles del Altiplano S.A.S.',
      facilityName: 'Planta Fontibón',
      assetId: null,
      assignedSpecialistSub: null,
      type: 'VERIFICACION_DEMANDA',
      description: 'Revisión de demanda.',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      status: 'ABIERTA',
      createdAt: row.createdAt,
    });

    expect(created.assignedSpecialistSub).toBeNull();
    expect(created.ticketCode).toBe('PV-000001');
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'created-id',
        ticketCode: 'PV-000001',
        assignedSpecialistSub: null,
        status: 'ABIERTA',
        periodStart: new Date('2026-09-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-30T00:00:00.000Z'),
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      }),
    });

    create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      repository.insert({
        ...created,
        id: 'other-id',
      }),
    ).rejects.toBeInstanceOf(PostSaleRequestConflictError);

    create.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(repository.insert(created)).rejects.toBeInstanceOf(
      PostSaleRequestPersistenceError,
    );
  });
});
