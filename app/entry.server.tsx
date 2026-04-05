import type { AppLoadContext, EntryContext } from '@remix-run/cloudflare';
import { RemixServer } from '@remix-run/react';
import { isbot } from 'isbot';
import { renderToReadableStream } from 'react-dom/server';
import { renderHeadToString } from 'remix-island';
import { Head } from './root';
import { themeStore } from '~/lib/stores/theme';

export const runtime = 'edge';

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  const isBot = isbot(request.headers.get('user-agent') || '');
  const head = renderHeadToString({ request, remixContext, Head });

  const stream = await renderToReadableStream(<RemixServer context={remixContext} url={request.url} />, {
    signal: request.signal,
    onError(error: unknown) {
      console.error(error);
      responseStatusCode = 500;
    },
  });

  if (isBot) {
    await stream.allReady;
  }

  responseHeaders.set('Content-Type', 'text/html');
  responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
  responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

  const handler = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      controller.enqueue(
        encoder.encode(
          `<!DOCTYPE html><html lang="en" data-theme="${themeStore.value}"><head>${head}</head><body><div id="root" class="w-full h-full">`,
        ),
      );

      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        controller.enqueue(value);
      }

      controller.enqueue(encoder.encode('</div></body></html>'));
      controller.close();
    },
  });

  return new Response(handler, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
