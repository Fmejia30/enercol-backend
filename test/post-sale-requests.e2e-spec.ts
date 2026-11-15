import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { TOKEN_VERIFIER } from '../src/modules/identity-access/application/token-verifier.js';
import type { TokenVerifier } from '../src/modules/identity-access/application/token-verifier.js';
import type { AuthenticatedUser } from '../src/modules/identity-access/domain/authenticated-user.js';
import { UserRole } from '../src/modules/identity-access/domain/user-role.js';
import { ACCESS_DENIED_MESSAGE } from '../src/modules/identity-access/presentation/roles.guard.js';
import { configureApp } from '../src/shared/http/configure-app.js';

const NOT_FOUND_MESSAGE = 'No existe una solicitud con ese identificador';
const NORTE = 'e2e-specialist-norte';
const SUR = 'e2e-specialist-sur';
const VALIDATOR = 'e2e-validator';

interface StoredRequest {
  id: string;
  ticketCode: string;
  customerId: string;
  customerName: string;
  facilityName: string;
  assetId: string | null;
  assignedSpecialistSub: string | null;
  type: string;
  description: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ContainsFilter {
  contains: string;
  mode: 'insensitive';
}

interface RequestWhere {
  assignedSpecialistSub?: string;
  status?: string;
  OR?: Array<{
    ticketCode?: ContainsFilter;
    customerId?: ContainsFilter;
    customerName?: ContainsFilter;
    facilityName?: ContainsFilter;
  }>;
}

function stored(
  draft: Omit<
    StoredRequest,
    'periodStart' | 'periodEnd' | 'createdAt' | 'updatedAt'
  > & {
    periodStart: string;
    periodEnd: string;
    createdAt: string;
  },
): StoredRequest {
  const createdAt = new Date(draft.createdAt);
  return {
    ...draft,
    periodStart: new Date(`${draft.periodStart}T00:00:00.000Z`),
    periodEnd: new Date(`${draft.periodEnd}T00:00:00.000Z`),
    createdAt,
    updatedAt: createdAt,
  };
}

const requests: StoredRequest[] = [
  stored({
    id: '6f1c2a10-4b7e-4a1d-9c31-000000000001',
    ticketCode: 'PV-24018',
    customerId: 'CLI-10421',
    customerName: 'Textiles del Altiplano S.A.S.',
    facilityName: 'Planta Fontibón',
    assetId: 'MED-FTB-014',
    assignedSpecialistSub: NORTE,
    type: 'VERIFICACION_DEMANDA',
    description: 'Demanda en horario de punta.',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status: 'ABIERTA',
    createdAt: '2026-10-02T15:00:00.000Z',
  }),
  stored({
    id: '6f1c2a10-4b7e-4a1d-9c31-000000000002',
    ticketCode: 'PV-24019',
    customerId: 'CLI-10421',
    customerName: 'Textiles del Altiplano S.A.S.',
    facilityName: 'Planta Fontibón',
    assetId: 'MED-FTB-022',
    assignedSpecialistSub: NORTE,
    type: 'DESVIACION_FACTOR_POTENCIA',
    description: 'Factor de potencia por debajo del mínimo.',
    periodStart: '2026-08-01',
    periodEnd: '2026-09-30',
    status: 'EN_ANALISIS',
    createdAt: '2026-10-06T15:00:00.000Z',
  }),
  stored({
    id: '6f1c2a10-4b7e-4a1d-9c31-000000000003',
    ticketCode: 'PV-24022',
    customerId: 'CLI-10458',
    customerName: 'Alimentos Río Claro S.A.',
    facilityName: 'Complejo Girardot',
    assetId: 'MED-GIR-003',
    assignedSpecialistSub: SUR,
    type: 'CONSUMO_ATIPICO',
    description: 'Consumo apartado del patrón histórico.',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    status: 'ABIERTA',
    createdAt: '2026-10-08T15:00:00.000Z',
  }),
  stored({
    id: '6f1c2a10-4b7e-4a1d-9c31-000000000004',
    ticketCode: 'PV-24025',
    customerId: 'CLI-10502',
    customerName: 'Industrias Roble Andino S.A.S.',
    facilityName: 'Subestación Chía',
    assetId: null,
    assignedSpecialistSub: SUR,
    type: 'CALIDAD_DE_POTENCIA',
    description: 'Eventos de calidad de potencia.',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-15',
    status: 'INFORME_EMITIDO',
    createdAt: '2026-10-11T15:00:00.000Z',
  }),
  stored({
    id: '6f1c2a10-4b7e-4a1d-9c31-000000000005',
    ticketCode: 'PV-24027',
    customerId: 'CLI-10577',
    customerName: 'Frigorífico La Sabana Ltda.',
    facilityName: 'Bodega Siberia',
    assetId: 'MED-SIB-008',
    assignedSpecialistSub: VALIDATOR,
    type: 'VERIFICACION_DEMANDA',
    description: 'Demanda máxima de la bodega.',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status: 'EN_ANALISIS',
    createdAt: '2026-10-15T15:00:00.000Z',
  }),
  stored({
    id: '6f1c2a10-4b7e-4a1d-9c31-000000000006',
    ticketCode: 'PV-24031',
    customerId: 'CLI-10610',
    customerName: 'Empaques del Magdalena S.A.',
    facilityName: 'Planta Barranquilla',
    assetId: 'MED-BAQ-011',
    assignedSpecialistSub: NORTE,
    type: 'CONSUMO_ATIPICO',
    description: 'Consumo por encima de la referencia.',
    periodStart: '2026-06-01',
    periodEnd: '2026-09-30',
    status: 'INFORME_EMITIDO',
    createdAt: '2026-10-20T15:00:00.000Z',
  }),
  stored({
    id: '6f1c2a10-4b7e-4a1d-9c31-000000000007',
    ticketCode: 'PV-24033',
    customerId: 'CLI-10458',
    customerName: 'Alimentos Río Claro S.A.',
    facilityName: 'Centro de distribución Flandes',
    assetId: 'MED-FLA-002',
    assignedSpecialistSub: SUR,
    type: 'DESVIACION_FACTOR_POTENCIA',
    description: 'Factor de potencia bajo el umbral.',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    status: 'ABIERTA',
    createdAt: '2026-10-22T15:00:00.000Z',
  }),
  stored({
    id: '6f1c2a10-4b7e-4a1d-9c31-000000000008',
    ticketCode: 'PV-24036',
    customerId: 'CLI-10502',
    customerName: 'Industrias Roble Andino S.A.S.',
    facilityName: 'Planta Zipaquirá',
    assetId: null,
    assignedSpecialistSub: VALIDATOR,
    type: 'CALIDAD_DE_POTENCIA',
    description: 'Variaciones de tensión del periodo.',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    status: 'ABIERTA',
    createdAt: '2026-10-28T15:00:00.000Z',
  }),
];

function matches(row: StoredRequest, where: RequestWhere): boolean {
  if (
    where.assignedSpecialistSub !== undefined &&
    row.assignedSpecialistSub !== where.assignedSpecialistSub
  ) {
    return false;
  }
  if (where.status !== undefined && row.status !== where.status) {
    return false;
  }
  if (!where.OR) {
    return true;
  }
  return where.OR.some((clause) =>
    (
      [
        [row.ticketCode, clause.ticketCode],
        [row.customerId, clause.customerId],
        [row.customerName, clause.customerName],
        [row.facilityName, clause.facilityName],
      ] as const
    ).some(
      ([value, filter]) =>
        filter !== undefined &&
        value
          .toLocaleLowerCase('es')
          .includes(filter.contains.toLocaleLowerCase('es')),
    ),
  );
}

function visible(where: RequestWhere): StoredRequest[] {
  return requests
    .filter((row) => matches(row, where))
    .sort((left, right) => {
      const byDate = right.createdAt.getTime() - left.createdAt.getTime();
      return byDate === 0 ? right.id.localeCompare(left.id) : byDate;
    });
}

const NORTE_CASE = '6f1c2a10-4b7e-4a1d-9c31-000000000001';
const SUR_CASE = '6f1c2a10-4b7e-4a1d-9c31-000000000003';
const CLEAN_DEMAND_CASE = '6f1c2a10-4b7e-4a1d-9c31-000000000005';

function quantity(value: string) {
  return { toFixed: () => value };
}

const technicalDatasets = new Map([
  [
    NORTE_CASE,
    {
      demandThreshold: quantity('250.000'),
      demandUnit: 'kW',
      evaluationConsumption: null,
      consumptionUnit: 'kWh',
      sourceName: 'Conjunto técnico controlado Act-05',
      sourceKind: 'local-controlled-dataset',
      telemetryReadings: [
        {
          measuredAt: new Date('2026-08-31T23:00:00.000Z'),
          measuredDemand: quantity('300.000'),
        },
        {
          measuredAt: new Date('2026-09-15T13:00:00.000Z'),
          measuredDemand: quantity('267.250'),
        },
      ],
      historicalConsumption: [
        {
          periodStart: new Date('2026-08-01T00:00:00.000Z'),
          periodEnd: new Date('2026-08-31T00:00:00.000Z'),
          consumption: quantity('148750.500'),
        },
        {
          periodStart: new Date('2026-10-01T00:00:00.000Z'),
          periodEnd: new Date('2026-10-31T00:00:00.000Z'),
          consumption: quantity('90000.000'),
        },
      ],
    },
  ],
  [
    SUR_CASE,
    {
      demandThreshold: null,
      demandUnit: 'kW',
      evaluationConsumption: quantity('124800.000'),
      consumptionUnit: 'kWh',
      sourceName: 'Conjunto técnico controlado Act-05',
      sourceKind: 'local-controlled-dataset',
      telemetryReadings: [
        {
          measuredAt: new Date('2026-08-15T13:00:00.000Z'),
          measuredDemand: quantity('191.500'),
        },
      ],
      historicalConsumption: [],
    },
  ],
  [
    CLEAN_DEMAND_CASE,
    {
      demandThreshold: quantity('250.000'),
      demandUnit: 'kW',
      evaluationConsumption: null,
      consumptionUnit: 'kWh',
      sourceName: 'Conjunto técnico controlado Act-05',
      sourceKind: 'local-controlled-dataset',
      telemetryReadings: [
        {
          measuredAt: new Date('2026-09-03T15:30:00.000Z'),
          measuredDemand: quantity('267.250'),
        },
      ],
      historicalConsumption: [],
    },
  ],
]);

const storedAnalyses: Array<{
  id: string;
  postSaleRequestId: string;
  status: string;
  executedAt: Date;
  executedBySub: string;
  failureMessage: string | null;
  inputSnapshot: unknown;
  findings: unknown;
}> = [];

function requestDatabase(): Pick<
  PrismaService,
  '$disconnect' | '$queryRaw' | 'postSaleRequest'
> {
  let lastTicket = 0;
  const database = {
    $disconnect: jest.fn<PrismaService['$disconnect']>(async () => undefined),
    $queryRaw: jest.fn<PrismaService['$queryRaw']>(async () => []),
    postSaleRequestTicket: {
      update: jest.fn(async () => {
        lastTicket += 1;
        return { id: 'post-sale', lastValue: lastTicket };
      }),
    },
    technicalDataset: {
      findUnique: jest.fn(
        async (args: { where: { postSaleRequestId: string } }) =>
          technicalDatasets.get(args.where.postSaleRequestId) ?? null,
      ),
    },
    userProfile: {
      findMany: jest.fn(
        async (args: { where: { cognitoSub: { in: string[] } } }) =>
          args.where.cognitoSub.in
            .filter((sub) => sub === NORTE)
            .map((cognitoSub) => ({
              cognitoSub,
              firstName: 'Carlos',
              lastName: 'Méndez',
              phoneNumber: '3000000000',
            })),
      ),
    },
    technicalAnalysis: {
      create: jest.fn(
        async (args: { data: (typeof storedAnalyses)[number] }) => {
          storedAnalyses.push(args.data);
          return args.data;
        },
      ),
      findMany: jest.fn(
        async (args: { where: { postSaleRequestId: string } }) =>
          storedAnalyses
            .filter(
              (row) => row.postSaleRequestId === args.where.postSaleRequestId,
            )
            .sort((left, right) => {
              const byDate =
                right.executedAt.getTime() - left.executedAt.getTime();
              return byDate === 0 ? right.id.localeCompare(left.id) : byDate;
            }),
      ),
    },
    technicalReport: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
    },
    postSaleRequest: {
      findMany: jest.fn(
        async (args: { where: RequestWhere; skip: number; take: number }) =>
          visible(args.where).slice(args.skip, args.skip + args.take),
      ),
      count: jest.fn(
        async (args: { where: RequestWhere }) => visible(args.where).length,
      ),
      findUnique: jest.fn(async (args: { where: { id: string } }) => {
        return requests.find((row) => row.id === args.where.id) ?? null;
      }),
      create: jest.fn(async (args: { data: StoredRequest }) => {
        const row = {
          ...args.data,
          updatedAt: args.data.createdAt,
        };
        requests.push(row);
        return row;
      }),
      update: jest.fn(async (args: { where: { id: string }; data: { status?: string } }) => {
        const row = requests.find((item) => item.id === args.where.id);
        if (!row) {
          throw new Error('missing request');
        }
        if (args.data.status) {
          row.status = args.data.status;
        }
        return row;
      }),
    },
    postSaleRequestActivity: {
      create: jest.fn(async (args: { data: { dedupeKey: string } }) => args.data),
      findMany: jest.fn(async () => []),
    },
  };
  return Object.assign(database, {
    $transaction: jest.fn(async (callback: (client: typeof database) => Promise<unknown>) =>
      callback(database),
    ),
  }) as unknown as Pick<
    PrismaService,
    '$disconnect' | '$queryRaw' | 'postSaleRequest'
  >;
}

