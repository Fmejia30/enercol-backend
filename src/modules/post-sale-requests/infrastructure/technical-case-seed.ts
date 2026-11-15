export const SEED_SPECIALIST_SUB_VARIABLE = 'SEED_SPECIALIST_SUB';

const COGNITO_SUB =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CREATED_AT = new Date('2026-09-08T12:00:00.000Z');

export interface TechnicalSeedRequest {
  readonly id: string;
  readonly ticketCode: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly facilityName: string;
  readonly assetId: string | null;
  readonly assignedSpecialistSub: string;
  readonly type: 'VERIFICACION_DEMANDA' | 'CONSUMO_ATIPICO';
  readonly description: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly status: 'ASSIGNED';
  readonly createdAt: Date;
}

export interface TechnicalSeedDataset {
  readonly id: string;
  readonly postSaleRequestId: string;
  readonly demandThreshold: string | null;
  readonly demandUnit: 'kW';
  readonly evaluationConsumption: string | null;
  readonly consumptionUnit: 'kWh';
  readonly sourceName: string;
  readonly sourceKind: 'local-controlled-dataset';
}

export interface TechnicalSeedReading {
  readonly id: string;
  readonly datasetId: string;
  readonly measuredAt: Date;
  readonly measuredDemand: string;
}

export interface TechnicalSeedHistory {
  readonly id: string;
  readonly datasetId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly consumption: string;
}

export interface TechnicalSeedCase {
  readonly request: TechnicalSeedRequest;
  readonly dataset: TechnicalSeedDataset;
  readonly telemetry: readonly TechnicalSeedReading[];
  readonly historicalConsumption: readonly TechnicalSeedHistory[];
}

export interface TechnicalSeedStore {
  postSaleRequest: {
    upsert(args: {
      where: { id: string };
      create: TechnicalSeedRequest;
      update: Omit<TechnicalSeedRequest, 'id'>;
    }): Promise<unknown>;
  };
  technicalDataset: {
    upsert(args: {
      where: { id: string };
      create: TechnicalSeedDataset;
      update: Omit<TechnicalSeedDataset, 'id'>;
    }): Promise<unknown>;
  };
  telemetryReading: {
    deleteMany(args: { where: { datasetId: string } }): Promise<unknown>;
    createMany(args: { data: TechnicalSeedReading[] }): Promise<unknown>;
  };
  historicalConsumption: {
    deleteMany(args: { where: { datasetId: string } }): Promise<unknown>;
    createMany(args: { data: TechnicalSeedHistory[] }): Promise<unknown>;
  };
}

export function readSeedSpecialistSub(
  env: Record<string, string | undefined>,
): string {
  const value = env[SEED_SPECIALIST_SUB_VARIABLE]?.trim() ?? '';
  if (!COGNITO_SUB.test(value)) {
    throw new Error(
      `Defina ${SEED_SPECIALIST_SUB_VARIABLE} con el sub de Cognito del especialista antes de sembrar los casos técnicos.`,
    );
  }
  return value;
}

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1']);

export function assertSeedTarget(
  env: Record<string, string | undefined>,
): void {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL es necesaria para sembrar los casos técnicos.',
    );
  }
  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('DATABASE_URL no es una cadena de conexión válida.');
  }
  if (LOCAL_DATABASE_HOSTS.has(hostname)) {
    return;
  }
  const allowedHost = env.SEED_DATABASE_HOST?.trim().toLowerCase() ?? '';
  if (allowedHost.length === 0 || allowedHost !== hostname) {
    throw new Error(
      'La semilla técnica solo puede ejecutarse contra PostgreSQL local o el host indicado en SEED_DATABASE_HOST.',
    );
  }
}

export function technicalTestCases(specialistSub: string): TechnicalSeedCase[] {
  return [demandCase(specialistSub), consumptionCase(specialistSub)];
}

export async function applyTechnicalTestCases(
  store: TechnicalSeedStore,
  specialistSub: string,
): Promise<{ cases: number }> {
  const cases = technicalTestCases(specialistSub);
  for (const testCase of cases) {
    await store.postSaleRequest.upsert({
      where: { id: testCase.request.id },
      create: testCase.request,
      update: withoutId(testCase.request),
    });
    await store.technicalDataset.upsert({
      where: { id: testCase.dataset.id },
      create: testCase.dataset,
      update: withoutId(testCase.dataset),
    });
    await store.telemetryReading.deleteMany({
      where: { datasetId: testCase.dataset.id },
    });
    if (testCase.telemetry.length > 0) {
      await store.telemetryReading.createMany({
        data: [...testCase.telemetry],
      });
    }
    await store.historicalConsumption.deleteMany({
      where: { datasetId: testCase.dataset.id },
    });
    await store.historicalConsumption.createMany({
      data: [...testCase.historicalConsumption],
    });
  }
  return { cases: cases.length };
}

