import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import type { Pool } from 'pg';
import {
  AGENT_CI_STEP_TIMEOUT_MS,
  AGENT_CMD_TIMEOUT_MS,
  AGENT_MAX_STEPS_PER_JOB,
  AGENT_MODEL,
  AGENT_USE_BUILTIN_EXECUTOR,
  EXTERNAL_EXECUTOR_URL,
  OPENAI_API_KEY,
} from './config.ts';
import {
  appendLog,
  getJob,
  insertDecision,
  recentDecisions,
  updateJobStatus,
  type AgentJobRow,
} from './repository.ts';
import { postExternalExecutor } from './external-executor.ts';
import { searchMemory, storeMemoryEmbedding } from './memory-store.ts';
import { triggerVercelDeploy, triggerVercelDeployHook } from './integrations/vercel.ts';
import { prepareWorkspace, workspaceSnapshotForPrompt } from './executor/workspace-manager.ts';
import { readFileSafe } from './executor/fs-utils.ts';
import {
  applyAgentOutput,
  parseAgentReads,
  resolveReadContents,
} from './executor/apply-actions.ts';
import { runCiPipeline } from './executor/ci-pipeline.ts';
import {
  gitCommitAll,
  gitPushOrigin,
  gitStatusShort,
} from './executor/git-workspace.ts';