describe('Post-sale requests (e2e)', () => {
  const users = new Map<string, AuthenticatedUser>([
    ['norte-token', { userId: NORTE, roles: [UserRole.SPECIALIST] }],
    ['sur-token', { userId: SUR, roles: [UserRole.SPECIALIST] }],
    ['validator-token', { userId: VALIDATOR, roles: [UserRole.VALIDATOR] }],
    ['admin-token', { userId: 'e2e-admin', roles: [UserRole.ADMINISTRATOR] }],
    ['empty-token', { userId: 'e2e-empty', roles: [] }],
  ]);
  const tokenVerifier: TokenVerifier = {
    verify: jest.fn<TokenVerifier['verify']>(async (token: string) => {
      const user = users.get(token);
      if (!user) {
        throw new Error('invalid signature');
      }
      return user;
    }),
  };

  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(tokenVerifier)
      .overrideProvider(PrismaService)
      .useValue(requestDatabase())
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires a recognized role', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests')
      .expect(401);
    const denied = await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests')
      .set('Authorization', 'Bearer empty-token')
      .expect(403);
    expect(denied.body.message).toBe(ACCESS_DENIED_MESSAGE);
  });

  it('lets a specialist read report history and keeps generation away from a validator', async () => {
    const requestId = '6f1c2a10-4b7e-4a1d-9c31-000000000001';
    const visible = await request(app.getHttpServer())
      .get(`/api/v1/post-sale-requests/${requestId}/reports`)
      .set('Authorization', 'Bearer norte-token')
      .expect(200);
    expect(visible.body.items).toEqual([]);

    const hidden = await request(app.getHttpServer())
      .get(`/api/v1/post-sale-requests/${requestId}/reports`)
      .set('Authorization', 'Bearer sur-token')
      .expect(404);
    expect(hidden.body.message).toBe(NOT_FOUND_MESSAGE);

    const denied = await request(app.getHttpServer())
      .post(`/api/v1/post-sale-requests/${requestId}/reports`)
      .set('Authorization', 'Bearer validator-token')
      .expect(403);
    expect(denied.body.message).toBe(ACCESS_DENIED_MESSAGE);

    const missingAnalysis = await request(app.getHttpServer())
      .post(`/api/v1/post-sale-requests/${requestId}/reports`)
      .set('Authorization', 'Bearer norte-token')
      .expect(400);
    expect(missingAnalysis.body.message).toBe(
      'No hay un análisis técnico exitoso para esta solicitud',
    );
  });

  it('lists assigned requests for a specialist and a validator, and all of them for an administrator', async () => {
    const specialist = await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests')
      .set('Authorization', 'Bearer norte-token')
      .expect(200);
    expect(specialist.body.total).toBe(3);
    expect(
      specialist.body.items.every(
        (item: { assignedSpecialistSub: string }) =>
          item.assignedSpecialistSub === NORTE,
      ),
    ).toBe(true);

    const validator = await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests')
      .set('Authorization', 'Bearer validator-token')
      .expect(200);
    expect(
      validator.body.items.map(
        (item: { ticketCode: string }) => item.ticketCode,
      ),
    ).toEqual(['PV-24036', 'PV-24027']);

    const administrator = await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests')
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(administrator.body.total).toBe(8);
    expect(administrator.body.page).toBe(1);
    expect(administrator.body.pageSize).toBe(20);
  });

  it('filters by status, searches, and paginates for an administrator', async () => {
    const open = await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests')
      .query({ status: 'ABIERTA' })
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(open.body.total).toBe(4);

    const search = await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests')
      .query({ search: 'fontibón' })
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(
      search.body.items.map((item: { ticketCode: string }) => item.ticketCode),
    ).toEqual(['PV-24019', 'PV-24018']);

    const page = await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests')
      .query({ page: 2, pageSize: 3 })
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(page.body).toMatchObject({ page: 2, pageSize: 3, total: 8 });
    expect(page.body.items).toHaveLength(3);
  });

  it('rejects a client-supplied specialist and an invalid query', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests')
      .query({ assignedSpecialistSub: SUR })
      .set('Authorization', 'Bearer norte-token')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests')
      .query({ status: 'CERRADA' })
      .set('Authorization', 'Bearer admin-token')
      .expect(400);
  });

  it('returns an accessible request and the same not-found response for a hidden or missing one', async () => {
    const ownList = await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests')
      .set('Authorization', 'Bearer norte-token')
      .expect(200);
    const ownId = ownList.body.items[0].id as string;
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/post-sale-requests/${ownId}`)
      .set('Authorization', 'Bearer norte-token')
      .expect(200);
    expect(detail.body.ticketCode).toBe('PV-24031');
    expect(detail.body.periodStart).toBe('2026-06-01');
    expect(detail.body.periodEnd).toBe('2026-09-30');
    expect(detail.body.assignedSpecialist).toEqual({
      firstName: 'Carlos',
      lastName: 'Méndez',
    });
    expect(detail.body.assignedSpecialistSub).toBeUndefined();
    expect(detail.body.createdAt).toBe('2026-10-20T15:00:00.000Z');

    const foreignList = await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests')
      .set('Authorization', 'Bearer sur-token')
      .expect(200);
    const foreignId = foreignList.body.items[0].id as string;

    const hidden = await request(app.getHttpServer())
      .get(`/api/v1/post-sale-requests/${foreignId}`)
      .set('Authorization', 'Bearer norte-token')
      .expect(404);
    const missing = await request(app.getHttpServer())
      .get('/api/v1/post-sale-requests/6f1c2a10-4b7e-4a1d-9c31-000000000099')
      .set('Authorization', 'Bearer norte-token')
      .expect(404);
    expect(hidden.body.message).toBe(NOT_FOUND_MESSAGE);
    expect(missing.body.message).toBe(NOT_FOUND_MESSAGE);
  });

  it('returns technical data only for the specialist assigned to that case and only inside its period', async () => {
    const own = await request(app.getHttpServer())
      .get(`/api/v1/post-sale-requests/${NORTE_CASE}/technical-data`)
      .set('Authorization', 'Bearer norte-token')
      .expect(200);
    expect(own.body).toMatchObject({
      requestId: NORTE_CASE,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      demandThreshold: '250.000',
      demandUnit: 'kW',
      evaluationConsumption: null,
      consumptionUnit: 'kWh',
      sourceKind: 'local-controlled-dataset',
    });
    expect(own.body.telemetry).toEqual([
      { measuredAt: '2026-09-15T13:00:00.000Z', measuredDemand: '267.250' },
    ]);
    expect(own.body.historicalConsumption).toEqual([
      {
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        consumption: '148750.500',
      },
    ]);

    const hidden = await request(app.getHttpServer())
      .get(`/api/v1/post-sale-requests/${SUR_CASE}/technical-data`)
      .set('Authorization', 'Bearer norte-token')
      .expect(404);
    const foreign = await request(app.getHttpServer())
      .get(`/api/v1/post-sale-requests/${NORTE_CASE}/technical-data`)
      .set('Authorization', 'Bearer sur-token')
      .expect(404);
    expect(hidden.body.message).toBe(NOT_FOUND_MESSAGE);
    expect(foreign.body.message).toBe(NOT_FOUND_MESSAGE);

    const visibleToOwner = await request(app.getHttpServer())
      .get(`/api/v1/post-sale-requests/${SUR_CASE}/technical-data`)
      .set('Authorization', 'Bearer sur-token')
      .expect(200);
    expect(visibleToOwner.body.telemetry).toEqual([
      { measuredAt: '2026-08-15T13:00:00.000Z', measuredDemand: '191.500' },
    ]);
    expect(visibleToOwner.body.evaluationConsumption).toBe('124800.000');
    expect(visibleToOwner.body.demandThreshold).toBeNull();
  });

  it('persists repeated analyses and keeps calculated findings on the server', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/post-sale-requests/${CLEAN_DEMAND_CASE}/analyses`)
      .set('Authorization', 'Bearer validator-token')
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/post-sale-requests/${CLEAN_DEMAND_CASE}/analyses`)
      .set('Authorization', 'Bearer norte-token')
      .send({ findings: [{ measuredValue: '1.000' }] })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/post-sale-requests/${SUR_CASE}/analyses`)
      .set('Authorization', 'Bearer norte-token')
      .send({})
      .expect(404);

    const failed = await request(app.getHttpServer())
      .post(`/api/v1/post-sale-requests/${NORTE_CASE}/analyses`)
      .set('Authorization', 'Bearer norte-token')
      .send({})
      .expect(201);
    expect(failed.body.status).toBe('FAILED');
    expect(failed.body.findings).toEqual([]);
    expect(failed.body.executedAt).toMatch(/Z$/);
    expect(failed.body.executedBySub).toBeUndefined();

    const first = await request(app.getHttpServer())
      .post(`/api/v1/post-sale-requests/${CLEAN_DEMAND_CASE}/analyses`)
      .set('Authorization', 'Bearer admin-token')
      .send({})
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/api/v1/post-sale-requests/${CLEAN_DEMAND_CASE}/analyses`)
      .set('Authorization', 'Bearer admin-token')
      .send({})
      .expect(201);
    expect(first.body).toMatchObject({
      status: 'SUCCEEDED',
      requestId: CLEAN_DEMAND_CASE,
      findings: [
        expect.objectContaining({
          findingType: 'DEMAND_EXCEEDANCE',
          measuredValue: '267.250',
          referenceValue: '250.000',
          difference: '17.250',
          percentage: '6.900',
          unit: 'kW',
        }),
      ],
    });
    expect(first.body.id).not.toBe(second.body.id);
    expect(JSON.stringify(first.body)).not.toContain('executedBySub');

    const history = await request(app.getHttpServer())
      .get(`/api/v1/post-sale-requests/${CLEAN_DEMAND_CASE}/analyses`)
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(
      history.body.items.map((item: { id: string }) => item.id).sort(),
    ).toEqual([second.body.id, first.body.id].sort());
    const [latest, previous] = history.body.items as Array<{
      executedAt: string;
    }>;
    expect(Date.parse(latest?.executedAt ?? '')).toBeGreaterThanOrEqual(
      Date.parse(previous?.executedAt ?? ''),
    );
    const hidden = await request(app.getHttpServer())
      .get(`/api/v1/post-sale-requests/${CLEAN_DEMAND_CASE}/analyses`)
      .set('Authorization', 'Bearer norte-token')
      .expect(404);
    expect(hidden.body.message).toBe(NOT_FOUND_MESSAGE);
  });

  it('creates an open unassigned request and keeps it hidden from the specialist who registered it', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/post-sale-requests')
      .set('Authorization', 'Bearer norte-token')
      .send({
        customerId: 'CLI-20001',
        customerName: 'Cerámicas del Valle S.A.S.',
        facilityName: 'Planta Madrid',
        type: 'CONSUMO_ATIPICO',
        description: 'El consumo del mes se apartó de la referencia.',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
      })
      .expect(201);

    expect(created.body).toMatchObject({
      ticketCode: 'PV-000001',
      status: 'RECEIVED',
      assignedSpecialistSub: null,
      customerId: 'CLI-20001',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(created.body.id).toEqual(expect.any(String));
    expect(created.body.createdAt).toEqual(expect.any(String));

    const hidden = await request(app.getHttpServer())
      .get(`/api/v1/post-sale-requests/${created.body.id as string}`)
      .set('Authorization', 'Bearer norte-token')
      .expect(404);
    const visible = await request(app.getHttpServer())
      .get(`/api/v1/post-sale-requests/${created.body.id as string}`)
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(hidden.body.message).toBe(NOT_FOUND_MESSAGE);
    expect(visible.body.ticketCode).toBe('PV-000001');
  });

  it('rejects creation by a validator and invalid or privileged fields', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/post-sale-requests')
      .set('Authorization', 'Bearer validator-token')
      .send({
        customerId: 'CLI-20001',
        customerName: 'Cerámicas del Valle S.A.S.',
        facilityName: 'Planta Madrid',
        type: 'CONSUMO_ATIPICO',
        description: 'El consumo del mes se apartó de la referencia.',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
      })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/post-sale-requests')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/post-sale-requests')
      .set('Authorization', 'Bearer admin-token')
      .send({
        customerId: 'CLI-20001',
        customerName: 'Cerámicas del Valle S.A.S.',
        facilityName: 'Planta Madrid',
        type: 'CONSUMO_ATIPICO',
        description: 'El consumo del mes se apartó de la referencia.',
        periodStart: '2026-10-02',
        periodEnd: '2026-09-01',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/post-sale-requests')
      .set('Authorization', 'Bearer admin-token')
      .send({
        customerId: 'CLI-20001',
        customerName: 'Cerámicas del Valle S.A.S.',
        facilityName: 'Planta Madrid',
        type: 'DESCONOCIDO',
        description: 'El consumo del mes se apartó de la referencia.',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        status: 'INFORME_EMITIDO',
        assignedSpecialistSub: SUR,
        ticketCode: 'PV-999999',
      })
      .expect(400);
  });
});
