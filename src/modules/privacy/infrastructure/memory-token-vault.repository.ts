import type { SensitiveCategory } from '../domain/sensitive-category.js';
import type {
  MappingInsertResult,
  PrivacyContextRecord,
  TokenMappingRecord,
  TokenVaultRepository,
} from '../application/token-vault.repository.js';

export class MemoryTokenVaultRepository implements TokenVaultRepository {
  readonly contexts: PrivacyContextRecord[] = [];
  readonly mappings: TokenMappingRecord[] = [];

  createContext(record: PrivacyContextRecord): Promise<void> {
    if (
      this.contexts.some((context) => context.contextId === record.contextId)
    ) {
      return Promise.reject(new Error('duplicate context'));
    }
    this.contexts.push(record);
    return Promise.resolve();
  }

  findContext(contextId: string): Promise<PrivacyContextRecord | null> {
    return Promise.resolve(
      this.contexts.find((context) => context.contextId === contextId) ?? null,
    );
  }

  findByHmac(
    contextId: string,
    category: SensitiveCategory,
    valueHmac: string,
  ): Promise<TokenMappingRecord | null> {
    return Promise.resolve(
      this.mappings.find(
        (mapping) =>
          mapping.contextId === contextId &&
          mapping.category === category &&
          mapping.valueHmac === valueHmac,
      ) ?? null,
    );
  }

  findByToken(
    contextId: string,
    token: string,
  ): Promise<TokenMappingRecord | null> {
    return Promise.resolve(
      this.mappings.find(
        (mapping) => mapping.contextId === contextId && mapping.token === token,
      ) ?? null,
    );
  }

  insertMapping(record: TokenMappingRecord): Promise<MappingInsertResult> {
    if (
      this.mappings.some(
        (mapping) =>
          mapping.contextId === record.contextId &&
          mapping.category === record.category &&
          mapping.valueHmac === record.valueHmac,
      )
    ) {
      return Promise.resolve('value-exists');
    }
    if (this.mappings.some((mapping) => mapping.token === record.token)) {
      return Promise.resolve('token-collision');
    }
    this.mappings.push(record);
    return Promise.resolve('inserted');
  }
}
