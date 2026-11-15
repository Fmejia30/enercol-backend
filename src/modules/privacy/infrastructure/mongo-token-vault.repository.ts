import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MongoServerError,
  type Collection,
  type Db,
  MongoClient,
} from 'mongodb';
import type { SensitiveCategory } from '../domain/sensitive-category.js';
import { PrivacyProtectionError } from '../domain/privacy-error.js';
import type {
  MappingInsertResult,
  PrivacyContextRecord,
  TokenMappingRecord,
  TokenVaultRepository,
} from '../application/token-vault.repository.js';

const CONTEXTS = 'privacy_contexts';
const MAPPINGS = 'privacy_token_mappings';

@Injectable()
export class MongoTokenVaultRepository
  implements TokenVaultRepository, OnModuleDestroy
{
  private client: MongoClient | null = null;
  private database: Promise<Db> | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.database = null;
  }

  async createContext(record: PrivacyContextRecord): Promise<void> {
    try {
      await (await this.contexts()).insertOne({ ...record });
    } catch {
      throw new PrivacyProtectionError();
    }
  }

  async findContext(contextId: string): Promise<PrivacyContextRecord | null> {
    try {
      const document = await (
        await this.contexts()
      ).findOne({ contextId }, { projection: { _id: 0 } });
      return document ? toContext(document) : null;
    } catch {
      throw new PrivacyProtectionError();
    }
  }

  async findByHmac(
    contextId: string,
    category: SensitiveCategory,
    valueHmac: string,
  ): Promise<TokenMappingRecord | null> {
    try {
      const document = await (
        await this.mappings()
      ).findOne({ contextId, category, valueHmac }, { projection: { _id: 0 } });
      return document ? toMapping(document) : null;
    } catch {
      throw new PrivacyProtectionError();
    }
  }

  async findByToken(
    contextId: string,
    token: string,
  ): Promise<TokenMappingRecord | null> {
    try {
      const document = await (
        await this.mappings()
      ).findOne({ contextId, token }, { projection: { _id: 0 } });
      return document ? toMapping(document) : null;
    } catch {
      throw new PrivacyProtectionError();
    }
  }

  async insertMapping(
    record: TokenMappingRecord,
  ): Promise<MappingInsertResult> {
    try {
      await (await this.mappings()).insertOne({ ...record });
      return 'inserted';
    } catch (error) {
      if (!isDuplicate(error)) {
        throw new PrivacyProtectionError();
      }
      const pattern = duplicatePattern(error);
      if (pattern.includes('valueHmac')) {
        return 'value-exists';
      }
      if (pattern.includes('token')) {
        return 'token-collision';
      }
      throw new PrivacyProtectionError();
    }
  }

  private contexts(): Promise<Collection> {
    return this.collection(CONTEXTS);
  }

  private mappings(): Promise<Collection> {
    return this.collection(MAPPINGS);
  }

  private async collection(name: string): Promise<Collection> {
    const database = await this.connect();
    return database.collection(name);
  }

  private connect(): Promise<Db> {
    if (!this.database) {
      this.database = this.open();
    }
    return this.database;
  }

  private async open(): Promise<Db> {
    const uri = this.configService.get<string | null>('mongodbUri');
    const name =
      this.configService.get<string>('mongodbDbName') ?? 'enercol_privacy';
    if (!uri) {
      throw new PrivacyProtectionError();
    }
    try {
      const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 2_000,
      });
      await client.connect();
      this.client = client;
      const database = client.db(name);
      await database
        .collection(CONTEXTS)
        .createIndex(
          { contextId: 1 },
          { unique: true, name: 'privacy_context_id' },
        );
      await database
        .collection(MAPPINGS)
        .createIndex({ token: 1 }, { unique: true, name: 'privacy_token' });
      await database
        .collection(MAPPINGS)
        .createIndex(
          { contextId: 1, category: 1, valueHmac: 1 },
          { unique: true, name: 'privacy_context_value' },
        );
      await database
        .collection(MAPPINGS)
        .createIndex({ contextId: 1 }, { name: 'privacy_context' });
      return database;
    } catch (error) {
      this.database = null;
      if (error instanceof PrivacyProtectionError) {
        throw error;
      }
      throw new PrivacyProtectionError();
    }
  }
}

function isDuplicate(error: unknown): error is MongoServerError {
  return error instanceof MongoServerError && error.code === 11000;
}

function duplicatePattern(error: MongoServerError): string {
  const pattern: unknown = error['keyPattern'];
  if (pattern && typeof pattern === 'object') {
    return Object.keys(pattern).join(',');
  }
  return '';
}

function toContext(document: Record<string, unknown>): PrivacyContextRecord {
  return {
    contextId: requiredString(document['contextId']),
    requestId: requiredString(document['requestId']),
    analysisId:
      typeof document['analysisId'] === 'string'
        ? document['analysisId']
        : null,
    createdAt: requiredDate(document['createdAt']),
  };
}

function toMapping(document: Record<string, unknown>): TokenMappingRecord {
  return {
    contextId: requiredString(document['contextId']),
    category: requiredString(document['category']) as SensitiveCategory,
    token: requiredString(document['token']),
    valueHmac: requiredString(document['valueHmac']),
    iv: requiredString(document['iv']),
    authTag: requiredString(document['authTag']),
    ciphertext: requiredString(document['ciphertext']),
    createdAt: requiredDate(document['createdAt']),
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PrivacyProtectionError();
  }
  return value;
}

function requiredDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  throw new PrivacyProtectionError();
}
