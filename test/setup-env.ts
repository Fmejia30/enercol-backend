import 'reflect-metadata';

process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.DATABASE_URL =
  'postgresql://enercol:enercol@localhost:5432/enercol';
process.env.COGNITO_REGION = 'us-east-1';
process.env.COGNITO_USER_POOL_ID = 'us-east-1_TestPool01';
process.env.COGNITO_CLIENT_ID = 'enercolclientid';
process.env.COGNITO_CLIENT_SECRET = 'test-client-secret';
process.env.COGNITO_ISSUER =
  'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool01';
process.env.COGNITO_JWKS_URI =
  'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool01/.well-known/jwks.json';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.SESSION_ENCRYPTION_KEY =
  'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.SESSION_ABSOLUTE_TTL_SECONDS = '28800';
process.env.SESSION_IDLE_TTL_SECONDS = '1800';
process.env.COOKIE_NAME = 'enercol_session';
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_SAME_SITE = 'lax';
