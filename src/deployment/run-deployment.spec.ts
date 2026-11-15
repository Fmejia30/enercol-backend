import { describe, expect, it } from '@jest/globals';
import { deploymentSteps, runDeployment } from './run-deployment.js';

describe('deployment', () => {
  it('installs, migrates, seeds, builds, and starts in that order', () => {
    expect(
      deploymentSteps.map((step) => [step.command, ...step.args].join(' ')),
    ).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm exec prisma migrate deploy',
      'pnpm prisma:seed',
      'pnpm build',
      'pnpm start:prod',
    ]);
  });

  it('stops before the seed and the API when migrations fail', () => {
    const ran: string[] = [];
    const code = runDeployment(deploymentSteps, (step) => {
      ran.push(step.args.join(' '));
      return step.args.includes('migrate') ? 2 : 0;
    });

    expect(code).toBe(2);
    expect(ran).toEqual([
      'install --frozen-lockfile',
      'exec prisma migrate deploy',
    ]);
  });

  it('stops before the build and the API when the seed fails', () => {
    const ran: string[] = [];
    const code = runDeployment(deploymentSteps, (step) => {
      ran.push(step.args.join(' '));
      return step.args.at(-1) === 'prisma:seed' ? 1 : 0;
    });

    expect(code).toBe(1);
    expect(ran).toEqual([
      'install --frozen-lockfile',
      'exec prisma migrate deploy',
      'prisma:seed',
    ]);
  });
});
