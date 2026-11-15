import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { TechnicalAnalysisService } from '../../post-sale-requests/application/technical-analysis.service.js';
import { PostSaleRequestService } from '../../post-sale-requests/application/post-sale-request.service.js';
import {
  classifyField,
  isExcludedField,
  isTechnicalField,
} from '../domain/field-classification.js';
import { assertOutboundSafe } from '../domain/outbound-validation.js';
import {
  MalformedPrivacyTokenError,
  PrivacyAuthorizationError,
  PrivacyProtectionError,
  UnknownPrivacyTokenError,
} from '../domain/privacy-error.js';
import { privacyTokens } from '../domain/privacy-token.js';
import {
  tokenLookalikePattern,
  wellFormedTokenPattern,
  type SensitiveCategory,
} from '../domain/sensitive-category.js';
import { findProtectedSpans } from '../domain/text-detection.js';
import { PRIVACY_CIPHER, type PrivacyCipher } from './privacy-cipher.js';
import {
  TOKEN_VAULT_REPOSITORY,
  type PrivacyContextRecord,
  type TokenVaultRepository,
} from './token-vault.repository.js';
import {
  allowlistedAnalysisTransfer,
  type AnalysisProtectionSource,
} from './analysis-transfer.js';

const TOKEN_ATTEMPTS = 5;

interface KnownSecret {
  readonly value: string;
  readonly category: SensitiveCategory;
}

interface TextReplacement {
  readonly start: number;
  readonly end: number;
  readonly token: string;
}

@Injectable()
export class PrivacyService {
  constructor(
    @Inject(TOKEN_VAULT_REPOSITORY)
    private readonly vault: TokenVaultRepository,
    @Inject(PRIVACY_CIPHER)
    private readonly cipher: PrivacyCipher,
    private readonly requests: PostSaleRequestService,
    private readonly analyses: TechnicalAnalysisService,
  ) {}

  async openContext(
    actor: AuthenticatedUser,
    requestId: string,
    analysisId: string | null,
  ): Promise<string> {
    await this.assertOwnership(actor, requestId, analysisId);
    const contextId = randomUUID();
    try {
      await this.vault.createContext({
        contextId,
        requestId,
        analysisId,
        createdAt: new Date(),
      });
      return contextId;
    } catch (error) {
      throw this.asProtection(error);
    }
  }

  async tokenizeObject(
    actor: AuthenticatedUser,
    contextId: string,
    value: unknown,
  ): Promise<unknown> {
    const context = await this.requireContext(actor, contextId);
    const secrets = collectFieldSecrets(value);
    const redactions = collectExcludedValues(value);
    try {
      const protectedValue = await this.transform(
        context.contextId,
        value,
        [],
        secrets,
        redactions,
      );
      assertOutboundSafe(protectedValue, [
        ...secrets.map((secret) => secret.value),
        ...redactions,
      ]);
      return protectedValue;
    } catch (error) {
      throw this.asProtection(error);
    }
  }

