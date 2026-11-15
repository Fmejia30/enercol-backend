import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  applyTechnicalTestCases,
  assertSeedTarget,
  readSeedSpecialistSub,
  type TechnicalSeedStore,
} from '../src/modules/post-sale-requests/infrastructure/technical-case-seed.js';

const env = process.env;

try {
  assertSeedTarget(env);
  const specialistSub = readSeedSpecialistSub(env);
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL es necesaria para sembrar los casos técnicos.',
    );
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const result = await applyTechnicalTestCases(
      prisma as unknown as TechnicalSeedStore,
      specialistSub,
    );
    console.log(`Casos técnicos listos: ${result.cases}`);
  } finally {
    await prisma.$disconnect();
  }
} catch (error) {
  const message =
    error instanceof Error
      ? error.message
      : 'No fue posible sembrar los casos técnicos.';
  console.error(message);
  process.exitCode = 1;
}
