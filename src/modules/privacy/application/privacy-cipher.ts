export interface EncryptedValue {
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
}

export interface PrivacyCipher {
  encrypt(plaintext: string, aad: string): EncryptedValue;
  decrypt(payload: EncryptedValue, aad: string): string;
  hmac(category: string, plaintext: string): string;
}

export const PRIVACY_CIPHER = Symbol('PRIVACY_CIPHER');
