import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GITHUB_TOKEN } from '../config.ts';
import { runShell } from './shell.ts';

export function embedGitHubTokenInHttpsUrl(url: string, token: string): string {
  if (!token || !url.includes('github.com')) {
    return url;
  }

  if (url.startsWith('https://') && !url.includes('@')) {
    return url.replace('https://', `https://x-access-token:${token}@`);
  }

  return url;
}

export async function ensureGitIdentity(cwd: string, timeoutMs: number): Promise<void> {
  await runShell(cwd, 'git config user.email "agent@futurehub.local"', timeoutMs);
  await runShell(cwd, 'git config user.name "FutureHub Agent"', timeoutMs);
}

export type GitOpResult = { ok: boolean; skipped?: boolean; log: string };

export async function cloneRepository(
  parentDir: string,
  repoUrl: string,
  branch: string,
  timeoutMs: number,
): Promise<{ ok: boolean; cwd: string; error?: string }> {
  const cwd = join(parentDir, 'repo');
  await rm(cwd, { recursive: true, force: true }).catch(() => {});
  await mkdir(parentDir, { recursive: true });
  const authed = embedGitHubTokenInHttpsUrl(repoUrl, GITHUB_TOKEN);
  const b = branch || 'main';
  const urlArg = JSON.stringify(authed);
  const branchArg = JSON.stringify(b);
  const r = await runShell(parentDir, `git clone --depth 1 -b ${branchArg} ${urlArg} repo`, timeoutMs);

  if (r.code !== 0 || !existsSync(join(cwd, '.git'))) {
    const r2 = await runShell(
      parentDir,
      `git clone --depth 1 ${urlArg} repo`,
      timeoutMs,
    );

    if (r2.code !== 0 || !existsSync(join(cwd, '.git'))) {
      return { ok: false, cwd, error: r2.stderr || r2.stdout || r.stderr || r.stdout || 'clone failed' };
    }
  }

  await ensureGitIdentity(cwd, 30_000);

  return { ok: true, cwd };
}

export async function initScratchRepo(parentDir: string, timeoutMs: number): Promise<string> {
  const cwd = join(parentDir, 'repo');
  await rm(cwd, { recursive: true, force: true }).catch(() => {});
  await mkdir(cwd, { recursive: true });
  const pkg = {
    name: 'agent-scratch',
    private: true,
    version: '0.0.0',
    scripts: {
      build: 'node -e "console.log(\\"build ok\\")"',
      test: 'node -e "console.log(\\"test ok\\")"',
    },
  };
  await writeFile(join(cwd, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  await writeFile(join(cwd, 'README.md'), '# Agent workspace\n', 'utf8');
  let r = await runShell(cwd, 'git init', timeoutMs);

  if (r.code !== 0) {
    throw new Error(r.stderr || 'git init failed');
  }

  await ensureGitIdentity(cwd, 30_000);
  r = await runShell(cwd, 'git add -A && git commit -m "chore: initial agent workspace"', timeoutMs);

  if (r.code !== 0) {
    throw new Error(r.stderr || 'initial commit failed');
  }

  return cwd;
}

export async function gitStatusShort(cwd: string, timeoutMs: number): Promise<string> {
  const r = await runShell(cwd, 'git status --short', timeoutMs);

  return r.stdout || r.stderr || '(no status)';
}

export async function gitCommitAll(cwd: string, message: string, timeoutMs: number): Promise<GitOpResult> {
  const st = await runShell(cwd, 'git status --porcelain', timeoutMs);

  if (!st.stdout.trim()) {
    return { ok: true, skipped: true, log: 'nothing to commit' };
  }

  let r = await runShell(cwd, 'git add -A', timeoutMs);

  if (r.code !== 0) {
    return { ok: false, log: r.stderr || r.stdout };
  }

  const safeMsg = message.replace(/"/g, "'").slice(0, 500);
  r = await runShell(cwd, `git commit -m "${safeMsg}"`, timeoutMs);

  if (r.code !== 0) {
    return { ok: false, log: r.stderr || r.stdout };
  }

  return { ok: true, log: r.stdout || 'committed' };
}

export async function gitPushOrigin(
  cwd: string,
  remoteUrl: string,
  branch: string,
  timeoutMs: number,
): Promise<GitOpResult> {
  const authed = embedGitHubTokenInHttpsUrl(remoteUrl, GITHUB_TOKEN);
  const urlLit = JSON.stringify(authed);
  await runShell(cwd, 'git remote remove origin', 20_000);
  let r = await runShell(cwd, `git remote add origin ${urlLit}`, 30_000);

  if (r.code !== 0) {
    r = await runShell(cwd, `git remote set-url origin ${urlLit}`, 30_000);
  }

  if (r.code !== 0) {
    return { ok: false, log: r.stderr || r.stdout };
  }

  const b = branch || 'main';
  r = await runShell(cwd, `git push -u origin HEAD:refs/heads/${b}`, timeoutMs);

  if (r.code !== 0) {
    return { ok: false, log: r.stderr || r.stdout };
  }

  return { ok: true, log: r.stdout || 'pushed' };
}