  async tokenizeFields(
    actor: AuthenticatedUser,
    contextId: string,
    fields: Readonly<Record<string, string>>,
  ): Promise<Record<string, string>> {
    const context = await this.requireContext(actor, contextId);
    if (Object.keys(fields).some((key) => isExcludedField(key))) {
      throw new PrivacyProtectionError();
    }
    try {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(fields)) {
        const category = classifyField(key);
        if (category) {
          result[key] = await this.issue(context.contextId, category, value);
          continue;
        }
        if (isTechnicalField(key)) {
          result[key] = value;
          continue;
        }
        result[key] = await this.protectText(context.contextId, value, [], []);
      }
      assertOutboundSafe(
        result,
        Object.entries(fields)
          .filter(([key]) => classifyField(key))
          .map(([, value]) => value),
      );
      return result;
    } catch (error) {
      throw this.asProtection(error);
    }
  }

  detectProtectedValues(text: string): ReturnType<typeof findProtectedSpans> {
    return findProtectedSpans(text);
  }

  async detokenizeObject(
    actor: AuthenticatedUser,
    contextId: string,
    value: unknown,
  ): Promise<unknown> {
    const context = await this.requireContext(actor, contextId);
    try {
      const structured = structuredValue(value);
      const tokens = new Set<string>();
      collectTokens(structured, tokens);
      const resolved = new Map<string, string>();
      for (const token of tokens) {
        const mapping = await this.vault.findByToken(context.contextId, token);
        if (!mapping) {
          throw new UnknownPrivacyTokenError();
        }
        resolved.set(
          token,
          this.cipher.decrypt(
            mapping,
            `${context.contextId}:${mapping.category}`,
          ),
        );
      }
      return replaceTokens(structured, resolved);
    } catch (error) {
      throw this.asProtection(error);
    }
  }

  async protectAnalysisTransfer(
    actor: AuthenticatedUser,
    source: AnalysisProtectionSource,
  ): Promise<{ contextId: string; payload: unknown }> {
    const transfer = allowlistedAnalysisTransfer(source);
    const contextId = await this.openContext(
      actor,
      source.request.id,
      source.analysis.id,
    );
    try {
      const payload = await this.transform(
        contextId,
        transfer.payload,
        [],
        transfer.secrets,
        transfer.redactions,
      );
      assertOutboundSafe(payload, transfer.prohibited);
      return { contextId, payload };
    } catch (error) {
      throw this.asProtection(error);
    }
  }

  validateOutbound(payload: unknown, prohibited: readonly string[]): void {
    assertOutboundSafe(payload, prohibited);
  }

  private async requireContext(
    actor: AuthenticatedUser,
    contextId: string,
  ): Promise<PrivacyContextRecord> {
    let context: PrivacyContextRecord | null;
    try {
      context = await this.vault.findContext(contextId);
    } catch (error) {
      throw this.asProtection(error);
    }
    if (!context) {
      throw new PrivacyAuthorizationError();
    }
    await this.assertOwnership(actor, context.requestId, context.analysisId);
    return context;
  }

  private async assertOwnership(
    actor: AuthenticatedUser,
    requestId: string,
    analysisId: string | null,
  ): Promise<void> {
    try {
      await this.requests.get(actor, requestId);
      if (!analysisId) {
        return;
      }
      const records = await this.analyses.list(actor, requestId);
      if (!records.some((record) => record.id === analysisId)) {
        throw new PrivacyAuthorizationError();
      }
    } catch (error) {
      if (error instanceof PrivacyAuthorizationError) {
        throw error;
      }
      throw new PrivacyAuthorizationError();
    }
  }

  private async transform(
    contextId: string,
    value: unknown,
    path: string[],
    secrets: readonly KnownSecret[],
    redactions: readonly string[],
  ): Promise<unknown> {
    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    if (typeof value === 'string') {
      const key = fieldKey(path);
      if (key && isTechnicalField(key)) {
        return value;
      }
      const category = key ? classifyField(key) : null;
      if (category) {
        return this.issue(contextId, category, value);
      }
      return this.protectText(contextId, value, secrets, redactions);
    }
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        items.push(
          await this.transform(
            contextId,
            value[index],
            [...path, String(index)],
            secrets,
            redactions,
          ),
        );
      }
      return items;
    }
    if (typeof value === 'object') {
      if (value instanceof Date) {
        throw new PrivacyProtectionError();
      }
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        if (child === undefined || isExcludedField(key)) {
          continue;
        }
        result[key] = await this.transform(
          contextId,
          child,
          [...path, key],
          secrets,
          redactions,
        );
      }
      return result;
    }
    throw new PrivacyProtectionError();
  }

  private async protectText(
    contextId: string,
    text: string,
    secrets: readonly KnownSecret[],
    redactions: readonly string[],
  ): Promise<string> {
    const replacements: TextReplacement[] = [];
    const occupied: Array<{ start: number; end: number }> = [];
    const claim = (start: number, end: number, token: string): void => {
      if (overlaps(occupied, start, end)) {
        return;
      }
      occupied.push({ start, end });
      replacements.push({ start, end, token });
    };

    for (const redaction of redactions) {
      if (redaction.length < 4) {
        continue;
      }
      for (const range of locate(text, redaction)) {
        claim(range.start, range.end, '');
      }
    }

    const ordered = [...secrets].sort(
      (left, right) => right.value.length - left.value.length,
    );
    for (const secret of ordered) {
      if (secret.value.length < 4) {
        continue;
      }
      for (const range of locate(text, secret.value)) {
        if (overlaps(occupied, range.start, range.end)) {
          continue;
        }
        claim(
          range.start,
          range.end,
          await this.issue(contextId, secret.category, secret.value),
        );
      }
    }

    for (const span of findProtectedSpans(text)) {
      if (overlaps(occupied, span.start, span.end)) {
        continue;
      }
      claim(
        span.start,
        span.end,
        await this.issue(contextId, span.category, span.value),
      );
    }

    let result = text;
    for (const replacement of replacements.sort(
      (left, right) => right.start - left.start,
    )) {
      result =
        result.slice(0, replacement.start) +
        replacement.token +
        result.slice(replacement.end);
    }
    return result;
  }

  private async issue(
    contextId: string,
    category: SensitiveCategory,
    plaintext: string,
  ): Promise<string> {
    if (plaintext.length === 0) {
      return plaintext;
    }
    const hmac = this.cipher.hmac(category, plaintext);
    const existing = await this.vault.findByHmac(contextId, category, hmac);
    if (existing) {
      return existing.token;
    }
    const aad = `${contextId}:${category}`;
    for (let attempt = 0; attempt < TOKEN_ATTEMPTS; attempt += 1) {
      const token = privacyTokens.create(category);
      const encrypted = this.cipher.encrypt(plaintext, aad);
      const result = await this.vault.insertMapping({
        contextId,
        category,
        token,
        valueHmac: hmac,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        ciphertext: encrypted.ciphertext,
        createdAt: new Date(),
      });
      if (result === 'inserted') {
        return token;
      }
      if (result === 'value-exists') {
        const winner = await this.vault.findByHmac(contextId, category, hmac);
        if (winner) {
          return winner.token;
        }
      }
    }
    throw new PrivacyProtectionError();
  }

  private asProtection(error: unknown): Error {
    if (
      error instanceof PrivacyProtectionError ||
      error instanceof PrivacyAuthorizationError ||
      error instanceof UnknownPrivacyTokenError ||
      error instanceof MalformedPrivacyTokenError
    ) {
      return error;
    }
    return new PrivacyProtectionError();
  }
}

