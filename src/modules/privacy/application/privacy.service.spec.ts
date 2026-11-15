import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { PostSaleRequestNotFoundError } from '../../post-sale-requests/domain/post-sale-request-error.js';
import { createPostSaleRequest } from '../../post-sale-requests/domain/post-sale-request.js';
import type { PostSaleRequestService } from '../../post-sale-requests/application/post-sale-request.service.js';
import type { TechnicalAnalysisService } from '../../post-sale-requests/application/technical-analysis.service.js';
import type { AnalysisProtectionSource } from './analysis-transfer.js';
import { PrivacyService } from './privacy.service.js';
import { AesGcmPrivacyCipher } from '../infrastructure/aes-gcm-privacy-cipher.js';
import { MemoryTokenVaultRepository } from '../infrastructure/memory-token-vault.repository.js';
import {
  MalformedPrivacyTokenError,
  PrivacyAuthorizationError,
  PrivacyProtectionError,
  UnknownPrivacyTokenError,
} from '../domain/privacy-error.js';
import { createPrivacyToken, privacyTokens } from '../domain/privacy-token.js';

const KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ANALYSIS_ID = '22222222-2222-4222-8222-222222222222';
const SPECIALIST_SUB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_SUB = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const CUSTOMER = 'Textiles del Altiplano S.A.S.';
const DEMAND =
  'La demanda máxima medida es 267.250 kW y el umbral contractual es 250.000 kW. La diferencia es 17.250 kW (6.900 %).';

const actor: AuthenticatedUser = {
  userId: 'specialist-1',
  roles: [UserRole.SPECIALIST],
};

function cipher(): AesGcmPrivacyCipher {
  return new AesGcmPrivacyCipher({
    get: (name: string) => (name === 'privacyEncryptionKey' ? KEY : null),
  } as ConfigService);
}

function service(
  vault = new MemoryTokenVaultRepository(),
  visible = true,
): {
  privacy: PrivacyService;
  vault: MemoryTokenVaultRepository;
  requests: { get: jest.Mock };
  analyses: { list: jest.Mock };
} {
  const requests = {
    get: jest.fn(async (current: AuthenticatedUser, id: string) => {
      if (!visible || current.userId !== actor.userId || id !== REQUEST_ID) {
        throw new PostSaleRequestNotFoundError();
      }
      return { id };
    }),
  };
  const analyses = {
    list: jest.fn(async () => [{ id: ANALYSIS_ID }]),
  };
  return {
    privacy: new PrivacyService(
      vault,
      cipher(),
      requests as unknown as PostSaleRequestService,
      analyses as unknown as TechnicalAnalysisService,
    ),
    vault,
    requests,
    analyses,
  };
}

function source(options?: {
  description?: string;
  measuredDemand?: string;
}): AnalysisProtectionSource {
  const description = options?.description ?? `Caso de ${CUSTOMER}.`;
  const measuredDemand = options?.measuredDemand ?? '267.250';
  return {
    request: createPostSaleRequest({
      id: REQUEST_ID,
      ticketCode: 'PV-A05-001',
      customerId: 'CLI-A05-001',
      customerName: CUSTOMER,
      facilityName: 'Planta Fontibón',
      assetId: 'MED-FTB-014',
      assignedSpecialistSub: SPECIALIST_SUB,
      type: 'VERIFICACION_DEMANDA',
      description,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-07',
      status: 'ABIERTA',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    }),
    assignedSpecialist: { firstName: 'Camila', lastName: 'Rivas' },
    dataset: {
      demandThreshold: '250.000',
      demandUnit: 'kW',
      evaluationConsumption: null,
      consumptionUnit: 'kWh',
      sourceName: 'Conjunto técnico controlado Act-05',
      sourceKind: 'local-controlled-dataset',
      telemetry: [
        {
          measuredAt: '2026-09-03T15:30:00.000Z',
          measuredDemand,
        },
      ],
      historicalConsumption: [],
    },
    analysis: {
      id: ANALYSIS_ID,
      status: 'SUCCEEDED',
      executedAt: '2026-09-08T14:00:00.000Z',
      executedBySub: OTHER_SUB,
      failureMessage: null,
      findings: [
        {
          findingType: 'DEMAND_EXCEEDANCE',
          description: DEMAND,
          measuredValue: '267.250',
          referenceValue: '250.000',
          difference: '17.250',
          percentage: '6.900',
          unit: 'kW',
          interpretation: 'confirmed-observation',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-07',
          evidence: [
            {
              label: 'Lectura de demanda',
              value: '267.250',
              unit: 'kW',
              measuredAt: '2026-09-03T15:30:00.000Z',
              periodStart: null,
              periodEnd: null,
            },
          ],
        },
      ],
      inputSnapshot: {
        requestType: 'VERIFICACION_DEMANDA',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-07',
        demandThreshold: '250.000',
        demandUnit: 'kW',
        evaluationConsumption: null,
        consumptionUnit: 'kWh',
        telemetry: [
          {
            measuredAt: '2026-09-03T15:30:00.000Z',
            measuredDemand,
          },
        ],
        historicalConsumption: [],
      },
    },
  };
}

