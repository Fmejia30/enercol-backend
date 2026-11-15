export interface DeploymentStep {
  readonly command: string;
  readonly args: readonly string[];
}

export const deploymentSteps: readonly DeploymentStep[] = [
  { command: 'pnpm', args: ['install', '--frozen-lockfile'] },
  { command: 'pnpm', args: ['exec', 'prisma', 'migrate', 'deploy'] },
  { command: 'pnpm', args: ['prisma:seed'] },
  { command: 'pnpm', args: ['build'] },
  { command: 'pnpm', args: ['start:prod'] },
];

export function runDeployment(
  steps: readonly DeploymentStep[],
  run: (step: DeploymentStep) => number,
): number {
  for (const step of steps) {
    const code = run(step);
    if (code !== 0) {
      return Number.isInteger(code) && code > 0 ? code : 1;
    }
  }
  return 0;
}
