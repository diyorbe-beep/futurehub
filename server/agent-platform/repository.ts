import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AgentJobRow {
  id: string;
  project_id: string | null;
  goal: string;
  status: JobStatus;
  priority: number;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
  result_summary: string | null;
  metadata: Record<string, unknown>;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function insertProject(
  pool: Pool,
  input: { name: string; slug?: string; repo_url?: string | null },
): Promise<string> {
  const slug = input.slug ?? randomUUID().slice(0, 8);
  const r = await pool.query<{ id: string }>(
    `INSERT INTO agent_projects (name, slug, repo_url) VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       repo_url = COALESCE(EXCLUDED.repo_url, agent_projects.repo_url),
       updated_at = now()
     RETURNING id`,
    [input.name, slug, input.repo_url ?? null],
  );

  return r.rows[0]!.id;
}

export async function createJob(
  pool: Pool,
  input: {
    goal: string;
    projectId?: string | null;
    priority?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO agent_jobs (id, project_id, goal, status, priority, metadata)
     VALUES ($1, $2, $3, 'pending', $4, $5::jsonb)`,
    [id, input.projectId ?? null, input.goal, input.priority ?? 0, JSON.stringify(input.metadata ?? {})],
  );

  return id;
}

export async function getJob(pool: Pool, jobId: string): Promise<AgentJobRow | null> {
  const r = await pool.query<AgentJobRow>(`SELECT * FROM agent_jobs WHERE id = $1`, [jobId]);

  return r.rows[0] ?? null;
}

export async function updateJobStatus(
  client: Pool | PoolClient,
  jobId: string,
  patch: Partial<{
    status: JobStatus;
    last_error: string | null;
    result_summary: string | null;
    retry_count: number;
    started_at: Date | null;
    completed_at: Date | null;
    metadata: Record<string, unknown>;
  }>,
): Promise<void> {
  const sets: string[] = ['updated_at = now()'];
  const vals: unknown[] = [];
  let i = 1;

  if (patch.status !== undefined) {
    sets.push(`status = $${i++}`);
    vals.push(patch.status);
  }

  if (patch.last_error !== undefined) {
    sets.push(`last_error = $${i++}`);
    vals.push(patch.last_error);
  }

  if (patch.result_summary !== undefined) {
    sets.push(`result_summary = $${i++}`);
    vals.push(patch.result_summary);
  }

  if (patch.retry_count !== undefined) {
    sets.push(`retry_count = $${i++}`);
    vals.push(patch.retry_count);
  }

  if (patch.started_at !== undefined) {
    sets.push(`started_at = $${i++}`);
    vals.push(patch.started_at);
  }

  if (patch.completed_at !== undefined) {
    sets.push(`completed_at = $${i++}`);
    vals.push(patch.completed_at);
  }

  if (patch.metadata !== undefined) {
    sets.push(`metadata = $${i++}::jsonb`);
    vals.push(JSON.stringify(patch.metadata));
  }

  vals.push(jobId);
  await client.query(`UPDATE agent_jobs SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

export async function appendLog(
  pool: Pool,
  jobId: string,
  level: string,
  message: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO agent_job_logs (job_id, level, message, payload) VALUES ($1, $2, $3, $4::jsonb)`,
    [jobId, level, message, JSON.stringify(payload ?? {})],
  );
}

export async function listLogs(pool: Pool, jobId: string, limit = 200): Promise<
  Array<{ id: number; level: string; message: string; payload: unknown; created_at: Date }>
> {
  const r = await pool.query(
    `SELECT id, level, message, payload, created_at FROM agent_job_logs
     WHERE job_id = $1 ORDER BY id DESC LIMIT $2`,
    [jobId, limit],
  );

  return r.rows.reverse();
}

export async function insertDecision(
  pool: Pool,
  input: { jobId: string | null; projectId: string | null; summary: string },
): Promise<void> {
  await pool.query(`INSERT INTO agent_decisions (job_id, project_id, summary) VALUES ($1, $2, $3)`, [
    input.jobId,
    input.projectId,
    input.summary,
  ]);
}

export async function upsertPreference(pool: Pool, userKey: string, prefs: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO agent_user_preferences (user_key, prefs) VALUES ($1, $2::jsonb)
     ON CONFLICT (user_key) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()`,
    [userKey, JSON.stringify(prefs)],
  );
}

export async function getPreference(pool: Pool, userKey: string): Promise<Record<string, unknown> | null> {
  const r = await pool.query<{ prefs: Record<string, unknown> }>(
    `SELECT prefs FROM agent_user_preferences WHERE user_key = $1`,
    [userKey],
  );

  return r.rows[0]?.prefs ?? null;
}

export async function listJobs(
  pool: Pool,
  opts: { status?: JobStatus; limit?: number } = {},
): Promise<AgentJobRow[]> {
  const limit = opts.limit ?? 50;

  if (opts.status) {
    const r = await pool.query<AgentJobRow>(
      `SELECT * FROM agent_jobs WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
      [opts.status, limit],
    );

    return r.rows;
  }

  const r = await pool.query<AgentJobRow>(
    `SELECT * FROM agent_jobs ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );

  return r.rows;
}

export async function findStaleRunningJobs(pool: Pool, staleMs: number): Promise<AgentJobRow[]> {
  const r = await pool.query<AgentJobRow>(
    `SELECT * FROM agent_jobs
     WHERE status = 'running' AND started_at IS NOT NULL
       AND started_at < now() - (interval '1 millisecond' * $1::double precision)`,
    [staleMs],
  );

  return r.rows;
}

export async function recentDecisions(
  pool: Pool,
  projectId: string | null,
  limit = 20,
): Promise<Array<{ summary: string; created_at: Date }>> {
  const r = await pool.query<{ summary: string; created_at: Date }>(
    `SELECT summary, created_at FROM agent_decisions
     WHERE ($1::uuid IS NULL OR project_id IS NULL OR project_id = $1::uuid)
     ORDER BY created_at DESC LIMIT $2`,
    [projectId, limit],
  );

  return r.rows;
}
