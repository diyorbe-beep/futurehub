import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { AGENT_STALE_RUNNING_MS } from './config.ts';
import { appendLog, findStaleRunningJobs, updateJobStatus } from './repository.ts';
import { enqueueDbJob } from './queue.ts';

export async function runSchedulerTick(pool: Pool, boss: PgBoss): Promise<void> {
  const stale = await findStaleRunningJobs(pool, AGENT_STALE_RUNNING_MS);

  for (const j of stale) {
    await appendLog(pool, j.id, 'warn', 'scheduler: stale running → pending');
    await updateJobStatus(pool, j.id, {
      status: 'pending',
      started_at: null,
    });
    await enqueueDbJob(boss, j.id);
  }
}

export async function enqueueAllPending(pool: Pool, boss: PgBoss): Promise<void> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM agent_jobs WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 200`,
  );

  for (const row of r.rows) {
    await enqueueDbJob(boss, row.id);
  }
}
