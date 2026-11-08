import { NODE_ENVIRONMENTS, type NodeEnvironment } from './env.validation.js';

export interface AppConfiguration {
  nodeEnv: NodeEnvironment;
  port: number;
  databaseUrl: string;
  cognitoRegion: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  cognitoClientSecret: string;
  cognitoIssuer: string;
  cognitoJwksUri: string;
  frontendUrl: string;
  frontendOrigin: string;
  sessionEncryptionKey: string;
  sessionAbsoluteTtlSeconds: number;
  sessionIdleTtlSeconds: number;
  cookieName: string;
  cookieSecure: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
}

export function configuration(): AppConfiguration {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const port = Number(process.env.PORT ?? 3000);

  if (!isNodeEnvironment(nodeEnv)) {
    throw new Error(`Invalid NODE_ENV "${nodeEnv ?? ''}"`);
  }

  return {
    nodeEnv,
    port,
    databaseUrl: requiredEnvironmentValue('DATABASE_URL'),
    cognitoRegion: requiredEnvironmentValue('COGNITO_REGION'),
    cognitoUserPoolId: requiredEnvironmentValue('COGNITO_USER_POOL_ID'),
    cognitoClientId: requiredEnvironmentValue('COGNITO_CLIENT_ID'),
    cognitoClientSecret: requiredEnvironmentValue('COGNITO_CLIENT_SECRET'),
    cognitoIssuer: requiredEnvironmentValue('COGNITO_ISSUER'),
    cognitoJwksUri: requiredEnvironmentValue('COGNITO_JWKS_URI'),
    frontendUrl: requiredEnvironmentValue('FRONTEND_URL'),
    frontendOrigin: requiredEnvironmentValue('FRONTEND_ORIGIN'),
    sessionEncryptionKey: requiredEnvironmentValue('SESSION_ENCRYPTION_KEY'),
    sessionAbsoluteTtlSeconds: numericEnvironmentValue(
      'SESSION_ABSOLUTE_TTL_SECONDS',
      28_800,
    ),
    sessionIdleTtlSeconds: numericEnvironmentValue(
      'SESSION_IDLE_TTL_SECONDS',
      1_800,
    ),
    cookieName: process.env.COOKIE_NAME || 'enercol_session',
    cookieSecure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === 'true'
      : nodeEnv === 'production',
    cookieSameSite: sameSite(process.env.COOKIE_SAME_SITE),
  };
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function numericEnvironmentValue(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  return Number(value);
}

function sameSite(value: string | undefined): 'lax' | 'strict' | 'none' {
  if (value === 'strict' || value === 'none' || value === 'lax') {
    return value;
  }
  return 'lax';
}

function isNodeEnvironment(value: string): value is NodeEnvironment {
  return NODE_ENVIRONMENTS.some((environment) => environment === value);
}
