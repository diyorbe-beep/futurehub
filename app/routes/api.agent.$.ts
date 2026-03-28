import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';

function agentBaseUrl(context: LoaderFunctionArgs['context']): string | undefined {
  const cf = context.cloudflare?.env as unknown as Record<string, string> | undefined;

  if (cf?.AGENT_SERVER_URL) {
    return cf.AGENT_SERVER_URL;
  }

  if (typeof process !== 'undefined' && process.env.AGENT_SERVER_URL) {
    return process.env.AGENT_SERVER_URL;
  }

  return undefined;
}

function agentSecret(context: LoaderFunctionArgs['context']): string | undefined {
  const cf = context.cloudflare?.env as unknown as Record<string, string> | undefined;

  if (cf?.AGENT_API_SECRET) {
    return cf.AGENT_API_SECRET;
  }

  if (typeof process !== 'undefined' && process.env.AGENT_API_SECRET) {
    return process.env.AGENT_API_SECRET;
  }

  return undefined;
}

async function proxy(request: Request, splat: string | undefined, context: LoaderFunctionArgs['context']) {
  const base = agentBaseUrl(context);

  if (!base) {
    return new Response(JSON.stringify({ error: 'AGENT_SERVER_URL not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const pathPart = splat ?? '';
  const target = `${base.replace(/\/$/, '')}/v1/${pathPart}${url.search}`;
  const headers = new Headers();
  const secret = agentSecret(context);

  if (secret) {
    headers.set('Authorization', `Bearer ${secret}`);
  }

  const ct = request.headers.get('Content-Type');

  if (ct) {
    headers.set('Content-Type', ct);
  }

  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();

  const res = await fetch(target, {
    method: request.method,
    headers,
    body: body && body.byteLength ? body : undefined,
    redirect: 'manual',
  });

  return new Response(res.body, { status: res.status, headers: res.headers });
}

export async function loader({ request, params, context }: LoaderFunctionArgs) {
  return proxy(request, params['*'], context);
}

export async function action({ request, params, context }: ActionFunctionArgs) {
  return proxy(request, params['*'], context);
}
