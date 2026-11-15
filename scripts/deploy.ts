import { spawnSync } from 'node:child_process';
import {
  deploymentSteps,
  runDeployment,
} from '../src/deployment/run-deployment.js';

const code = runDeployment(deploymentSteps, (step) => {
  const result = spawnSync(step.command, [...step.args], {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
});

process.exit(code);
