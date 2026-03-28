import { VERCEL_TOKEN } from '../config.ts';

/** Deploy hook URL from Vercel project → Settings → Git → Deploy Hooks */
export async function triggerVercelDeployHook(hookUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(hookUrl, { method: 'POST' });

    if (!res.ok) {
      return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 400)}` };
    }

    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Create deployment when project is linked to Vercel (token + project id). */
export async function triggerVercelDeploy(input: {
  projectId: string;
  projectName?: string;
  teamId?: string;
}): Promise<{ id?: string; error?: string }> {
  if (!VERCEL_TOKEN) {
    return { error: 'VERCEL_TOKEN not configured' };
  }

  const q = input.teamId ? `?teamId=${encodeURIComponent(input.teamId)}` : '';
  const res = await fetch(`https://api.vercel.com/v13/deployments${q}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: input.projectName ?? 'agent-deploy',
      project: input.projectId,
      target: 'production',
    }),
  });

  if (!res.ok) {
    const t = await res.text();

    return { error: `${res.status}: ${t.slice(0, 500)}` };
  }

  const data = (await res.json()) as { id?: string };

  return { id: data.id };
}
