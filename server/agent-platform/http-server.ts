import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { AGENT_API_SECRET, AGENT_SERVER_PORT } from './config.ts';
import {
  appendLog,
  createJob,
  getJob,
  insertProject,
  listJobs,
  listLogs,
  updateJobStatus,
  upsertPreference,
} from './repository.ts';
import { enqueueDbJob } from './queue.ts';
import { storeMemoryEmbedding } from './memory-store.ts';

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function unauthorized(res: ServerResponse) {
  json(res, 401, { error: 'unauthorized' });
}

function authOk(req: IncomingMessage): boolean {
  if (!AGENT_API_SECRET) {
    return true;
  }

  const h = req.headers.authorization;

  if (!h?.startsWith('Bearer ')) {
    return false;
  }

  return h.slice(7) === AGENT_API_SECRET;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const c of req) {
    chunks.push(c as Buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

export function startHttpServer(opts: { pool: Pool; boss: PgBoss }) {
  const { pool, boss } = opts;

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();

      return;
    }

    if (!authOk(req)) {
      unauthorized(res);

      return;
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1`);

    try {
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        json(res, 200, { ok: true, service: 'futurehub-agent-platform' });

        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/projects') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as {
          name?: string;
          slug?: string;
          repo_url?: string;
        };

        if (!body.name) {
          json(res, 400, { error: 'name required' });

          return;
        }

        const id = await insertProject(pool, {
          name: body.name,
          slug: body.slug,
          repo_url: body.repo_url ?? null,
        });
        json(res, 201, { id });

        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/jobs') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as {
          goal?: string;
          projectId?: string | null;
          priority?: number;
          metadata?: Record<string, unknown>;
        };

        if (!body.goal?.trim()) {
          json(res, 400, { error: 'goal required' });

          return;
        }

        const id = await createJob(pool, {
          goal: body.goal.trim(),
          projectId: body.projectId ?? null,
          priority: body.priority,
          metadata: body.metadata,
        });
        await enqueueDbJob(boss, id);
        await appendLog(pool, id, 'info', 'job queued on server');
        json(res, 201, { id, status: 'pending' });

        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/jobs') {
        const status = url.searchParams.get('status') as
          | 'pending'
          | 'running'
          | 'completed'
          | 'failed'
          | null;
        const rows = await listJobs(pool, {
          status: status ?? undefined,
          limit: Number(url.searchParams.get('limit') ?? '50'),
        });
        json(res, 200, { jobs: rows });

        return;
      }

      const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);

      if (req.method === 'GET' && jobMatch) {
        const row = await getJob(pool, jobMatch[1]);

        if (!row) {
          json(res, 404, { error: 'not found' });

          return;
        }

        json(res, 200, { job: row });

        return;
      }

      const retryMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/retry$/);

      if (req.method === 'POST' && retryMatch) {
        const row = await getJob(pool, retryMatch[1]);

        if (!row) {
          json(res, 404, { error: 'not found' });

          return;
        }

        if (row.retry_count >= row.max_retries) {
          json(res, 400, { error: 'max_retries exceeded' });

          return;
        }

        const next = row.retry_count + 1;

        await updateJobStatus(pool, row.id, {
          status: 'pending',
          retry_count: next,
          last_error: null,
          started_at: null,
          completed_at: null,
        });
        await appendLog(pool, row.id, 'info', `manual retry ${next}/${row.max_retries}`);
        await enqueueDbJob(boss, row.id, {
          startAfter: new Date(Date.now() + 2000),
        });
        json(res, 200, { id: row.id, status: 'pending', retry_count: next });

        return;
      }

      const logsMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/logs$/);

      if (req.method === 'GET' && logsMatch) {
        const row = await getJob(pool, logsMatch[1]);

        if (!row) {
          json(res, 404, { error: 'not found' });

          return;
        }

        const logs = await listLogs(pool, logsMatch[1], Number(url.searchParams.get('limit') ?? '200'));
        json(res, 200, { jobId: logsMatch[1], logs });

        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/memory/ingest') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as {
          projectId?: string | null;
          jobId?: string | null;
          sourceType?: 'code' | 'conversation' | 'decision';
          content?: string;
          metadata?: Record<string, unknown>;
        };

        if (!body.content?.trim() || !body.sourceType) {
          json(res, 400, { error: 'content and sourceType required' });

          return;
        }

        await storeMemoryEmbedding(pool, {
          projectId: body.projectId ?? null,
          jobId: body.jobId ?? null,
          sourceType: body.sourceType,
          content: body.content.trim(),
          metadata: body.metadata,
        });
        json(res, 201, { ok: true });

        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/preferences') {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as { userKey?: string; prefs?: Record<string, unknown> };

        if (!body.userKey || !body.prefs) {
          json(res, 400, { error: 'userKey and prefs required' });

          return;
        }

        await upsertPreference(pool, body.userKey, body.prefs);
        json(res, 200, { ok: true });

        return;
      }

      json(res, 404, { error: 'not found' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      json(res, 500, { error: msg });
    }
  });

  server.listen(AGENT_SERVER_PORT, () => {
    console.info(`[agent-platform] http://127.0.0.1:${AGENT_SERVER_PORT}`);
  });

  return server;
}
