import { closePool, runMigrations } from './db.ts';
import { requireDatabaseUrl } from './config.ts';

requireDatabaseUrl();
await runMigrations();
await closePool();
console.info('[agent-platform] migrations applied');
