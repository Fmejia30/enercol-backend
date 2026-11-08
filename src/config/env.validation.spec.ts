import { validateEnv } from './env.validation.js';

const ISSUER =
  'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool01';

describe('validateEnv', () => {
  const validConfig = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://enercol:enercol@localhost:5432/enercol',
    COGNITO_REGION: 'us-east-1',
    COGNITO_USER_POOL_ID: 'us-east-1_TestPool01',
    COGNITO_CLIENT_ID: 'enercolclientid',
    COGNITO_CLIENT_SECRET: 'test-client-secret',
    COGNITO_ISSUER: ISSUER,
    COGNITO_JWKS_URI: `${ISSUER}/.well-known/jwks.json`,
    FRONTEND_URL: 'http://localhost:5173',
    FRONTEND_ORIGIN: 'http://localhost:5173',
    SESSION_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    COOKIE_NAME: 'enercol_session',
    COOKIE_SECURE: 'false',
    COOKIE_SAME_SITE: 'lax',
  };

  it('accepts a complete configuration and applies defaults', () => {
    expect(validateEnv(validConfig)).toEqual({
      NODE_ENV: 'test',
      PORT: 3000,
      DATABASE_URL: validConfig.DATABASE_URL,
      COGNITO_REGION: validConfig.COGNITO_REGION,
      COGNITO_USER_POOL_ID: validConfig.COGNITO_USER_POOL_ID,
      COGNITO_CLIENT_ID: validConfig.COGNITO_CLIENT_ID,
      COGNITO_CLIENT_SECRET: validConfig.COGNITO_CLIENT_SECRET,
      COGNITO_ISSUER: validConfig.COGNITO_ISSUER,
      COGNITO_JWKS_URI: validConfig.COGNITO_JWKS_URI,
      FRONTEND_URL: validConfig.FRONTEND_URL,
      FRONTEND_ORIGIN: validConfig.FRONTEND_ORIGIN,
      SESSION_ENCRYPTION_KEY: validConfig.SESSION_ENCRYPTION_KEY,
      SESSION_ABSOLUTE_TTL_SECONDS: 28800,
      SESSION_IDLE_TTL_SECONDS: 1800,
      COOKIE_NAME: 'enercol_session',
      COOKIE_SECURE: 'false',
      COOKIE_SAME_SITE: 'lax',
    });

    expect(
      validateEnv({
        DATABASE_URL: validConfig.DATABASE_URL,
        COGNITO_REGION: validConfig.COGNITO_REGION,
        COGNITO_USER_POOL_ID: validConfig.COGNITO_USER_POOL_ID,
        COGNITO_CLIENT_ID: validConfig.COGNITO_CLIENT_ID,
        COGNITO_CLIENT_SECRET: validConfig.COGNITO_CLIENT_SECRET,
        COGNITO_ISSUER: validConfig.COGNITO_ISSUER,
        COGNITO_JWKS_URI: validConfig.COGNITO_JWKS_URI,
        FRONTEND_URL: validConfig.FRONTEND_URL,
        FRONTEND_ORIGIN: validConfig.FRONTEND_ORIGIN,
        SESSION_ENCRYPTION_KEY: validConfig.SESSION_ENCRYPTION_KEY,
      }),
    ).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      SESSION_ABSOLUTE_TTL_SECONDS: 28800,
      SESSION_IDLE_TTL_SECONDS: 1800,
      COOKIE_NAME: 'enercol_session',
      COOKIE_SAME_SITE: 'lax',
    });
  });

  it('rejects a user pool that does not belong to the configured region', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        COGNITO_REGION: 'eu-west-1',
        COGNITO_USER_POOL_ID: 'us-east-1_TestPool01',
      }),
    ).toThrow(/COGNITO_USER_POOL_ID/);
    expect(() =>
      validateEnv({ ...validConfig, COGNITO_CLIENT_ID: '' }),
    ).toThrow(/COGNITO_CLIENT_ID/);
  });

  it('rejects an issuer or JWKS URI that does not match the user pool', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        COGNITO_ISSUER:
          'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_Other',
      }),
    ).toThrow(/COGNITO_ISSUER/);
    expect(() =>
      validateEnv({
        ...validConfig,
        COGNITO_JWKS_URI: `${ISSUER}/jwks.json`,
      }),
    ).toThrow(/COGNITO_JWKS_URI/);
  });

  it('rejects SameSite none without a secure cookie', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        COOKIE_SAME_SITE: 'none',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow(/COOKIE_SECURE/);
  });

  it('rejects a missing or non-PostgreSQL database url', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() =>
      validateEnv({
        ...validConfig,
        DATABASE_URL: 'mysql://localhost/enercol',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects an encryption key that is not 32 bytes and an idle timeout longer than the session', () => {
    expect(() =>
      validateEnv({ ...validConfig, SESSION_ENCRYPTION_KEY: 'c2hvcnQ=' }),
    ).toThrow(/SESSION_ENCRYPTION_KEY/);
    expect(() =>
      validateEnv({
        ...validConfig,
        SESSION_ABSOLUTE_TTL_SECONDS: '300',
        SESSION_IDLE_TTL_SECONDS: '600',
      }),
    ).toThrow(/SESSION_IDLE_TTL_SECONDS/);
  });

  it('rejects an unknown environment or an invalid port', () => {
    expect(() => validateEnv({ ...validConfig, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
    expect(() => validateEnv({ ...validConfig, PORT: '0' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...validConfig, PORT: '70000' })).toThrow(
      /PORT/,
    );
    expect(() => validateEnv({ ...validConfig, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('names a missing secret without including its value', () => {
    expect(() =>
      validateEnv({ ...validConfig, COGNITO_CLIENT_SECRET: '' }),
    ).toThrow(/COGNITO_CLIENT_SECRET/);
  });
});
