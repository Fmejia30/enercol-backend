const JWT_IN_TEXT =
  /[A-Za-z0-9_-]{16,}={0,2}\.[A-Za-z0-9_-]{16,}={0,2}\.[A-Za-z0-9_-]{16,}={0,2}/g;

const STAGE_BY_EXCEPTION_TYPE: Readonly<Record<string, string>> = {
  JwtParseError: 'parse',
  JwtInvalidSignatureError: 'signature',
  JwtInvalidSignatureAlgorithmError: 'signature',
  FetchError: 'jwks',
  NonRetryableFetchError: 'jwks',
  JwksValidationError: 'jwks',
  JwkValidationError: 'jwks',
  JwkInvalidUseError: 'jwks',
  JwkInvalidKtyError: 'jwks',
  JwtWithoutValidKidError: 'jwks',
  KidNotFoundInJwksError: 'jwks',
  JwksNotAvailableInCacheError: 'jwks',
  WaitPeriodNotYetEndedJwkError: 'jwks',
  JwtInvalidIssuerError: 'issuer',
  ParameterValidationError: 'configuration',
  CognitoJwtInvalidClientIdError: 'client_id',
  CognitoJwtInvalidTokenUseError: 'token_use',
  JwtExpiredError: 'expiration',
  JwtNotBeforeError: 'expiration',
  JwtInvalidAudienceError: 'audience',
  InsufficientAccessTokenClaimsError: 'claims',
};

export interface TokenVerificationFailure {
  stage: string;
  exceptionType: string;
  message: string;
}

export class InsufficientAccessTokenClaimsError extends Error {
  constructor() {
    super(
      'Access token claims are insufficient: token_use must be access and sub must be present',
    );
    this.name = 'InsufficientAccessTokenClaimsError';
  }
}

export function describeTokenVerificationFailure(
  error: unknown,
): TokenVerificationFailure {
  const exceptionType = readExceptionType(error);
  const message = sanitizeVerificationMessage(readMessage(error));
  const stage =
    exceptionType === 'ParameterValidationError' &&
    message.includes('issuer not configured')
      ? 'issuer'
      : (STAGE_BY_EXCEPTION_TYPE[exceptionType] ?? 'verification');

  return { stage, exceptionType, message };
}

export function sanitizeVerificationMessage(message: string): string {
  return message.replace(JWT_IN_TEXT, '[redacted-jwt]');
}

function readExceptionType(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'UnknownError';
  }

  const constructorName = error.constructor.name;
  if (constructorName && constructorName !== 'Object') {
    return constructorName;
  }

  return 'UnknownError';
}

function readMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'No technical message was provided';
}
