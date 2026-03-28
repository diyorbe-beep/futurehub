import { OPENAI_API_KEY } from './config.ts';

const EMBED_MODEL = 'text-embedding-3-small';
const DIM = 1536;

export async function embedText(text: string): Promise<number[]> {
  const key = OPENAI_API_KEY;

  if (!key) {
    throw new Error('OPENAI_API_KEY is required for vector memory');
  }

  const trimmed = text.slice(0, 25_000);
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: trimmed }),
  });

  if (!res.ok) {
    const err = await res.text();

    throw new Error(`OpenAI embeddings failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    data?: Array<{ embedding: number[] }>;
  };
  const vec = data.data?.[0]?.embedding;

  if (!vec || vec.length !== DIM) {
    throw new Error('Invalid embedding response');
  }

  return vec;
}

export function vectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

export { DIM as EMBEDDING_DIMENSION };
