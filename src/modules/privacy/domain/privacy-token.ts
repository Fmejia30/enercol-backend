import { createHmac, randomBytes } from 'node:crypto';
import { prefixFor, type SensitiveCategory } from './sensitive-category.js';

export function createPrivacyToken(category: SensitiveCategory): string {
  return `[${prefixFor(category)}_${randomBytes(18).toString('base64url')}]`;
}

export const privacyTokens = {
  create: createPrivacyToken,
};

export function valueHmac(
  key: Buffer,
  category: SensitiveCategory,
  plaintext: string,
): string {
  return createHmac('sha256', key)
    .update(`${category}\0${plaintext}`)
    .digest('base64url');
}
