import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { streamText } from '~/lib/.server/llm/stream-text';
import type { IProviderSetting, ProviderInfo } from '~/types/model';
import { generateText } from 'ai';
import { PROVIDER_LIST } from '~/utils/constants';
import { MAX_TOKENS, getEffectiveCompletionTokenLimit, isReasoningModel } from '~/lib/.server/llm/constants';
import { LLMManager } from '~/lib/modules/llm/manager';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { createScopedLogger } from '~/utils/logger';

export async function action(args: ActionFunctionArgs) {
  return llmCallAction(args);
}

async function getModelList(options: {
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, IProviderSetting>;
  serverEnv?: Record<string, string>;
}) {
  const llmManager = LLMManager.getInstance(import.meta.env);
  return llmManager.updateModelList(options);
}

const logger = createScopedLogger('api.llmcall');

/** Mirrors client `LlmErrorAlertType['errorType']` for JSON responses */
type LlmErrorAlertErrorType = 'authentication' | 'rate_limit' | 'quota' | 'network' | 'unknown';

function stripLlmErrorPrefix(message: string): string {
  return message.replace(/^(Custom error:\s*)/i, '').trim();
}

function isBillingOrCreditsError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('credit balance') ||
    m.includes('billing') ||
    m.includes('purchase credits') ||
    m.includes('insufficient credits') ||
    m.includes('payment required') ||
    m.includes('plans & billing') ||
    (m.includes('exceeded your') && m.includes('usage'))
  );
}

