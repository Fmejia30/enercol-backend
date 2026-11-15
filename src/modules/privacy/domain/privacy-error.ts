export class PrivacyProtectionError extends Error {
  constructor() {
    super('Privacy protection failed');
    this.name = 'PrivacyProtectionError';
  }
}

export class PrivacyAuthorizationError extends Error {
  constructor() {
    super('Privacy context is not available');
    this.name = 'PrivacyAuthorizationError';
  }
}

export class UnknownPrivacyTokenError extends Error {
  constructor() {
    super('Unknown privacy token');
    this.name = 'UnknownPrivacyTokenError';
  }
}

export class MalformedPrivacyTokenError extends Error {
  constructor() {
    super('Malformed privacy response');
    this.name = 'MalformedPrivacyTokenError';
  }
}
