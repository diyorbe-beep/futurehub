import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts } from '~/lib/hooks';
import { description, useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
import { createSampler } from '~/utils/sampler';
import { getTemplates, selectStarterTemplate } from '~/utils/selectStarterTemplate';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { filesToArtifacts } from '~/utils/fileUtils';
import { supabaseConnection } from '~/lib/stores/supabase';
import { defaultDesignScheme, type DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import type { TextUIPart, FileUIPart, Attachment } from '@ai-sdk/ui-utils';
import { useMCPStore } from '~/lib/stores/mcp';
import type { LlmErrorAlertType } from '~/types/actions';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { rewriteLatestUserProviderModel } from '~/lib/autoChatRecovery';
import { isDeveloperAgentMode, developerAutonomousLoopStore } from '~/lib/stores/settings';
import { developerAgentRuntime, resetDeveloperAgentRuntime } from '~/lib/stores/developerAgentRuntime';
import {
  agentJobKick,
  agentJobs,
  agentResumeAfterSafety,
  appendAgentJobLog,
  autonomousAgentPaused,
  getNextPendingJob,
  markAgentJobDone,
  markAgentJobFailed,
  markAgentJobRunning,
  parseSubtasksFromAssistant,
  updateAgentJob,
} from '~/lib/stores/agentJobs';
import { addCompressedNote, getAgentMemorySnippet, recordAgentDecision } from '~/lib/stores/agentMemory';

const logger = createScopedLogger('Chat');

/** Runaway guard only; normal stop is <developer_agent_status done="true" />. User can resume via Agent jobs panel. */
const AUTONOMOUS_SAFETY_CAP = 2048;

const DEVELOPER_DONE_RE = /<developer_agent_status[^>]*\bdone\s*=\s*["']true["']/i;

function getAssistantText(message: Pick<Message, 'content'>): string {
  const raw = message.content as string | Array<{ type?: string; text?: string }> | undefined;

  if (typeof raw === 'string') {
    return raw;
  }

  if (Array.isArray(raw)) {
    return raw.map((p) => (p?.type === 'text' ? (p.text ?? '') : '')).join('');
  }

  return '';
}

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat } = useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  return (
    <>
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
        />
      )}
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    streamPaused: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, streamPaused, parseMessages, storeMessageHistory } = options;

    if (!streamPaused) {
      parseMessages(messages, isLoading);
    }

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  },
  50,
);

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
}

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);
    const files = useStore(workbenchStore.files);
    const [designScheme, setDesignScheme] = useState<DesignScheme>(defaultDesignScheme);
    const actionAlert = useStore(workbenchStore.alert);
    const deployAlert = useStore(workbenchStore.deployAlert);
    const supabaseConn = useStore(supabaseConnection);
    const selectedProject = supabaseConn.stats?.projects?.find(
      (project) => project.id === supabaseConn.selectedProjectId,
    );
    const supabaseAlert = useStore(workbenchStore.supabaseAlert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled, developerAgentMode } =
      useSettings();
    const [llmErrorAlert, setLlmErrorAlert] = useState<LlmErrorAlertType | undefined>(undefined);
    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });
    const { showChat, streamPaused } = useStore(chatStore);
    const [animationScope, animate] = useAnimate();
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [bootstrapModelList, setBootstrapModelList] = useState<ModelInfo[]>([]);
    const [chatMode, setChatMode] = useState<'discuss' | 'build'>('build');
    const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
    const mcpSettings = useMCPStore((state) => state.settings);

    const apiKeysSignature = useMemo(() => JSON.stringify(apiKeys), [apiKeys]);
    const activeProviderNamesSig = useMemo(() => activeProviders.map((p) => p.name).join('\0'), [activeProviders]);

    const messagesRef = useRef<Message[]>(initialMessages);
    const reloadRef = useRef<(() => void) | null>(null);
    const setMessagesRef = useRef<((messages: Message[] | ((curr: Message[]) => Message[])) => void) | null>(null);
    const activeProvidersRef = useRef(activeProviders);
    activeProvidersRef.current = activeProviders;

    const bootstrapModelListRef = useRef(bootstrapModelList);
    bootstrapModelListRef.current = bootstrapModelList;

    const providerRef = useRef(provider);
    providerRef.current = provider;

    const modelRef = useRef(model);
    modelRef.current = model;

    const chatModeRef = useRef(chatMode);
    chatModeRef.current = chatMode;

    const appendRef = useRef<(message: any, options?: any) => void>(() => {
      /* wired below before first use */
    });
    const autonomousIterationRef = useRef(0);
    const activeJobIdRef = useRef<string | null>(null);
    const tryStartPendingJobRef = useRef<() => void>(() => {
      /* wired below before first use */
    });
    const isLoadingRef = useRef(false);
    const fakeLoadingRef = useRef(false);

    const jobKickTs = useStore(agentJobKick);
    const didInitialProviderPickRef = useRef(false);
    const sendMessageRef = useRef<(e: React.UIEvent, msg?: string) => Promise<void>>(async () => {
      /* wired below before first use */
    });
    const autoFixActionCountRef = useRef(0);
    const autoFixScheduledRef = useRef(false);

    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      append,
      setMessages,
      reload,
      error,
      data: chatData,
      setData,
      addToolResult,
    } = useChat({
      api: '/api/chat',
      body: {
        apiKeys,
        files,
        promptId,
        contextOptimization: contextOptimizationEnabled,
        chatMode,
        designScheme,
        developerAgentMode,
        agentMemoryContext: getAgentMemorySnippet(2500),
        supabase: {
          isConnected: supabaseConn.isConnected,
          hasSelectedProject: !!selectedProject,
          credentials: {
            supabaseUrl: supabaseConn?.credentials?.supabaseUrl,
            anonKey: supabaseConn?.credentials?.anonKey,
          },
        },
        maxLLMSteps: mcpSettings.maxLLMSteps,
      },
      sendExtraMessageFields: true,
      onError: (e) => {
        setFakeLoading(false);
        handleError(e, 'chat');
      },
      onFinish: (message, response) => {
        chatStore.setKey('streamPaused', false);

        const usage = response.usage;
        setData(undefined);

        if (usage) {
          console.log('Token usage:', usage);
          logStore.logProvider('Chat response completed', {
            component: 'Chat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');

        if (chatStore.get().aborted) {
          developerAgentRuntime.setKey('running', false);

          return;
        }

        if (chatStore.get().streamPaused || chatModeRef.current !== 'build') {
          return;
        }

        if (!isDeveloperAgentMode.get() || !developerAutonomousLoopStore.get()) {
          return;
        }

        if (autonomousAgentPaused.get()) {
          return;
        }

        const text = getAssistantText(message);
        const jid = activeJobIdRef.current;

        if (jid) {
          const sub = parseSubtasksFromAssistant(text);

          if (sub?.length) {
            updateAgentJob(jid, { subtasks: sub });
          }

          const stepN = autonomousIterationRef.current;

          if (stepN > 0 && stepN % 8 === 0) {
            addCompressedNote(text.slice(0, 600));
          }
        }

        if (DEVELOPER_DONE_RE.test(text)) {
          developerAgentRuntime.set({
            running: false,
            phase: 'complete',
            step: autonomousIterationRef.current,
            maxSteps: AUTONOMOUS_SAFETY_CAP,
          });

          if (jid) {
            markAgentJobDone(jid);
            recordAgentDecision(`Job ${jid} completed: ${text.slice(0, 280)}`);
          }

          activeJobIdRef.current = null;
          autonomousIterationRef.current = 0;
          toast.success('AI Developer: goal complete');

          globalThis.setTimeout(() => tryStartPendingJobRef.current(), 700);

          return;
        }

        if (autonomousIterationRef.current >= AUTONOMOUS_SAFETY_CAP) {
          autonomousAgentPaused.set(true);

          if (jid) {
            appendAgentJobLog(jid, `safety pause after ${AUTONOMOUS_SAFETY_CAP} autonomous iterations`);
          }

          developerAgentRuntime.setKey('running', false);
          toast.warn(
            `Autonomous run paused after ${AUTONOMOUS_SAFETY_CAP} iterations (safety). Use “Resume autonomous run” in Agent jobs.`,
          );

          return;
        }

        autonomousIterationRef.current += 1;

        const step = autonomousIterationRef.current;

        developerAgentRuntime.set({
          running: true,
          phase: 'working',
          step,
          maxSteps: AUTONOMOUS_SAFETY_CAP,
        });

        const mem = getAgentMemorySnippet(1400);
        const memBlock = mem ? `\n[AGENT_MEMORY]\n${mem}\n` : '';

        globalThis.setTimeout(() => {
          if (chatStore.get().aborted || chatStore.get().streamPaused || autonomousAgentPaused.get()) {
            developerAgentRuntime.setKey('running', false);

            return;
          }

          appendRef.current({
            role: 'user',
            content: `[Model: ${modelRef.current}]\n\n[Provider: ${providerRef.current.name}]\n\n[DEVELOPER_AGENT_AUTONOMOUS_STEP ${step}]\n${memBlock}Continue until the task is fully done: plan→build→run→detect errors→fix→retry. Output <developer_agent_status done="true" /> only when finished (or deploy="manual" if hosting requires external credentials). Do not ask the user questions.`,
          });
        }, 1100);
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });

    reloadRef.current = reload;
    setMessagesRef.current = setMessages;
    messagesRef.current = messages;
    appendRef.current = append;
    isLoadingRef.current = isLoading;
    fakeLoadingRef.current = fakeLoading;

    tryStartPendingJobRef.current = () => {
      if (chatStore.get().aborted) {
        return;
      }

      if (agentResumeAfterSafety.get()) {
        if (isLoadingRef.current || fakeLoadingRef.current) {
          return;
        }

        const running = agentJobs.get().find((j) => j.status === 'running');

        if (!running) {
          agentResumeAfterSafety.set(false);
        } else {
          agentResumeAfterSafety.set(false);
          activeJobIdRef.current = running.id;
          autonomousIterationRef.current = 0;
          appendAgentJobLog(running.id, 'resumed after safety pause');

          const mem = getAgentMemorySnippet(1400);
          const memBlock = mem ? `\n[AGENT_MEMORY]\n${mem}\n` : '';
          appendRef.current({
            role: 'user',
            content: `[Model: ${modelRef.current}]\n\n[Provider: ${providerRef.current.name}]\n\n[DEVELOPER_AGENT_AUTONOMOUS_STEP 1]\n${memBlock}Continue until the task is fully done: plan→build→run→detect errors→fix→retry. Output <developer_agent_status done="true" /> only when finished (or deploy="manual" if hosting requires external credentials). Do not ask the user questions.`,
          });
          developerAgentRuntime.set({
            running: true,
            phase: 'working',
            step: 1,
            maxSteps: AUTONOMOUS_SAFETY_CAP,
          });

          return;
        }
      }

      if (isLoadingRef.current || fakeLoadingRef.current) {
        return;
      }

      if (!isDeveloperAgentMode.get() || !developerAutonomousLoopStore.get()) {
        return;
      }

      if (autonomousAgentPaused.get()) {
        return;
      }

      if (agentJobs.get().some((j) => j.status === 'running')) {
        return;
      }

      const pending = getNextPendingJob();

      if (!pending) {
        return;
      }

      markAgentJobRunning(pending.id);
      activeJobIdRef.current = pending.id;
      autonomousIterationRef.current = 0;
      autonomousAgentPaused.set(false);

      const mem = getAgentMemorySnippet(1200);
      const memBlock = mem ? `\n[AGENT_MEMORY]\n${mem}\n` : '';
      appendRef.current({
        role: 'user',
        content: `[Model: ${modelRef.current}]\n\n[Provider: ${providerRef.current.name}]\n\n[AGENT_JOB id=${pending.id}]${memBlock}\n${pending.goal}`,
      });
    };

    useEffect(() => {
      const id = window.setTimeout(() => tryStartPendingJobRef.current(), 200);

      return () => window.clearTimeout(id);
    }, [jobKickTs, isLoading, fakeLoading]);

    useEffect(() => {
      const prompt = searchParams.get('prompt');

      // console.log(prompt, searchParams, model, provider);

      if (prompt) {
        setSearchParams({});
        runAnimation();
        append({
          role: 'user',
          content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
        });
      }
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 520 : 340;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    useEffect(() => {
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        streamPaused,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, streamPaused, parseMessages]);

    const toggleStreamPause = useCallback(() => {
      chatStore.setKey('streamPaused', !chatStore.get().streamPaused);
    }, []);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      const jid = activeJobIdRef.current;

      if (jid) {
        markAgentJobFailed(jid, 'User aborted stream');
        activeJobIdRef.current = null;
      }

      agentResumeAfterSafety.set(false);

      stop();
      chatStore.setKey('streamPaused', false);
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();
      autonomousIterationRef.current = 0;
      resetDeveloperAgentRuntime();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    const handleError = useCallback(
      (error: any, context: 'chat' | 'template' | 'llmcall' = 'chat') => {
        logger.error(`${context} request failed`, error);

        stop();
        setFakeLoading(false);
        chatStore.setKey('streamPaused', false);

        let errorInfo = {
          message: 'An unexpected error occurred',
          isRetryable: true,
          statusCode: 500,
          provider: provider.name,
          type: 'unknown' as const,
          retryDelay: 0,
        };

        if (error.message) {
          try {
            const parsed = JSON.parse(error.message);

            if (parsed.error || parsed.message) {
              errorInfo = { ...errorInfo, ...parsed };
            } else {
              errorInfo.message = error.message;
            }
          } catch {
            errorInfo.message = error.message;
          }
        }

        const msgLower = errorInfo.message.toLowerCase();
        const isBillingOrCredits =
          msgLower.includes('credit balance') ||
          msgLower.includes('plans & billing') ||
          msgLower.includes('purchase credits') ||
          msgLower.includes('insufficient credits') ||
          msgLower.includes('payment required') ||
          (msgLower.includes('billing') && msgLower.includes('upgrade'));

        const alertProvider =
          typeof (errorInfo as any).provider === 'string' && (errorInfo as any).provider !== 'unknown'
            ? (errorInfo as any).provider
            : provider.name;

        const serverErrorType = (errorInfo as any).errorType as LlmErrorAlertType['errorType'] | undefined;
        const validServerTypes: LlmErrorAlertType['errorType'][] = [
          'authentication',
          'rate_limit',
          'quota',
          'network',
          'unknown',
        ];

        let errorType: LlmErrorAlertType['errorType'] =
          serverErrorType && validServerTypes.includes(serverErrorType) ? serverErrorType : 'unknown';
        let title = 'Request Failed';

        if (errorType === 'unknown') {
          if (errorInfo.statusCode === 401 || msgLower.includes('api key')) {
            errorType = 'authentication';
            title = 'Authentication Error';
          } else if (errorInfo.statusCode === 429 || msgLower.includes('rate limit')) {
            errorType = 'rate_limit';
            title = 'Rate Limit Exceeded';
          } else if (errorInfo.statusCode === 402 || isBillingOrCredits || msgLower.includes('quota')) {
            errorType = 'quota';
            title = 'Insufficient credits or quota';
          } else if (errorInfo.statusCode >= 500) {
            errorType = 'network';
            title = 'Server Error';
          }
        } else if (errorType === 'quota') {
          title = 'Insufficient credits or quota';
        }

        logStore.logError(`${context} request failed`, error, {
          component: 'Chat',
          action: 'request',
          error: errorInfo.message,
          context,
          retryable: errorInfo.isRetryable,
          errorType,
          provider: provider.name,
        });

        if (context === 'chat' && errorType !== 'authentication') {
          const list = activeProvidersRef.current;
          const models = bootstrapModelListRef.current;

          if (list.length > 1 && models.length > 0) {
            const currentName = providerRef.current.name;
            const idx = list.findIndex((p) => p.name === currentName);
            const candidates = idx >= 0 ? list.slice(idx + 1) : list;
            const nextProv = candidates.find((p) => models.some((m) => m.provider === p.name));
            const nextModel = nextProv ? models.find((m) => m.provider === nextProv.name) : undefined;

            const shouldRetryWithNext =
              nextProv &&
              nextModel &&
              (errorType === 'network' ||
                errorType === 'rate_limit' ||
                errorType === 'quota' ||
                (errorType === 'unknown' && (errorInfo.statusCode >= 500 || errorInfo.statusCode === 0)));

            if (shouldRetryWithNext) {
              const fullP = (PROVIDER_LIST.find((p) => p.name === nextProv.name) || nextProv) as ProviderInfo;
              const sm = setMessagesRef.current;
              const rl = reloadRef.current;

              if (sm && rl) {
                setProvider(fullP);
                setModel(nextModel.name);
                Cookies.set('selectedProvider', fullP.name, { expires: 30 });
                Cookies.set('selectedModel', nextModel.name, { expires: 30 });
                sm(rewriteLatestUserProviderModel(messagesRef.current, nextModel.name, fullP.name));
                setLlmErrorAlert(undefined);
                toast.info(`Switched to ${fullP.name} — retrying your request…`);
                queueMicrotask(() => rl());
                setData([]);

                return;
              }
            }
          }
        }

        const jid = activeJobIdRef.current;

        if (jid && context === 'chat') {
          markAgentJobFailed(jid, errorInfo.message.slice(0, 500));
          activeJobIdRef.current = null;
        }

        // Create API error alert
        setLlmErrorAlert({
          type: 'error',
          title,
          description: errorInfo.message,
          provider: alertProvider,
          errorType,
        });
        setData([]);
      },
      [stop, setProvider, setModel, setData],
    );

    const clearApiErrorAlert = useCallback(() => {
      setLlmErrorAlert(undefined);
    }, []);

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);

      chatStore.setKey('started', true);

      setChatStarted(true);
    };

    // Helper function to create message parts array from text and images
    const createMessageParts = (text: string, images: string[] = []): Array<TextUIPart | FileUIPart> => {
      // Create an array of properly typed message parts
      const parts: Array<TextUIPart | FileUIPart> = [
        {
          type: 'text',
          text,
        },
      ];

      // Add image parts if any
      images.forEach((imageData) => {
        // Extract correct MIME type from the data URL
        const mimeType = imageData.split(';')[0].split(':')[1] || 'image/jpeg';

        // Create file part according to AI SDK format
        parts.push({
          type: 'file',
          mimeType,
          data: imageData.replace(/^data:image\/[^;]+;base64,/, ''),
        });
      });

      return parts;
    };

    // Helper function to convert File[] to Attachment[] for AI SDK
    const filesToAttachments = async (files: File[]): Promise<Attachment[] | undefined> => {
      if (files.length === 0) {
        return undefined;
      }

      const attachments = await Promise.all(
        files.map(
          (file) =>
            new Promise<Attachment>((resolve) => {
              const reader = new FileReader();

              reader.onloadend = () => {
                resolve({
                  name: file.name,
                  contentType: file.type,
                  url: reader.result as string,
                });
              };
              reader.readAsDataURL(file);
            }),
        ),
      );

      return attachments;
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      const isAutonomousContinuation = messageContent.includes('[DEVELOPER_AGENT_AUTONOMOUS_STEP]');
      const isQueuedJobInjection = /\[AGENT_JOB id=/.test(messageContent);

      if (!isAutonomousContinuation && !isQueuedJobInjection) {
        const jid = activeJobIdRef.current;

        if (jid) {
          const j = agentJobs.get().find((x) => x.id === jid);

          if (j?.status === 'running') {
            markAgentJobFailed(jid, 'Interrupted by manual user message');
            activeJobIdRef.current = null;
            developerAgentRuntime.setKey('running', false);
          }
        }
      }

      if (!isAutonomousContinuation && !isQueuedJobInjection) {
        autonomousIterationRef.current = 0;

        if (developerAgentRuntime.get().running || developerAgentRuntime.get().step > 0) {
          resetDeveloperAgentRuntime();
        }
      }

      if (isLoading) {
        abort();
        return;
      }

      let finalMessageContent = messageContent;

      if (selectedElement) {
        console.log('Selected Element:', selectedElement);

        const elementInfo = `<div class=\"__boltSelectedElement__\" data-element='${JSON.stringify(selectedElement)}'>${JSON.stringify(`${selectedElement.displayText}`)}</div>`;
        finalMessageContent = messageContent + elementInfo;
      }

      runAnimation();

      if (!chatStarted) {
        setFakeLoading(true);

        if (autoSelectTemplate) {
          const { template, title } = await selectStarterTemplate({
            message: finalMessageContent,
            model,
            provider,
          });

          if (template !== 'blank') {
            const temResp = await getTemplates(template, title).catch((e) => {
              if (e.message.includes('rate limit')) {
                toast.warning('Rate limit exceeded. Skipping starter template\n Continuing with blank template');
              } else {
                toast.warning('Failed to import starter template\n Continuing with blank template');
              }

              return null;
            });

            if (temResp) {
              const { assistantMessage, userMessage } = temResp;
              const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

              setMessages([
                {
                  id: `1-${new Date().getTime()}`,
                  role: 'user',
                  content: userMessageText,
                  parts: createMessageParts(userMessageText, imageDataList),
                },
                {
                  id: `2-${new Date().getTime()}`,
                  role: 'assistant',
                  content: assistantMessage,
                },
                {
                  id: `3-${new Date().getTime()}`,
                  role: 'user',
                  content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
                  annotations: ['hidden'],
                },
              ]);

              const reloadOptions =
                uploadedFiles.length > 0
                  ? { experimental_attachments: await filesToAttachments(uploadedFiles) }
                  : undefined;

              reload(reloadOptions);
              setInput('');
              Cookies.remove(PROMPT_COOKIE_KEY);

              setUploadedFiles([]);
              setImageDataList([]);

              resetEnhancer();

              textareaRef.current?.blur();
              setFakeLoading(false);

              return;
            }
          }
        }

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;
        const attachments = uploadedFiles.length > 0 ? await filesToAttachments(uploadedFiles) : undefined;

        setMessages([
          {
            id: `${new Date().getTime()}`,
            role: 'user',
            content: userMessageText,
            parts: createMessageParts(userMessageText, imageDataList),
            experimental_attachments: attachments,
          },
        ]);
        reload(attachments ? { experimental_attachments: attachments } : undefined);
        setFakeLoading(false);
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        setUploadedFiles([]);
        setImageDataList([]);

        resetEnhancer();

        textareaRef.current?.blur();

        return;
      }

      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();

      chatStore.setKey('aborted', false);

      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userUpdateArtifact}${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );

        workbenchStore.resetAllFileModifications();
      } else {
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      setUploadedFiles([]);
      setImageDataList([]);

      resetEnhancer();

      textareaRef.current?.blur();
    };

    sendMessageRef.current = sendMessage;

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    useEffect(() => {
      didInitialProviderPickRef.current = false;
    }, [apiKeysSignature, activeProviderNamesSig]);

    useEffect(() => {
      if (activeProviders.length === 0) {
        return () => {
          void 0;
        };
      }

      const ac = new AbortController();

      void (async () => {
        try {
          const r = await fetch('/api/models', { signal: ac.signal });
          const data = (await r.json()) as { modelList?: ModelInfo[] };
          setBootstrapModelList(data.modelList ?? []);
        } catch (e: unknown) {
          const err = e as { name?: string };

          if (err?.name !== 'AbortError') {
            logger.error('Failed to refresh /api/models for auto-provider', e);
          }
        }
      })();

      return () => {
        ac.abort();
      };
    }, [activeProviderNamesSig, apiKeysSignature]);

    useEffect(() => {
      if (activeProviders.length === 0 || bootstrapModelList.length === 0) {
        return;
      }

      if (didInitialProviderPickRef.current) {
        return;
      }

      const savedProvider = Cookies.get('selectedProvider');
      const savedModel = Cookies.get('selectedModel');

      const savedWorks =
        savedProvider &&
        activeProviders.some((p) => p.name === savedProvider) &&
        bootstrapModelList.some((m) => m.provider === savedProvider && (!savedModel || m.name === savedModel));

      if (savedWorks) {
        const fullP = (PROVIDER_LIST.find((p) => p.name === savedProvider) ||
          activeProviders.find((p) => p.name === savedProvider)) as ProviderInfo | undefined;

        if (fullP) {
          setProvider(fullP);
        }

        if (savedModel && bootstrapModelList.some((m) => m.name === savedModel && m.provider === savedProvider)) {
          setModel(savedModel);
        }

        didInitialProviderPickRef.current = true;

        return;
      }

      const firstUsable = activeProviders.find((p) => bootstrapModelList.some((m) => m.provider === p.name));

      if (!firstUsable) {
        return;
      }

      const fm = bootstrapModelList.find((m) => m.provider === firstUsable.name);

      if (!fm) {
        return;
      }

      const fullP = (PROVIDER_LIST.find((p) => p.name === firstUsable.name) || firstUsable) as ProviderInfo;
      setProvider(fullP);
      setModel(fm.name);
      Cookies.set('selectedProvider', fullP.name, { expires: 30 });
      Cookies.set('selectedModel', fm.name, { expires: 30 });
      didInitialProviderPickRef.current = true;
    }, [activeProviders, bootstrapModelList]);

    useEffect(() => {
      if (!actionAlert?.content) {
        autoFixScheduledRef.current = false;

        return () => {
          void 0;
        };
      }

      if (!chatStarted || isLoading || fakeLoading) {
        return () => {
          void 0;
        };
      }

      if (autoFixActionCountRef.current >= 5) {
        return () => {
          void 0;
        };
      }

      if (autoFixScheduledRef.current) {
        return () => {
          void 0;
        };
      }

      autoFixScheduledRef.current = true;

      const isPreview = actionAlert.source === 'preview';
      const msg = `*Fix this ${isPreview ? 'preview' : 'terminal'} error automatically* \n\`\`\`${isPreview ? 'js' : 'sh'}\n${actionAlert.content}\n\`\`\`\n`;

      const t = globalThis.setTimeout(() => {
        autoFixActionCountRef.current += 1;
        workbenchStore.clearAlert();
        autoFixScheduledRef.current = false;
        toast.info('futureHub is applying an automatic fix for this error…');
        void sendMessageRef.current({} as React.UIEvent, msg);
      }, 850);

      return () => {
        globalThis.clearTimeout(t);
        autoFixScheduledRef.current = false;
      };
    }, [actionAlert, chatStarted, isLoading, fakeLoading]);

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    const handleWebSearchResult = useCallback(
      (result: string) => {
        const currentInput = input || '';
        const newInput = currentInput.length > 0 ? `${result}\n\n${currentInput}` : result;

        // Update the input via the same mechanism as handleInputChange
        const syntheticEvent = {
          target: { value: newInput },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        handleInputChange(syntheticEvent);
      },
      [input, handleInputChange],
    );

    return (
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading || fakeLoading}
        streamPaused={streamPaused}
        onToggleStreamPause={toggleStreamPause}
        onStreamingChange={(streaming) => {
          streamingState.set(streaming);
        }}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={activeProviders}
        handleInputChange={(e) => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={abort}
        description={description}
        importChat={importChat}
        exportChat={exportChat}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            (input) => {
              setInput(input);
              scrollTextArea();
            },
            model,
            provider,
            apiKeys,
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        supabaseAlert={supabaseAlert}
        clearSupabaseAlert={() => workbenchStore.clearSupabaseAlert()}
        deployAlert={deployAlert}
        clearDeployAlert={() => workbenchStore.clearDeployAlert()}
        llmErrorAlert={llmErrorAlert}
        clearLlmErrorAlert={clearApiErrorAlert}
        data={chatData}
        chatMode={chatMode}
        setChatMode={setChatMode}
        append={append}
        designScheme={designScheme}
        setDesignScheme={setDesignScheme}
        selectedElement={selectedElement}
        setSelectedElement={setSelectedElement}
        addToolResult={addToolResult}
        onWebSearchResult={handleWebSearchResult}
      />
    );
  },
);