const DONE_RE =
  /<developer_agent_status[^>]*\bdone\s*=\s*["']true["'][^>]*\/?>/i;

function buildSystem(job: AgentJobRow, hasRepo: boolean): string {
  const meta = job.metadata ?? {};
  const errList = Array.isArray(meta.recentErrors) ? (meta.recentErrors as string[]).slice(-5) : [];

  return `You are an autonomous software engineer with a REAL git workspace on disk.
${hasRepo ? 'Repository is cloned locally; you can change files and run allowed shell commands.' : 'A fresh workspace was created with package.json.'}

## Actions (machine-readable, use when needed)
- Read file for next turn: <agent_read path="relative/path.ext" />
- Write/overwrite file: <agent_write path="relative/path">file content here</agent_write>
- Delete file: <agent_delete path="relative/path" />
- One shell command (allowed prefixes only: npm, pnpm, yarn, node, npx, git): <agent_shell>npm install</agent_shell>

Choose stack, structure, and tools yourself. Prefer minimal working increments.
After changes, internal CI runs: install (if needed) → build → test. You will see <ci_output> with results — fix failures.

Avoid repeating failed approaches: ${errList.length ? errList.join(' | ') : '(none yet)'}.

When the goal is satisfied (build+test green or intentionally documented manual step), output:
<developer_agent_status done="true" />
For hosting that needs external credentials: <developer_agent_status done="true" deploy="manual" />
Do not ask the user questions.`;
}

function formatReadInjection(
  rows: Array<{ path: string; content: string | null }>,
): string {
  if (!rows.length) {
    return '';
  }

  const parts = rows.map((r) => {
    if (r.content === null) {
      return `<file path="${r.path}" missing="true" />`;
    }

    return `<file path="${r.path}">\n${r.content.slice(0, 80_000)}\n</file>`;
  });

  return `\n<read_files>\n${parts.join('\n')}\n</read_files>\n`;
}

function formatActionSummary(
  applied: Awaited<ReturnType<typeof applyAgentOutput>>,
  status: string,
  ciSummary: string,
): string {
  const w = applied.writes.length ? `writes: ${applied.writes.join(', ')}` : '';
  const d = applied.deletes.length ? `deletes: ${applied.deletes.join(', ')}` : '';
  const s = applied.shells.map((x) => `${x.cmd} → ${x.code}`).join('; ');

  return [
    w,
    d,
    s ? `shell: ${s}` : '',
    `git: ${status}`,
    `<ci_output>\n${ciSummary}\n</ci_output>`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runAgentJob(pool: Pool, jobId: string): Promise<void> {
  const job = await getJob(pool, jobId);

  if (!job) {
    throw new Error('job not found');
  }

  if (!OPENAI_API_KEY) {
    await appendLog(pool, jobId, 'error', 'OPENAI_API_KEY missing — cannot run LLM');
    await updateJobStatus(pool, jobId, {
      status: 'failed',
      last_error: 'OPENAI_API_KEY missing',
      completed_at: new Date(),
    });

    return;
  }

  const openai = createOpenAI({ apiKey: OPENAI_API_KEY });
  const model = openai(AGENT_MODEL);
  const meta = (job.metadata ?? {}) as Record<string, unknown>;

  await updateJobStatus(pool, jobId, {
    status: 'running',
    started_at: job.started_at ?? new Date(),
    last_error: null,
  });
  await appendLog(pool, jobId, 'info', 'worker started');

  let ws: Awaited<ReturnType<typeof prepareWorkspace>>;

  try {
    ws = await prepareWorkspace(jobId, meta);
    await appendLog(pool, jobId, 'info', `workspace: ${ws.repoRoot}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await appendLog(pool, jobId, 'error', `workspace failed: ${msg}`);
    await updateJobStatus(pool, jobId, {
      status: 'failed',
      last_error: msg,
      completed_at: new Date(),
    });

    return;
  }

  const hasRepo = typeof meta.repoUrl === 'string' && meta.repoUrl.length > 0;
  let history = '';
  let depsInstalled = false;
  let nextReadPaths: string[] = [];
  const recentErrors: string[] = Array.isArray(job.metadata?.recentErrors)
    ? [...(job.metadata.recentErrors as string[])]
    : [];

  for (let step = 1; step <= AGENT_MAX_STEPS_PER_JOB; step++) {
    const readRows = await resolveReadContents(ws.repoRoot, nextReadPaths);
    nextReadPaths = [];
    const readBlock = formatReadInjection(readRows);
    const tree = await workspaceSnapshotForPrompt(ws.repoRoot);
    const memHits = await searchMemory(pool, `${job.goal}\n${history.slice(-2000)}`, {
      projectId: job.project_id,
      limit: 10,
    });
    const decisions = await recentDecisions(pool, job.project_id, 8);
    const memBlock =
      memHits.length || decisions.length
        ? `\n<retrieved_memory>\n${memHits.map((m) => `[${m.source_type}] ${m.content}`).join('\n---\n')}\n${decisions.map((d) => `[decision] ${d.summary}`).join('\n')}\n</retrieved_memory>\n`
        : '';

    const { text } = await generateText({
      model,
      system: buildSystem({ ...job, metadata: { ...job.metadata, recentErrors } }, hasRepo),
      prompt: `${memBlock}${tree}${readBlock}[AUTONOMOUS_STEP ${step}/${AGENT_MAX_STEPS_PER_JOB}]\nPrimary goal:\n${job.goal}\n\nExecution log (tail):\n${history.slice(-12_000)}`,
      maxTokens: 8192,
    });

    await appendLog(pool, jobId, 'info', `llm step ${step}`, { chars: text.length });
    history += `\n\n--- step ${step} (assistant) ---\n${text}`;
    nextReadPaths = parseAgentReads(text);

    try {
      await storeMemoryEmbedding(pool, {
        projectId: job.project_id,
        jobId,
        sourceType: 'conversation',
        content: text.slice(0, 12_000),
        metadata: { step },
      });
    } catch {
      /* ignore */
    }

    let ciSummary = '(executor disabled)';
    let gitShort = '';

    if (AGENT_USE_BUILTIN_EXECUTOR) {
      const applied = await applyAgentOutput(ws.repoRoot, text, AGENT_CMD_TIMEOUT_MS);
      gitShort = await gitStatusShort(ws.repoRoot, 60_000);
      const ci = await runCiPipeline(ws.repoRoot, {
        skipInstall: depsInstalled,
        timeoutPerStepMs: AGENT_CI_STEP_TIMEOUT_MS,
      });

      if (ci.steps.some((x) => x.name === 'install' && x.code === 0)) {
        depsInstalled = true;
      }

      ciSummary = ci.summary;
      const actionLine = formatActionSummary(applied, gitShort, ciSummary);
      history += `\n--- step ${step} (system) ---\n${actionLine}`;

      if (!ci.ok) {
        recentErrors.push(ciSummary.slice(0, 600));

        if (recentErrors.length > 12) {
          recentErrors.splice(0, recentErrors.length - 12);
        }

        await updateJobStatus(pool, jobId, {
          metadata: { ...job.metadata, recentErrors },
        });
      }

      await appendLog(pool, jobId, 'info', `ci step ${step}`, {
        ok: ci.ok,
        writes: applied.writes.length,
      });

      if (ci.ok && (applied.writes.length > 0 || applied.deletes.length > 0)) {
        const mid = await gitCommitAll(ws.repoRoot, `agent: step ${step} job ${jobId.slice(0, 8)}`, 120_000);

        if (mid.ok && !mid.skipped) {
          await appendLog(pool, jobId, 'info', `auto-commit step ${step}`);
        }
      }

      for (const w of applied.writes) {
        try {
          const body = await readFileSafe(ws.repoRoot, w);

          if (body) {
            await storeMemoryEmbedding(pool, {
              projectId: job.project_id,
              jobId,
              sourceType: 'code',
              content: `${w}\n${body.slice(0, 8000)}`,
              metadata: { step, path: w },
            });
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (EXTERNAL_EXECUTOR_URL) {
      const exec = await postExternalExecutor({
        jobId,
        step,
        goal: job.goal,
        assistantExcerpt: text.slice(0, 6000),
        ciSummary: ciSummary.slice(0, 8000),
      });

      if (!exec.ok) {
        await appendLog(pool, jobId, 'warn', `external hook ${exec.status}`, { body: exec.body.slice(0, 400) });
      }
    }

    const vercelHook = typeof meta.vercelDeployHook === 'string' ? meta.vercelDeployHook : null;
    const vercelProject = typeof meta.vercelProjectId === 'string' ? meta.vercelProjectId : null;
    const shouldGitPush =
      meta.gitAutoPush === true && typeof meta.repoUrl === 'string' && meta.repoUrl.length > 0;

    if (DONE_RE.test(text)) {
      const commit = await gitCommitAll(ws.repoRoot, `agent: complete job ${jobId.slice(0, 8)}`, 120_000);
      await appendLog(pool, jobId, 'info', `git commit: ${commit.log}`, {
        ok: commit.ok,
        skipped: 'skipped' in commit ? commit.skipped : false,
      });

      if (shouldGitPush) {
        const branch =
          typeof meta.repoBranch === 'string' && /^[\w./-]+$/.test(meta.repoBranch)
            ? meta.repoBranch
            : 'main';
        const push = await gitPushOrigin(ws.repoRoot, String(meta.repoUrl), branch, AGENT_CI_STEP_TIMEOUT_MS);
        await appendLog(pool, jobId, push.ok ? 'info' : 'warn', `git push: ${push.log}`);
      }

      if (vercelHook || vercelProject) {
        if (vercelHook) {
          const hook = await triggerVercelDeployHook(vercelHook);

          if (!hook.ok) {
            await appendLog(pool, jobId, 'warn', `vercel hook: ${hook.error ?? 'failed'}`);
          } else {
            await appendLog(pool, jobId, 'info', 'vercel deploy hook triggered');
          }
        }

        if (vercelProject) {
          const dep = await triggerVercelDeploy({
            projectId: vercelProject,
            projectName:
              typeof meta.vercelProjectName === 'string' ? meta.vercelProjectName : undefined,
            teamId: typeof meta.vercelTeamId === 'string' ? meta.vercelTeamId : undefined,
          });

          if (dep.error) {
            await appendLog(pool, jobId, 'warn', `vercel api: ${dep.error}`);
          } else {
            await appendLog(pool, jobId, 'info', `vercel deployment ${dep.id ?? 'queued'}`);
          }
        }
      }

      await insertDecision(pool, {
        jobId,
        projectId: job.project_id,
        summary: text.slice(0, 500),
      });
      await updateJobStatus(pool, jobId, {
        status: 'completed',
        completed_at: new Date(),
        result_summary: text.slice(0, 4000),
        metadata: { ...job.metadata, recentErrors: [], workspaceRoot: ws.repoRoot },
      });
      await appendLog(pool, jobId, 'info', 'job completed (done marker)');

      return;
    }

    const errHint = /error|failed|exception/i.test(text) ? text.slice(0, 400) : '';

    if (errHint) {
      recentErrors.push(errHint);

      if (recentErrors.length > 12) {
        recentErrors.splice(0, recentErrors.length - 12);
      }

      await updateJobStatus(pool, jobId, {
        metadata: { ...job.metadata, recentErrors },
      });
    }
  }

  await updateJobStatus(pool, jobId, {
    status: 'failed',
    last_error: `Exhausted ${AGENT_MAX_STEPS_PER_JOB} steps without done marker`,
    completed_at: new Date(),
    metadata: { ...job.metadata, recentErrors, workspaceRoot: ws.repoRoot },
  });
  await appendLog(pool, jobId, 'error', 'max steps without completion');
}
