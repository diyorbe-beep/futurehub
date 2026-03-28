import PgBoss from 'pg-boss';

export const AGENT_QUEUE = 'agent-execute';

export async function startBoss(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString,
    schema: 'pgboss',
  });
  await boss.start();

  try {
    await boss.createQueue(AGENT_QUEUE);
  } catch {
    /* queue may already exist */
  }

  return boss;
}

export async function enqueueDbJob(
  boss: PgBoss,
  dbJobId: string,
  options?: { startAfter?: Date },
): Promise<string | null> {
  const id = await boss.send(AGENT_QUEUE, { dbJobId }, {
    retryLimit: 3,
    retryDelay: 45,
    retryBackoff: true,
    startAfter: options?.startAfter,
    singletonKey: dbJobId,
  });

  return id;
}
