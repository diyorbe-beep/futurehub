import { WebContainer } from '@webcontainer/api';
import { WORK_DIR_NAME } from '~/utils/constants';
import { cleanStackTrace } from '~/utils/stacktrace';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

export let webcontainer: Promise<WebContainer> = new Promise(() => {
  // noop for ssr
});

if (!import.meta.env.SSR) {
  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve()
      .then(() => {
        return WebContainer.boot({
          coep: 'credentialless',
          workdirName: WORK_DIR_NAME,
          forwardPreviewErrors: true, // Enable error forwarding from iframes
        });
      })
      .then(async (webcontainer) => {
        webcontainerContext.loaded = true;

        const { workbenchStore } = await import('~/lib/stores/workbench');

        const response = await fetch('/inspector-script.js');
        const inspectorScript = await response.text();
        await webcontainer.setPreviewScript(inspectorScript);

        // Listen for preview errors (JS exceptions, unhandled rejections, console.error from preview script)
        webcontainer.on('preview-message', (message) => {
          console.log('WebContainer preview message:', message);

          const buildErrorMarker = '__FUTUREHUB_PREVIEW_BUILD_ERROR__';

          const isForwardedBuildError =
            message.type === 'PREVIEW_CONSOLE_ERROR' &&
            Array.isArray(message.args) &&
            message.args.some(
              (a) =>
                typeof a === 'string' && (a.includes(buildErrorMarker) || a.includes('__BOLT_PREVIEW_BUILD_ERROR__')),
            );

          if (isForwardedBuildError) {
            const textParts = message.args
              .map((a) => {
                if (typeof a === 'string') {
                  return a;
                }

                try {
                  return JSON.stringify(a);
                } catch {
                  return String(a);
                }
              })
              .filter(
                (s) =>
                  s && !s.includes('__FUTUREHUB_PREVIEW_BUILD_ERROR__') && !s.includes('__BOLT_PREVIEW_BUILD_ERROR__'),
              );
            const body = textParts.join('\n').trim() || 'Build / dev server error in preview';
            workbenchStore.actionAlert.set({
              type: 'preview',
              title: 'Preview build error',
              description: body.slice(0, 240),
              content: `Error at ${message.pathname}${message.search}${message.hash}\nPort: ${message.port}\n\n${body}\n\nConsole stack:\n${cleanStackTrace(message.stack || '')}`,
              source: 'preview',
            });

            return;
          }

          // Handle both uncaught exceptions and unhandled promise rejections
          if (message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' || message.type === 'PREVIEW_UNHANDLED_REJECTION') {
            const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';
            const title = isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception';
            workbenchStore.actionAlert.set({
              type: 'preview',
              title,
              description: 'message' in message ? message.message : 'Unknown error',
              content: `Error occurred at ${message.pathname}${message.search}${message.hash}\nPort: ${message.port}\n\nStack trace:\n${cleanStackTrace(message.stack || '')}`,
              source: 'preview',
            });
          }
        });

        return webcontainer;
      });

  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }
}
