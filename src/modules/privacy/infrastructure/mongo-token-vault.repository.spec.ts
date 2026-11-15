import { beforeAll, describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { MongoClient } from 'mongodb';
import { AesGcmPrivacyCipher } from './aes-gcm-privacy-cipher.js';
import { MongoTokenVaultRepository } from './mongo-token-vault.repository.js';
import { PrivacyProtectionError } from '../domain/privacy-error.js';

const TEST_URI = 'mongodb://127.0.0.1:27017';
const TEST_DB = 'enercol_privacy_test';
const KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const SECRET = 'Textiles del Altiplano S.A.S.';

async function localMongoAvailable(): Promise<boolean> {
  const client = new MongoClient(TEST_URI, { serverSelectionTimeoutMS: 400 });
  try {
    await client.connect();
    await client.db(TEST_DB).command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close().catch(() => undefined);
  }
}

describe('Mongo token vault', () => {
  let available = false;

  beforeAll(async () => {
    available = await localMongoAvailable();
  }, 10_000);

  it('stores encrypted mappings and refuses a token from another context', async () => {
    if (!available) {
      return;
    }
    const repository = new MongoTokenVaultRepository({
      get: (name: string) => {
        if (name === 'mongodbUri') {
          return TEST_URI;
        }
        if (name === 'mongodbDbName') {
          return TEST_DB;
        }
        return null;
      },
    } as ConfigService);
    const cipher = new AesGcmPrivacyCipher({
      get: (name: string) => (name === 'privacyEncryptionKey' ? KEY : null),
    } as ConfigService);
    const contextId = `test-${Date.now()}`;
    const otherContextId = `${contextId}-other`;
    try {
      await repository.createContext({
        contextId,
        requestId: 'request-test',
        analysisId: 'analysis-test',
        createdAt: new Date(),
      });
      await repository.createContext({
        contextId: otherContextId,
        requestId: 'request-other',
        analysisId: null,
        createdAt: new Date(),
      });
      const encrypted = cipher.encrypt(SECRET, `${contextId}:customer`);
      const token = `[CUSTOMER_${'b'.repeat(24)}]`;
      const inserted = await repository.insertMapping({
        contextId,
        category: 'customer',
        token,
        valueHmac: cipher.hmac('customer', SECRET),
        ...encrypted,
        createdAt: new Date(),
      });
      expect(inserted).toBe('inserted');
      expect(
        await repository.insertMapping({
          contextId,
          category: 'customer',
          token: `[CUSTOMER_${'c'.repeat(24)}]`,
          valueHmac: cipher.hmac('customer', SECRET),
          ...encrypted,
          createdAt: new Date(),
        }),
      ).toBe('value-exists');
      expect(
        await repository.insertMapping({
          contextId: otherContextId,
          category: 'customer',
          token,
          valueHmac: cipher.hmac('customer', 'other'),
          ...cipher.encrypt('other', `${otherContextId}:customer`),
          createdAt: new Date(),
        }),
      ).toBe('token-collision');

      const stored = await repository.findByToken(contextId, token);
      expect(stored?.ciphertext).not.toBe(SECRET);
      expect(stored && 'value' in stored).toBe(false);
      expect(stored && cipher.decrypt(stored, `${contextId}:customer`)).toBe(
        SECRET,
      );
      expect(await repository.findByToken(otherContextId, token)).toBeNull();
      await expect(
        repository.findContext('missing-context'),
      ).resolves.toBeNull();
    } finally {
      const cleanup = new MongoClient(TEST_URI, {
        serverSelectionTimeoutMS: 400,
      });
      await cleanup.connect();
      const database = cleanup.db(TEST_DB);
      await database.collection('privacy_contexts').deleteMany({
        contextId: { $in: [contextId, otherContextId] },
      });
      await database.collection('privacy_token_mappings').deleteMany({
        contextId: { $in: [contextId, otherContextId] },
      });
      await cleanup.close();
      await repository.onModuleDestroy();
    }
  });

  it('does not include a connection failure detail in the privacy error', async () => {
    const repository = new MongoTokenVaultRepository({
      get: (name: string) => (name === 'mongodbUri' ? TEST_URI : TEST_DB),
    } as ConfigService);
    if (available) {
      await repository.onModuleDestroy();
      return;
    }
    await expect(
      repository.createContext({
        contextId: 'unavailable',
        requestId: 'request',
        analysisId: null,
        createdAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(PrivacyProtectionError);
  });
});
