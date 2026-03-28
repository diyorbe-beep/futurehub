import { closePool, getPool, runMigrations } from './db.ts';
import { AGENT_API_SECRET, AGENT_JOB_CONCURRENCY, requireDatabaseUrl } from './config.ts';
import { AGENT_QUEUE, enqueueDbJob, startBoss } from './queue.ts';
import { runAgentJob } from './job-processor.ts';
import { startHttpServer } from './http-server.ts';
import { enqueueAllPending, runSchedulerTick } from './scheduler.ts';
import { appendLog, getJob, updateJobStatus } from './repository.ts';

const connectionString = requireDatabaseUrl();

if (!AGENT_API_SECRET) {
  console.warn('[agent-platform] AGENT_API_SECRET is empty — HTTP API is open to the network');
}

await runMigrations();
const pool = getPool();
const boss = await startBoss(connectionString);

await boss.work(AGENT_QUEUE, { localConcurrency: AGENT_JOB_CONCURRENCY }, async (jobs) => {
  for (const job of jobs) {
    const dbJobId = (job.data as { dbJobId?: string } | null)?.dbJobId;

    if (!dbJobId) {
      continue;
    }

    const row = await getJob(pool, dbJobId);

    if (!row || row.status === 'completed') {
      continue;
    }

    if (row.status === 'failed' && row.retry_count >= row.max_retries) {
      continue;
    }

    try {
      await runAgentJob(pool, dbJobId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await appendLog(pool, dbJobId, 'error', `worker crash: ${msg}`);
      await updateJobStatus(pool, dbJobId, {
        status: 'failed',
        last_error: msg,
        completed_at: new Date(),
      });
    }
  }
});

await enqueueAllPending(pool, boss);
setInterval(() => {
  void runSchedulerTick(pool, boss);
}, 60_000);

startHttpServer({ pool, boss });

const shutdown = async () => {
  console.info('[agent-platform] shutting down');
  await boss.stop({ graceful: true, timeout: 15_000 });
  await closePool();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

console.info('[agent-platform] worker online');