describe('PrivacyService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('classifies known fields, preserves measurements, and omits authentication identifiers', async () => {
    const { privacy, vault } = service();
    const original = source({
      description: `Contacto ada@example.com, +57 301 555 0199, DPI 1234 56789 0101, NIT 900.123.456-7, Calle 26 # 92-32, contrato número CTR-2026-014. Referencia ${SPECIALIST_SUB}.`,
    });
    const before = JSON.stringify(original);

    const protectedTransfer = await privacy.protectAnalysisTransfer(
      actor,
      original,
    );

    expect(JSON.stringify(original)).toBe(before);
    const serialized = JSON.stringify(protectedTransfer.payload);
    expect(serialized).toContain('267.250');
    expect(serialized).toContain('250.000');
    expect(serialized).toContain('17.250');
    expect(serialized).toContain('6.900');
    expect(serialized).toContain('kW');
    expect(serialized).toContain('2026-09-03T15:30:00.000Z');
    expect(serialized).toContain('confirmed-observation');
    expect(serialized).not.toContain(CUSTOMER);
    expect(serialized).not.toContain('CLI-A05-001');
    expect(serialized).not.toContain('MED-FTB-014');
    expect(serialized).not.toContain('PV-A05-001');
    expect(serialized).not.toContain('Planta Fontibón');
    expect(serialized).not.toContain('Camila');
    expect(serialized).not.toContain('ada@example.com');
    expect(serialized).not.toContain(SPECIALIST_SUB);
    expect(serialized).not.toContain(OTHER_SUB);
    expect(serialized).not.toContain('assignedSpecialistSub');
    expect(serialized).not.toContain('executedBySub');
    expect(vault.mappings.every((mapping) => !('value' in mapping))).toBe(true);
    expect(
      vault.mappings.some((mapping) => mapping.ciphertext === CUSTOMER),
    ).toBe(false);
    const revealed = vault.mappings.map((mapping) =>
      cipher().decrypt(mapping, `${mapping.contextId}:${mapping.category}`),
    );
    expect(revealed).toContain(CUSTOMER);
    expect(revealed).not.toContain(SPECIALIST_SUB);
    expect(revealed).not.toContain(OTHER_SUB);
  });

  it('reuses one unpredictable token for the same value and isolates contexts', async () => {
    const { privacy } = service();
    const first = await privacy.openContext(actor, REQUEST_ID, ANALYSIS_ID);
    const second = await privacy.openContext(actor, REQUEST_ID, null);
    const left = await privacy.tokenizeFields(actor, first, {
      customerName: CUSTOMER,
      email: 'ada@example.com',
    });
    const again = await privacy.tokenizeFields(actor, first, {
      customerName: CUSTOMER,
    });
    const other = await privacy.tokenizeFields(actor, second, {
      customerName: CUSTOMER,
    });

    expect(left.customerName).toBe(again.customerName);
    expect(left.customerName).not.toBe(other.customerName);
    expect(left.customerName).not.toContain(CUSTOMER);
    expect(left.customerName).not.toContain(
      createHash('sha256').update(CUSTOMER).digest('hex').slice(0, 12),
    );
    expect(left.email).not.toBe(left.customerName);

    const nested = {
      notes: [left.customerName, { again: left.customerName }],
      measuredDemand: '267.250',
    };
    const restored = await privacy.detokenizeObject(actor, first, nested);
    expect(restored).toEqual({
      notes: [CUSTOMER, { again: CUSTOMER }],
      measuredDemand: '267.250',
    });
    await expect(
      privacy.detokenizeObject(actor, second, nested),
    ).rejects.toBeInstanceOf(UnknownPrivacyTokenError);
  });

  it('rejects unknown, malformed, and unauthorized token resolution', async () => {
    const { privacy, vault } = service();
    const contextId = await privacy.openContext(actor, REQUEST_ID, null);
    const lookups = jest.spyOn(vault, 'findByToken');
    await expect(
      privacy.detokenizeObject(actor, contextId, {
        note: '[CUSTOMER_aaaaaaaaaaaaaaaaaaaaaaaa]',
      }),
    ).rejects.toBeInstanceOf(UnknownPrivacyTokenError);
    lookups.mockClear();
    await expect(
      privacy.detokenizeObject(actor, contextId, {
        note: '[CUSTOMER_short]',
      }),
    ).rejects.toBeInstanceOf(MalformedPrivacyTokenError);
    await expect(
      privacy.detokenizeObject(actor, contextId, '{"note":'),
    ).rejects.toBeInstanceOf(MalformedPrivacyTokenError);
    expect(lookups).not.toHaveBeenCalled();
    await expect(
      privacy.detokenizeObject(
        { userId: 'other', roles: [UserRole.SPECIALIST] },
        contextId,
        { note: 'sin token' },
      ),
    ).rejects.toBeInstanceOf(PrivacyAuthorizationError);
  });

  it('fails closed before returning an unsafe or partial payload', async () => {
    const vault = new MemoryTokenVaultRepository();
    const { privacy } = service(vault);
    const originalInsert = vault.insertMapping.bind(vault);
    vault.insertMapping = (record) => {
      if (record.category === 'meter') {
        return Promise.reject(new Error('write failed'));
      }
      return originalInsert(record);
    };
    const logs: string[] = [];
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        logs.push(args.map((arg) => String(arg)).join(' '));
      });
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(
      privacy.protectAnalysisTransfer(actor, source()),
    ).rejects.toBeInstanceOf(PrivacyProtectionError);
    try {
      await privacy.protectAnalysisTransfer(actor, source());
    } catch (error) {
      expect(String(error)).not.toContain(CUSTOMER);
      expect(String(error)).not.toContain('MED-FTB-014');
      expect(String(error)).not.toContain('write failed');
    }
    expect(logs.join(' ')).not.toContain(CUSTOMER);
    expect(loggerSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();

    const blocked = service();
    await expect(
      blocked.privacy.protectAnalysisTransfer(
        actor,
        source({ measuredDemand: 'CLI-A05-001' }),
      ),
    ).rejects.toBeInstanceOf(PrivacyProtectionError);
  });

  it('tokenizes explicit fields and refuses an authentication field', async () => {
    const { privacy } = service();
    const contextId = await privacy.openContext(actor, REQUEST_ID, null);
    const tokenized = await privacy.tokenizeFields(actor, contextId, {
      firstName: 'Camila',
      lastName: 'Rivas',
      phoneNumber: '301 555 0199',
      demandThreshold: '250.000',
      description: 'El umbral sigue en 250.000 kW.',
    });

    expect(tokenized.firstName).toMatch(/^\[PERSON_/);
    expect(tokenized.lastName).toMatch(/^\[PERSON_/);
    expect(tokenized.phoneNumber).toMatch(/^\[PHONE_/);
    expect(tokenized.demandThreshold).toBe('250.000');
    expect(tokenized.description).toBe('El umbral sigue en 250.000 kW.');
    await expect(
      privacy.tokenizeFields(actor, contextId, {
        cognitoSub: SPECIALIST_SUB,
      }),
    ).rejects.toBeInstanceOf(PrivacyProtectionError);
  });

  it('stores a Guatemalan phone unchanged and restores that exact value', async () => {
    const { privacy, vault } = service();
    const contextId = await privacy.openContext(actor, REQUEST_ID, null);
    const description = 'Llamar a +502 5555 1234 o al 4210-8891.';
    const tokenized = await privacy.tokenizeObject(actor, contextId, {
      description,
      demandThreshold: '267.250',
    });

    expect(JSON.stringify(tokenized)).not.toContain('+502 5555 1234');
    expect(JSON.stringify(tokenized)).not.toContain('4210-8891');
    expect(JSON.stringify(tokenized)).toContain('267.250');
    await expect(
      privacy.detokenizeObject(actor, contextId, tokenized),
    ).resolves.toEqual({
      description,
      demandThreshold: '267.250',
    });
    const restoredPhones = vault.mappings
      .filter((mapping) => mapping.category === 'phone')
      .map((mapping) =>
        cipher().decrypt(mapping, `${mapping.contextId}:${mapping.category}`),
      );
    expect(restoredPhones).toEqual(
      expect.arrayContaining(['+502 5555 1234', '4210-8891']),
    );
  });

  it('retries a colliding token and keeps technical numbers out of the vault', async () => {
    const vault = new MemoryTokenVaultRepository();
    const { privacy } = service(vault);
    const contextId = await privacy.openContext(actor, REQUEST_ID, null);
    const collided = `[CUSTOMER_${'a'.repeat(24)}]`;
    jest
      .spyOn(privacyTokens, 'create')
      .mockImplementationOnce(() => collided)
      .mockImplementation((category) => createPrivacyToken(category));
    await vault.insertMapping({
      contextId,
      category: 'customer',
      token: collided,
      valueHmac: 'different-hmac',
      iv: 'iv',
      authTag: 'tag',
      ciphertext: 'cipher',
      createdAt: new Date(),
    });

    const tokenized = await privacy.tokenizeObject(actor, contextId, {
      customerName: CUSTOMER,
      demandThreshold: '267.250',
      measuredAt: '2026-09-03T15:30:00.000Z',
    });

    expect(tokenized).toMatchObject({
      demandThreshold: '267.250',
      measuredAt: '2026-09-03T15:30:00.000Z',
    });
    const customerToken = (tokenized as { customerName: string }).customerName;
    expect(customerToken).not.toBe(collided);
    expect(vault.mappings.map((mapping) => mapping.token)).toContain(
      customerToken,
    );
  });
});
