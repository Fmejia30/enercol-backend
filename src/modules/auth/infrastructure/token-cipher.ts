import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class TokenCipherError extends Error {
  constructor() {
    super('Token ciphertext could not be read');
    this.name = 'TokenCipherError';
  }
}

@Injectable()
export class TokenCipher {
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    this.key = decodeSessionKey(
      configService.getOrThrow<string>('sessionEncryptionKey'),
    );
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string): string {
    const [ivPart, tagPart, ciphertextPart] = payload.split('.');
    if (!ivPart || !tagPart || !ciphertextPart) {
      throw new TokenCipherError();
    }

    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(ivPart, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new TokenCipherError();
    }
  }
}

export function decodeSessionKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'Invalid environment configuration: SESSION_ENCRYPTION_KEY must decode to 32 bytes',
    );
  }
  return key;
}
