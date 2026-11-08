import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  validateSync,
} from 'class-validator';

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

const ABSOLUTE_TTL_DEFAULT = 28_800;
const IDLE_TTL_DEFAULT = 1_800;

class EnvironmentVariables {
  @IsIn(NODE_ENVIRONMENTS)
  NODE_ENV!: NodeEnvironment;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a PostgreSQL connection string',
  })
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/)
  COGNITO_REGION!: string;

  @IsString()
  @Matches(/^(?:eusc-[a-z]{2}|[a-z]{2})-(?:gov-)?[a-z]+-\d_[A-Za-z0-9]+$/)
  COGNITO_USER_POOL_ID!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9]{1,128}$/)
  COGNITO_CLIENT_ID!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  COGNITO_CLIENT_SECRET!: string;

  @IsString()
  @Matches(
    /^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[A-Za-z0-9_-]+$/,
  )
  COGNITO_ISSUER!: string;

  @IsString()
  @Matches(
    /^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[A-Za-z0-9_-]+\/\.well-known\/jwks\.json$/,
  )
  COGNITO_JWKS_URI!: string;

  @IsString()
  @Matches(/^https?:\/\/\S+$/)
  @MaxLength(2048)
  FRONTEND_URL!: string;

  @IsString()
  @Matches(/^https?:\/\/\S+$/)
  @MaxLength(2048)
  FRONTEND_ORIGIN!: string;

  @IsString()
  @IsNotEmpty()
  SESSION_ENCRYPTION_KEY!: string;

  @IsInt()
  @Min(300)
  @Max(2_592_000)
  SESSION_ABSOLUTE_TTL_SECONDS!: number;

  @IsInt()
  @Min(60)
  @Max(2_592_000)
  SESSION_IDLE_TTL_SECONDS!: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  COOKIE_NAME?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  COOKIE_SECURE?: 'true' | 'false';

  @IsOptional()
  @IsIn(['lax', 'strict', 'none'])
  COOKIE_SAME_SITE?: 'lax' | 'strict' | 'none';
}

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const validated = plainToInstance(
    EnvironmentVariables,
    {
      NODE_ENV: config.NODE_ENV ?? 'development',
      PORT: config.PORT ?? 3000,
      DATABASE_URL: config.DATABASE_URL,
      COGNITO_REGION: config.COGNITO_REGION,
      COGNITO_USER_POOL_ID: config.COGNITO_USER_POOL_ID,
      COGNITO_CLIENT_ID: config.COGNITO_CLIENT_ID,
      COGNITO_CLIENT_SECRET: config.COGNITO_CLIENT_SECRET,
      COGNITO_ISSUER: config.COGNITO_ISSUER,
      COGNITO_JWKS_URI: config.COGNITO_JWKS_URI,
      FRONTEND_URL: config.FRONTEND_URL,
      FRONTEND_ORIGIN: config.FRONTEND_ORIGIN,
      SESSION_ENCRYPTION_KEY: config.SESSION_ENCRYPTION_KEY,
      SESSION_ABSOLUTE_TTL_SECONDS:
        config.SESSION_ABSOLUTE_TTL_SECONDS ?? ABSOLUTE_TTL_DEFAULT,
      SESSION_IDLE_TTL_SECONDS:
        config.SESSION_IDLE_TTL_SECONDS ?? IDLE_TTL_DEFAULT,
      COOKIE_NAME: config.COOKIE_NAME,
      COOKIE_SECURE: config.COOKIE_SECURE,
      COOKIE_SAME_SITE: config.COOKIE_SAME_SITE,
    },
    { enableImplicitConversion: true },
  );
  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration: ${formatValidationErrors(errors)}`,
    );
  }

  if (
    !validated.COGNITO_USER_POOL_ID.startsWith(`${validated.COGNITO_REGION}_`)
  ) {
    throw new Error(
      'Invalid environment configuration: COGNITO_USER_POOL_ID: must belong to COGNITO_REGION',
    );
  }

  const expectedIssuer = `https://cognito-idp.${validated.COGNITO_REGION}.amazonaws.com/${validated.COGNITO_USER_POOL_ID}`;
  if (validated.COGNITO_ISSUER !== expectedIssuer) {
    throw new Error(
      'Invalid environment configuration: COGNITO_ISSUER: must match the user pool',
    );
  }
  if (
    validated.COGNITO_JWKS_URI !== `${expectedIssuer}/.well-known/jwks.json`
  ) {
    throw new Error(
      'Invalid environment configuration: COGNITO_JWKS_URI: must match the user pool',
    );
  }

  const sameSite = validated.COOKIE_SAME_SITE ?? 'lax';
  if (sameSite === 'none' && validated.COOKIE_SECURE !== 'true') {
    throw new Error(
      'Invalid environment configuration: COOKIE_SECURE must be true when COOKIE_SAME_SITE is none',
    );
  }

  if (Buffer.from(validated.SESSION_ENCRYPTION_KEY, 'base64').length !== 32) {
    throw new Error(
      'Invalid environment configuration: SESSION_ENCRYPTION_KEY must decode to 32 bytes',
    );
  }

  if (
    validated.SESSION_IDLE_TTL_SECONDS > validated.SESSION_ABSOLUTE_TTL_SECONDS
  ) {
    throw new Error(
      'Invalid environment configuration: SESSION_IDLE_TTL_SECONDS must not exceed SESSION_ABSOLUTE_TTL_SECONDS',
    );
  }

  return {
    NODE_ENV: validated.NODE_ENV,
    PORT: validated.PORT,
    DATABASE_URL: validated.DATABASE_URL,
    COGNITO_REGION: validated.COGNITO_REGION,
    COGNITO_USER_POOL_ID: validated.COGNITO_USER_POOL_ID,
    COGNITO_CLIENT_ID: validated.COGNITO_CLIENT_ID,
    COGNITO_CLIENT_SECRET: validated.COGNITO_CLIENT_SECRET,
    COGNITO_ISSUER: validated.COGNITO_ISSUER,
    COGNITO_JWKS_URI: validated.COGNITO_JWKS_URI,
    FRONTEND_URL: validated.FRONTEND_URL,
    FRONTEND_ORIGIN: validated.FRONTEND_ORIGIN,
    SESSION_ENCRYPTION_KEY: validated.SESSION_ENCRYPTION_KEY,
    SESSION_ABSOLUTE_TTL_SECONDS: validated.SESSION_ABSOLUTE_TTL_SECONDS,
    SESSION_IDLE_TTL_SECONDS: validated.SESSION_IDLE_TTL_SECONDS,
    COOKIE_NAME: validated.COOKIE_NAME ?? 'enercol_session',
    COOKIE_SAME_SITE: sameSite,
    ...(validated.COOKIE_SECURE
      ? { COOKIE_SECURE: validated.COOKIE_SECURE }
      : {}),
  };
}

function formatValidationErrors(
  errors: { property: string; constraints?: Record<string, string> }[],
): string {
  return errors
    .map((error) => {
      const constraints = Object.values(error.constraints ?? {});
      return `${error.property}: ${constraints.join(', ')}`;
    })
    .join('; ');
}
