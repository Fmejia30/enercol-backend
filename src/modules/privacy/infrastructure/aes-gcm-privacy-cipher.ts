import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  EncryptedValue,
  PrivacyCipher,
} from '../application/privacy-cipher.js';
import { PrivacyProtectionError } from '../domain/privacy-error.js';

@Injectable()
export class AesGcmPrivacyCipher implements PrivacyCipher {
  private readonly key: Buffer | null;

  constructor(configService: ConfigService) {
    const configured = configService.get<string | null>('privacyEncryptionKey');
    this.key = configured ? decodePrivacyKey(configured) : null;
  }

  encrypt(plaintext: string, aad: string): EncryptedValue {
    const key = this.encryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: 16,
    });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return {
      iv: iv.toString('base64url'),
      authTag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    };
  }

  decrypt(payload: EncryptedValue, aad: string): string {
    const key = this.encryptionKey();
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(payload.iv, 'base64url'),
        { authTagLength: 16 },
      );
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(payload.authTag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(payload.ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new PrivacyProtectionError();
    }
  }

  hmac(category: string, plaintext: string): string {
    return createHmac('sha256', this.encryptionKey())
      .update(`${category}\0${plaintext}`)
      .digest('base64url');
  }

  private encryptionKey(): Buffer {
    if (!this.key) {
      throw new PrivacyProtectionError();
    }
    return this.key;
  }
}

export function decodePrivacyKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'Invalid environment configuration: PRIVACY_ENCRYPTION_KEY must decode to 32 bytes',
    );
  }
  return key;
}
