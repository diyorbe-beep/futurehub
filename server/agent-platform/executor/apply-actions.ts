import { deleteFileSafe, readFileSafe, writeFileSafe } from './fs-utils.ts';
import { runShell } from './shell.ts';

export interface AppliedActionSummary {
  writes: string[];
  deletes: string[];
  shells: Array<{ cmd: string; code: number; tail: string }>;
  readsRequested: string[];
  readContents: Array<{ path: string; content: string | null }>;
}

const WRITE_RE = /<agent_write\s+path="([^"]+)">\s*([\s\S]*?)<\/agent_write>/gi;
const DELETE_RE = /<agent_delete\s+path="([^"]+)"\s*\/>/gi;
const SHELL_RE = /<agent_shell>\s*([\s\S]*?)<\/agent_shell>/gi;
const READ_RE = /<agent_read\s+path="([^"]+)"\s*\/>/gi;

export function parseAgentReads(text: string): string[] {
  const paths: string[] = [];
  READ_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = READ_RE.exec(text)) !== null) {
    paths.push(m[1].trim());
  }

  return [...new Set(paths)];
}

export async function resolveReadContents(
  root: string,
  paths: string[],
): Promise<Array<{ path: string; content: string | null }>> {
  const out: Array<{ path: string; content: string | null }> = [];

  for (const p of paths) {
    const content = await readFileSafe(root, p);
    out.push({ path: p, content });
  }

  return out;
}

export async function applyAgentOutput(
  root: string,
  text: string,
  shellTimeoutMs: number,
): Promise<AppliedActionSummary> {
  const summary: AppliedActionSummary = {
    writes: [],
    deletes: [],
    shells: [],
    readsRequested: parseAgentReads(text),
    readContents: [],
  };

  WRITE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = WRITE_RE.exec(text)) !== null) {
    const rel = m[1].trim();
    const body = m[2].replace(/^\n/, '');

    if (await writeFileSafe(root, rel, body)) {
      summary.writes.push(rel);
    }
  }

  DELETE_RE.lastIndex = 0;

  while ((m = DELETE_RE.exec(text)) !== null) {
    const rel = m[1].trim();

    if (await deleteFileSafe(root, rel)) {
      summary.deletes.push(rel);
    }
  }

  SHELL_RE.lastIndex = 0;

  while ((m = SHELL_RE.exec(text)) !== null) {
    const cmd = m[1].trim().split('\n')[0].trim();

    if (!cmd || cmd.length > 2000) {
      continue;
    }

    const block = /^(npm|pnpm|yarn|node|npx|git)\b/i;

    if (!block.test(cmd)) {
      summary.shells.push({ cmd, code: 1, tail: 'rejected: only npm/pnpm/yarn/node/npx/git allowed' });

      continue;
    }

    const r = await runShell(root, cmd, shellTimeoutMs);
    const tail = `${r.stderr}\n${r.stdout}`.slice(-8000);
    summary.shells.push({ cmd, code: r.code, tail: r.timedOut ? `${tail}\n[TIMEOUT]` : tail });
  }

  return summary;
}