function demandCase(specialistSub: string): TechnicalSeedCase {
  const requestId = '6f1c2a10-4b7e-4a1d-9c31-a05000000001';
  const datasetId = '6f1c2a10-4b7e-4a1d-9c31-a05000000011';
  return {
    request: request(requestId, specialistSub, {
      ticketCode: 'PV-A05-001',
      customerId: 'CLI-A05-001',
      customerName: 'Textiles del Altiplano S.A.S.',
      facilityName: 'Planta Fontibón',
      assetId: 'MED-FTB-014',
      type: 'VERIFICACION_DEMANDA',
      description:
        'Caso controlado para comparar la demanda medida, en kW, con el umbral contractual de 250.000 kW.',
      periodStart: date('2026-09-01'),
      periodEnd: date('2026-09-07'),
    }),
    dataset: dataset(datasetId, requestId, '250.000', null),
    telemetry: [
      reading(datasetId, '21', '2026-09-03T15:00:00.000Z', '210.000'),
      reading(datasetId, '22', '2026-09-03T15:15:00.000Z', '248.500'),
      reading(datasetId, '23', '2026-09-03T15:30:00.000Z', '267.250'),
      reading(datasetId, '24', '2026-09-03T15:45:00.000Z', '241.000'),
    ],
    historicalConsumption: [
      history(datasetId, '31', '2026-07-01', '2026-07-31', '142300.000'),
      history(datasetId, '32', '2026-08-01', '2026-08-31', '148750.500'),
    ],
  };
}

function consumptionCase(specialistSub: string): TechnicalSeedCase {
  const requestId = '6f1c2a10-4b7e-4a1d-9c31-a05000000002';
  const datasetId = '6f1c2a10-4b7e-4a1d-9c31-a05000000012';
  return {
    request: request(requestId, specialistSub, {
      ticketCode: 'PV-A05-002',
      customerId: 'CLI-A05-002',
      customerName: 'Alimentos Río Claro S.A.',
      facilityName: 'Complejo Girardot',
      assetId: 'MED-GIR-003',
      type: 'CONSUMO_ATIPICO',
      description:
        'Caso controlado para comparar el consumo del periodo de evaluación, en kWh, con los meses calendario anteriores. No almacena un umbral contractual ni un porcentaje de desviación.',
      periodStart: date('2026-09-01'),
      periodEnd: date('2026-09-30'),
    }),
    dataset: dataset(datasetId, requestId, null, '124800.000'),
    telemetry: [],
    historicalConsumption: [
      history(datasetId, '51', '2026-06-01', '2026-06-30', '98000.000'),
      history(datasetId, '52', '2026-07-01', '2026-07-31', '101250.000'),
      history(datasetId, '53', '2026-08-01', '2026-08-31', '99500.750'),
    ],
  };
}

function request(
  id: string,
  specialistSub: string,
  fields: Omit<
    TechnicalSeedRequest,
    'id' | 'assignedSpecialistSub' | 'status' | 'createdAt'
  >,
): TechnicalSeedRequest {
  return {
    id,
    assignedSpecialistSub: specialistSub,
    status: 'ASSIGNED',
    createdAt: CREATED_AT,
    ...fields,
  };
}

function dataset(
  id: string,
  postSaleRequestId: string,
  demandThreshold: string | null,
  evaluationConsumption: string | null,
): TechnicalSeedDataset {
  return {
    id,
    postSaleRequestId,
    demandThreshold,
    demandUnit: 'kW',
    evaluationConsumption,
    consumptionUnit: 'kWh',
    sourceName: 'Conjunto técnico controlado Act-05',
    sourceKind: 'local-controlled-dataset',
  };
}

function reading(
  datasetId: string,
  suffix: string,
  measuredAt: string,
  measuredDemand: string,
): TechnicalSeedReading {
  return {
    id: `6f1c2a10-4b7e-4a1d-9c31-a050000000${suffix}`,
    datasetId,
    measuredAt: new Date(measuredAt),
    measuredDemand,
  };
}

function history(
  datasetId: string,
  suffix: string,
  periodStart: string,
  periodEnd: string,
  consumption: string,
): TechnicalSeedHistory {
  return {
    id: `6f1c2a10-4b7e-4a1d-9c31-a050000000${suffix}`,
    datasetId,
    periodStart: date(periodStart),
    periodEnd: date(periodEnd),
    consumption,
  };
}

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function withoutId<T extends { id: string }>(value: T): Omit<T, 'id'> {
  const fields: Partial<T> = { ...value };
  delete fields.id;
  return fields as Omit<T, 'id'>;
}
