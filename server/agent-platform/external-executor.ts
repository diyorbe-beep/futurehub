import { EXTERNAL_EXECUTOR_URL } from './config.ts';

export async function postExternalExecutor(
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = EXTERNAL_EXECUTOR_URL;

  if (!url) {
    return { ok: true, status: 204, body: 'no EXTERNAL_EXECUTOR_URL configured' };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, source: 'futurehub-agent-platform' }),
  });

  const body = await res.text().catch(() => '');

  return { ok: res.ok, status: res.status, body: body.slice(0, 8000) };
}
