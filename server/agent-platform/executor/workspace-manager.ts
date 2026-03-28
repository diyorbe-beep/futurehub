import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENT_WORKSPACE_ROOT, AGENT_GIT_TIMEOUT_MS, AGENT_CMD_TIMEOUT_MS } from '../config.ts';
import { cloneRepository, initScratchRepo } from './git-workspace.ts';
import { listTreeSnippet } from './fs-utils.ts';

export interface WorkspaceContext {
  jobId: string;
  root: string;
  repoRoot: string;
  meta: Record<string, unknown>;
}

function sanitizeBranch(b: string | undefined): string {
  const s = (b ?? 'main').trim();

  if (!/^[\w./-]+$/.test(s)) {
    return 'main';
  }

  return s;
}

export async function prepareWorkspace(jobId: string, metadata: Record<string, unknown>): Promise<WorkspaceContext> {
  const base = join(AGENT_WORKSPACE_ROOT, 'jobs', jobId);
  await mkdir(base, { recursive: true });
  const repoUrl = typeof metadata.repoUrl === 'string' ? metadata.repoUrl.trim() : '';
  let repoRoot: string;

  if (repoUrl) {
    const branch = sanitizeBranch(typeof metadata.repoBranch === 'string' ? metadata.repoBranch : 'main');
    const cl = await cloneRepository(base, repoUrl, branch, AGENT_GIT_TIMEOUT_MS);

    if (!cl.ok) {
      throw new Error(`clone failed: ${cl.error ?? 'unknown'}`);
    }

    repoRoot = cl.cwd;
  } else {
    repoRoot = await initScratchRepo(base, AGENT_GIT_TIMEOUT_MS);
  }

  return { jobId, root: base, repoRoot, meta: metadata };
}

export async function workspaceSnapshotForPrompt(repoRoot: string): Promise<string> {
  const tree = await listTreeSnippet(repoRoot, 100);

  return `<workspace_tree>\n${tree}\n</workspace_tree>`;
}

export { AGENT_CMD_TIMEOUT_MS };
