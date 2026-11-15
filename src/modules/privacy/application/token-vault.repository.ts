import type { SensitiveCategory } from '../domain/sensitive-category.js';

export interface PrivacyContextRecord {
  readonly contextId: string;
  readonly requestId: string;
  readonly analysisId: string | null;
  readonly createdAt: Date;
}

export interface TokenMappingRecord {
  readonly contextId: string;
  readonly category: SensitiveCategory;
  readonly token: string;
  readonly valueHmac: string;
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
  readonly createdAt: Date;
}

export type MappingInsertResult =
  'inserted' | 'token-collision' | 'value-exists';

export interface TokenVaultRepository {
  createContext(record: PrivacyContextRecord): Promise<void>;
  findContext(contextId: string): Promise<PrivacyContextRecord | null>;
  findByHmac(
    contextId: string,
    category: SensitiveCategory,
    valueHmac: string,
  ): Promise<TokenMappingRecord | null>;
  findByToken(
    contextId: string,
    token: string,
  ): Promise<TokenMappingRecord | null>;
  insertMapping(record: TokenMappingRecord): Promise<MappingInsertResult>;
}

export const TOKEN_VAULT_REPOSITORY = Symbol('TOKEN_VAULT_REPOSITORY');
