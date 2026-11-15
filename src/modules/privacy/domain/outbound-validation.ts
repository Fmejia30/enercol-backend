import { findProtectedSpans } from './text-detection.js';
import { wellFormedTokenPattern } from './sensitive-category.js';
import { PrivacyProtectionError } from './privacy-error.js';

const MINIMUM_SECRET_LENGTH = 4;

export function assertOutboundSafe(
  payload: unknown,
  prohibited: readonly string[],
): void {
  const texts = collectStrings(payload);
  for (const secret of prohibited) {
    if (secret.length < MINIMUM_SECRET_LENGTH) {
      continue;
    }
    if (texts.some((text) => text.includes(secret))) {
      throw new PrivacyProtectionError();
    }
  }
  for (const text of texts) {
    const masked = text.replace(wellFormedTokenPattern(), (token) =>
      ' '.repeat(token.length),
    );
    if (findProtectedSpans(masked).length > 0) {
      throw new PrivacyProtectionError();
    }
  }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap((item) => collectStrings(item));
  }
  return [];
}
