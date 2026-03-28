import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

export const DATABASE_URL = process.env.DATABASE_URL ?? '';
export const AGENT_API_SECRET = process.env.AGENT_API_SECRET ?? '';
export const AGENT_SERVER_PORT = Number(process.env.AGENT_SERVER_PORT ?? '8788');
export const AGENT_JOB_CONCURRENCY = Math.max(1, Number(process.env.AGENT_JOB_CONCURRENCY ?? '3'));
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
export const AGENT_MODEL = process.env.AGENT_MODEL ?? 'gpt-4o-mini';
export const EXTERNAL_EXECUTOR_URL = process.env.EXTERNAL_EXECUTOR_URL ?? '';
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? process.env.GITHUB_API_KEY ?? '';
export const VERCEL_TOKEN = process.env.VERCEL_TOKEN ?? '';
export const AGENT_STALE_RUNNING_MS = Number(process.env.AGENT_STALE_RUNNING_MS ?? String(2 * 60 * 60 * 1000));
export const AGENT_MAX_STEPS_PER_JOB = Math.min(512, Math.max(8, Number(process.env.AGENT_MAX_STEPS_PER_JOB ?? '64')));
export const AGENT_WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT ?? 'data/agent-workspaces';
export const AGENT_GIT_TIMEOUT_MS = Number(process.env.AGENT_GIT_TIMEOUT_MS ?? '600000');
export const AGENT_CMD_TIMEOUT_MS = Number(process.env.AGENT_CMD_TIMEOUT_MS ?? '300000');
export const AGENT_CI_STEP_TIMEOUT_MS = Number(process.env.AGENT_CI_STEP_TIMEOUT_MS ?? '600000');
export const AGENT_USE_BUILTIN_EXECUTOR = (process.env.AGENT_USE_BUILTIN_EXECUTOR ?? 'true') !== 'false';

export function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the agent platform');
  }

  return DATABASE_URL;
}
