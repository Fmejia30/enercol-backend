import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { PrivacyProtectionError } from '../domain/privacy-error.js';
import { AesGcmPrivacyCipher } from './aes-gcm-privacy-cipher.js';

const KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const SECRET = 'Textiles del Altiplano S.A.S.';

function cipher(key: string | null): AesGcmPrivacyCipher {
  return new AesGcmPrivacyCipher({
    get: (name: string) => (name === 'privacyEncryptionKey' ? key : null),
  } as ConfigService);
}

describe('AES-GCM privacy cipher', () => {
  it('round-trips a value and rejects a tampered tag or different context', () => {
    const privacy = cipher(KEY);
    const encrypted = privacy.encrypt(SECRET, 'context-a:customer');

    expect(privacy.decrypt(encrypted, 'context-a:customer')).toBe(SECRET);
    expect(encrypted.ciphertext).not.toBe(SECRET);
    expect(() =>
      privacy.decrypt(
        { ...encrypted, authTag: encrypted.iv },
        'context-a:customer',
      ),
    ).toThrow(PrivacyProtectionError);
    expect(() => privacy.decrypt(encrypted, 'context-b:customer')).toThrow(
      PrivacyProtectionError,
    );
  });

  it('fails closed without a key and does not reveal the value', () => {
    const privacy = cipher(null);
    expect(() => privacy.encrypt(SECRET, 'context:customer')).toThrow(
      PrivacyProtectionError,
    );
    try {
      privacy.encrypt(SECRET, 'context:customer');
    } catch (error) {
      expect(error).toBeInstanceOf(PrivacyProtectionError);
      expect(String(error)).not.toContain(SECRET);
      expect(String(error)).not.toContain(KEY);
    }
  });
});
