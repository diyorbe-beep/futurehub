import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { runShell, isWindows } from './shell.ts';

const NPM = isWindows ? 'npm.cmd' : 'npm';
const PNPM = isWindows ? 'pnpm.cmd' : 'pnpm';
const YARN = isWindows ? 'yarn.cmd' : 'yarn';

export interface CiStepResult {
  name: string;
  command: string;
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function detectInstallCommand(cwd: string): string {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) {
    return `${PNPM} install --frozen-lockfile`;
  }

  if (existsSync(join(cwd, 'yarn.lock'))) {
    return `${YARN} install --frozen-lockfile`;
  }

  if (existsSync(join(cwd, 'package-lock.json'))) {
    return `${NPM} ci`;
  }

  return `${NPM} install`;
}

async function readScripts(cwd: string): Promise<Record<string, string>> {
  const p = join(cwd, 'package.json');

  if (!existsSync(p)) {
    return {};
  }

  try {
    const j = JSON.parse(await readFile(p, 'utf8')) as { scripts?: Record<string, string> };

    return j.scripts ?? {};
  } catch {
    return {};
  }
}

export async function runCiPipeline(
  cwd: string,
  opts: { skipInstall?: boolean; timeoutPerStepMs: number },
): Promise<{ ok: boolean; steps: CiStepResult[]; summary: string }> {
  const steps: CiStepResult[] = [];
  const scripts = await readScripts(cwd);
  const toRun: Array<{ name: string; cmd: string }> = [];

  if (!opts.skipInstall && existsSync(join(cwd, 'package.json'))) {
    toRun.push({ name: 'install', cmd: detectInstallCommand(cwd) });
  }

  if (scripts.build) {
    toRun.push({ name: 'build', cmd: `${NPM} run build` });
  }

  if (scripts.test) {
    toRun.push({ name: 'test', cmd: `${NPM} test` });
  } else if (Object.keys(scripts).length > 0) {
    toRun.push({ name: 'test', cmd: `${NPM} run test --if-present` });
  }

  if (toRun.length === 0) {
    return {
      ok: true,
      steps: [],
      summary: 'No package.json or no install/build/test steps detected; CI skipped.',
    };
  }

  let allOk = true;

  for (const s of toRun) {
    const r = await runShell(cwd, s.cmd, opts.timeoutPerStepMs);
    const step: CiStepResult = {
      name: s.name,
      command: s.cmd,
      code: r.code,
      stdout: r.stdout.slice(-40_000),
      stderr: r.stderr.slice(-20_000),
      timedOut: r.timedOut,
    };
    steps.push(step);

    if (r.code !== 0 || r.timedOut) {
      allOk = false;
      break;
    }
  }

  const summary = steps
    .map((x) => `### ${x.name} (${x.code}) ${x.timedOut ? 'TIMEOUT' : ''}\n${x.stderr}\n${x.stdout}`)
    .join('\n\n')
    .slice(0, 60_000);

  return { ok: allOk, steps, summary };
}
