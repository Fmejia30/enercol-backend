import { jest } from '@jest/globals';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  function createService(queryRaw: jest.Mock): HealthService {
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    return new HealthService(prisma);
  }

  it('reports liveness without querying the database', () => {
    const queryRaw = jest.fn();
    const service = createService(queryRaw);

    const report = service.checkLiveness();

    expect(report).toMatchObject({
      status: 'ok',
      service: 'enercol-backend',
      checks: {},
    });
    expect(report.timestamp).toEqual(expect.any(String));
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('reports the database as up when the query succeeds', async () => {
    const service = createService(jest.fn().mockResolvedValue([{ ok: 1 }]));

    const report = await service.checkReadiness();

    expect(report).toMatchObject({
      status: 'ok',
      service: 'enercol-backend',
      checks: { database: 'up' },
    });
    expect(report.timestamp).toEqual(expect.any(String));
  });

  it('reports the database as down without exposing the driver error', async () => {
    const service = createService(
      jest.fn().mockRejectedValue(new Error('password authentication failed')),
    );

    const report = await service.checkReadiness();

    expect(report).toMatchObject({
      status: 'error',
      service: 'enercol-backend',
      checks: { database: 'down' },
    });
    expect(JSON.stringify(report)).not.toContain(
      'password authentication failed',
    );
  });
});