function jsonErrorResponse(
  message: string,
  status: number,
  extras?: { provider?: string; isRetryable?: boolean; errorType?: LlmErrorAlertErrorType },
) {
  const body: Record<string, unknown> = {
    error: true,
    message: stripLlmErrorPrefix(message),
    statusCode: status,
    isRetryable: extras?.isRetryable ?? status >= 500,
    provider: extras?.provider ?? 'unknown',
  };

  if (extras?.errorType) {
    body.errorType = extras.errorType;
  }

  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Merge Node `process.env` with Cloudflare bindings so local `remix vite:dev` sees `.env` secrets. */
function resolveServerEnv(context: ActionFunctionArgs['context']): Record<string, string> {
  const out: Record<string, string> = {};

  if (typeof process !== 'undefined' && process.env) {
    for (const key of Object.keys(process.env)) {
      const v = process.env[key];

      if (v != null && v !== '') {
        out[key] = v;
      }
    }
  }

  const cf = context.cloudflare?.env as unknown as Record<string, unknown> | undefined;

  if (cf && typeof cf === 'object') {
    for (const [key, value] of Object.entries(cf)) {
      if (value != null && value !== '') {
        out[key] = String(value);
      }
    }
  }

  return out;
}

async function llmCallAction({ context, request }: ActionFunctionArgs) {
  const { system, message, model, provider, streamOutput } = await request.json<{
    system: string;
    message: string;
    model: string;
    provider: ProviderInfo;
    streamOutput?: boolean;
  }>();

  const { name: providerName } = provider;

  // validate 'model' and 'provider' fields
  if (!model || typeof model !== 'string') {
    return jsonErrorResponse('Invalid or missing model', 400, { isRetryable: false });
  }

  if (!providerName || typeof providerName !== 'string') {
    return jsonErrorResponse('Invalid or missing provider', 400, { isRetryable: false });
  }

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);
  const serverEnv = resolveServerEnv(context);

  if (streamOutput) {
    try {
      const result = await streamText({
        options: {
          system,
        },
        messages: [
          {
            role: 'user',
            content: `${message}`,
          },
        ],
        env: serverEnv as any,
        apiKeys,
        providerSettings,
      });

      return new Response(result.textStream, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
    } catch (error: unknown) {
      if (error instanceof Response) {
        return error;
      }

      console.log(error);

      if (error instanceof Error && error.message?.includes('API key')) {
        return jsonErrorResponse('Invalid or missing API key', 401, {
          provider: providerName,
          isRetryable: false,
        });
      }

      if (error instanceof Error && isBillingOrCreditsError(error.message)) {
        return jsonErrorResponse(error.message, 402, {
          provider: providerName,
          isRetryable: false,
          errorType: 'quota',
        });
      }

      // Handle token limit errors with helpful messages
      if (
        error instanceof Error &&
        (error.message?.includes('max_tokens') ||
          error.message?.includes('token') ||
          error.message?.includes('exceeds') ||
          error.message?.includes('maximum'))
      ) {
        return jsonErrorResponse(
          `Token limit error: ${error.message}. Try reducing your request size or using a model with higher token limits.`,
          400,
          { provider: providerName, isRetryable: false },
        );
      }

      return jsonErrorResponse(error instanceof Error ? error.message : 'Internal Server Error', 500, {
        provider: providerName,
      });
    }
  } else {
    try {
      const models = await getModelList({ apiKeys, providerSettings, serverEnv });
      const modelDetails = models.find((m: ModelInfo) => m.name === model);

      if (!modelDetails) {
        return jsonErrorResponse(
          `Model "${model}" not found for provider "${providerName}". Enable the provider in settings or pick a model from the list.`,
          400,
          { provider: providerName, isRetryable: false },
        );
      }

      const dynamicMaxTokens = modelDetails
        ? getEffectiveCompletionTokenLimit(modelDetails)
        : Math.min(MAX_TOKENS, 16384);

      const providerInfo = PROVIDER_LIST.find((p) => p.name === provider.name);

      if (!providerInfo) {
        return jsonErrorResponse(`Provider "${providerName}" is not registered.`, 400, {
          provider: providerName,
          isRetryable: false,
        });
      }

      logger.info(`Generating response Provider: ${provider.name}, Model: ${modelDetails.name}`);

      // DEBUG: Log reasoning model detection
      const isReasoning = isReasoningModel(modelDetails.name);
      logger.info(`DEBUG: Model "${modelDetails.name}" detected as reasoning model: ${isReasoning}`);

      // Use maxCompletionTokens for reasoning models (o1, GPT-5), maxTokens for traditional models
      const tokenParams = isReasoning ? { maxCompletionTokens: dynamicMaxTokens } : { maxTokens: dynamicMaxTokens };

      // Filter out unsupported parameters for reasoning models
      const baseParams = {
        system,
        messages: [
          {
            role: 'user' as const,
            content: `${message}`,
          },
        ],
        model: providerInfo.getModelInstance({
          model: modelDetails.name,
          serverEnv: serverEnv as unknown as Env,
          apiKeys,
          providerSettings,
        }),
        ...tokenParams,
        toolChoice: 'none' as const,
      };

      // For reasoning models, set temperature to 1 (required by OpenAI API)
      const finalParams = isReasoning
        ? { ...baseParams, temperature: 1 } // Set to 1 for reasoning models (only supported value)
        : { ...baseParams, temperature: 0 };

      // DEBUG: Log final parameters
      logger.info(
        `DEBUG: Final params for model "${modelDetails.name}":`,
        JSON.stringify(
          {
            isReasoning,
            hasTemperature: 'temperature' in finalParams,
            hasMaxTokens: 'maxTokens' in finalParams,
            hasMaxCompletionTokens: 'maxCompletionTokens' in finalParams,
            paramKeys: Object.keys(finalParams).filter((key) => !['model', 'messages', 'system'].includes(key)),
            tokenParams,
            finalParams: Object.fromEntries(
              Object.entries(finalParams).filter(([key]) => !['model', 'messages', 'system'].includes(key)),
            ),
          },
          null,
          2,
        ),
      );

      const result = await generateText(finalParams);
      logger.info(`Generated response`);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (error: unknown) {
      if (error instanceof Response) {
        return error;
      }

      console.log(error);

      const rawMessage = error instanceof Error ? error.message : 'An unexpected error occurred';

      if (error instanceof Error && rawMessage.includes('API key')) {
        return jsonErrorResponse('Invalid or missing API key', 401, {
          provider: providerName,
          isRetryable: false,
        });
      }

      if (error instanceof Error && isBillingOrCreditsError(rawMessage)) {
        return jsonErrorResponse(rawMessage, 402, {
          provider: providerName,
          isRetryable: false,
          errorType: 'quota',
        });
      }

      if (
        error instanceof Error &&
        (rawMessage.includes('max_tokens') ||
          rawMessage.includes('token') ||
          rawMessage.includes('exceeds') ||
          rawMessage.includes('maximum'))
      ) {
        return jsonErrorResponse(
          `Token limit error: ${rawMessage}. Try reducing your request size or using a model with higher token limits.`,
          400,
          { provider: providerName, isRetryable: false },
        );
      }

      const statusCode = typeof (error as any).statusCode === 'number' ? (error as any).statusCode : 500;

      return jsonErrorResponse(stripLlmErrorPrefix(rawMessage), statusCode, {
        provider: providerName,
        isRetryable: statusCode >= 500,
      });
    }
  }
}