function collectFieldSecrets(value: unknown): KnownSecret[] {
  const secrets: KnownSecret[] = [];
  walkFields(value, (key, child) => {
    const category = classifyField(key);
    if (category && child.length > 0) {
      secrets.push({ value: child, category });
    }
  });
  return secrets;
}

function collectExcludedValues(value: unknown): string[] {
  const redactions: string[] = [];
  walkFields(value, (key, child) => {
    if (isExcludedField(key) && child.length > 0) {
      redactions.push(child);
    }
  });
  return redactions;
}

function walkFields(
  value: unknown,
  visit: (key: string, child: string) => void,
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkFields(item, visit);
    }
    return;
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string') {
        visit(key, child);
      }
      walkFields(child, visit);
    }
  }
}

function fieldKey(path: readonly string[]): string | null {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const key = path[index];
    if (key && !/^\d+$/.test(key)) {
      return key;
    }
  }
  return null;
}

function locate(
  text: string,
  secret: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= text.length) {
    const start = text.indexOf(secret, from);
    if (start < 0) {
      break;
    }
    const end = start + secret.length;
    if (isolated(text, start, end, secret)) {
      ranges.push({ start, end });
    }
    from = end;
  }
  return ranges;
}

function isolated(
  text: string,
  start: number,
  end: number,
  secret: string,
): boolean {
  const before = text[start - 1] ?? '';
  const after = text[end] ?? '';
  if (/^\d+$/.test(secret)) {
    return !/[\d.]/.test(before) && !/[\d.]/.test(after);
  }
  return (
    !/[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]/.test(before) &&
    !/[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]/.test(after)
  );
}

function overlaps(
  ranges: readonly { start: number; end: number }[],
  start: number,
  end: number,
): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

function structuredValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new MalformedPrivacyTokenError();
  }
}

function collectTokens(value: unknown, tokens: Set<string>): void {
  if (typeof value === 'string') {
    const lookalikes = value.match(tokenLookalikePattern()) ?? [];
    const wellFormed = new Set(value.match(wellFormedTokenPattern()) ?? []);
    for (const candidate of lookalikes) {
      if (!wellFormed.has(candidate)) {
        throw new MalformedPrivacyTokenError();
      }
      tokens.add(candidate);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTokens(item, tokens);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      collectTokens(child, tokens);
    }
  }
}

function replaceTokens(
  value: unknown,
  resolved: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === 'string') {
    return value.replace(wellFormedTokenPattern(), (token) => {
      const original = resolved.get(token);
      if (original === undefined) {
        throw new UnknownPrivacyTokenError();
      }
      return original;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceTokens(item, resolved));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        replaceTokens(child, resolved),
      ]),
    );
  }
  return value;
}
