import type { Pool } from 'pg';
import { OPENAI_API_KEY } from './config.ts';
import { embedText, vectorLiteral } from './embeddings.ts';

export async function storeMemoryEmbedding(
  pool: Pool,
  input: {
    projectId: string | null;
    jobId: string | null;
    sourceType: 'code' | 'conversation' | 'decision';
    content: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!OPENAI_API_KEY) {
    return;
  }

  const vec = await embedText(input.content);
  const lit = vectorLiteral(vec);

  await pool.query(
    `INSERT INTO agent_memory_embeddings (project_id, job_id, source_type, content, embedding, metadata)
     VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)`,
    [
      input.projectId,
      input.jobId,
      input.sourceType,
      input.content.slice(0, 50_000),
      lit,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function searchMemory(
  pool: Pool,
  queryText: string,
  opts: { projectId: string | null; limit?: number },
): Promise<Array<{ content: string; source_type: string; score: number }>> {
  const limit = opts.limit ?? 12;

  if (!OPENAI_API_KEY) {
    const r = await pool.query<{ content: string; source_type: string }>(
      `SELECT content, 'conversation' AS source_type FROM agent_memory_embeddings
       WHERE ($1::uuid IS NULL OR project_id IS NULL OR project_id = $1::uuid)
       ORDER BY created_at DESC LIMIT $2`,
      [opts.projectId, limit],
    );

    return r.rows.map((row) => ({ ...row, score: 0.5 }));
  }

  const vec = await embedText(queryText);
  const lit = vectorLiteral(vec);

  const r = await pool.query<{ content: string; source_type: string; dist: number }>(
    `SELECT content, source_type, (embedding <=> $1::vector) AS dist
     FROM agent_memory_embeddings
     WHERE ($2::uuid IS NULL OR project_id IS NULL OR project_id = $2::uuid)
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [lit, opts.projectId, limit],
  );

  return r.rows.map((row) => ({
    content: row.content,
    source_type: row.source_type,
    score: 1 / (1 + row.dist),
  }));
}
