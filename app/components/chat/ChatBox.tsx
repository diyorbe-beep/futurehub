import React, { memo } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { classNames } from '~/utils/classNames';
import { PROVIDER_LIST } from '~/utils/constants';
import { ModelSelector } from '~/components/chat/ModelSelector';
import { APIKeyManager } from './APIKeyManager';
import { LOCAL_PROVIDERS } from '~/lib/stores/settings';
import FilePreview from './FilePreview';
import { ScreenshotStateManager } from './ScreenshotStateManager';
import { SendButton } from './SendButton.client';
import { IconButton } from '~/components/ui/IconButton';
import { SkeletonPulse } from '~/components/ui/SkeletonPulse';
import { toast } from 'react-toastify';
import { SpeechRecognitionButton } from '~/components/chat/SpeechRecognition';
import { SupabaseConnection } from './SupabaseConnection';
import { ExpoQrModal } from '~/components/workbench/ExpoQrModal';
import type { ProviderInfo } from '~/types/model';
import { ColorSchemeDialog } from '~/components/ui/ColorSchemeDialog';
import type { DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import { McpTools } from './MCPTools';
import { WebSearch } from './WebSearch.client';

interface ChatBoxProps {
  isModelSettingsCollapsed: boolean;
  setIsModelSettingsCollapsed: (collapsed: boolean) => void;
  provider: any;
  providerList: any[];
  modelList: any[];
  apiKeys: Record<string, string>;
  isModelLoading: string | undefined;
  onApiKeysChange: (providerName: string, apiKey: string) => void;
  uploadedFiles: File[];
  imageDataList: string[];
  textareaRef: React.RefObject<HTMLTextAreaElement> | undefined;
  input: string;
  handlePaste: (e: React.ClipboardEvent) => void;
  TEXTAREA_MIN_HEIGHT: number;
  TEXTAREA_MAX_HEIGHT: number;
  isStreaming: boolean;
  handleSendMessage: (event: React.UIEvent, messageInput?: string) => void;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  chatStarted: boolean;
  exportChat?: () => void;
  qrModalOpen: boolean;
  setQrModalOpen: (open: boolean) => void;
  handleFileUpload: () => void;
  setProvider?: ((provider: ProviderInfo) => void) | undefined;
  model?: string | undefined;
  setModel?: ((model: string) => void) | undefined;
  setUploadedFiles?: ((files: File[]) => void) | undefined;
  setImageDataList?: ((dataList: string[]) => void) | undefined;
  handleInputChange?: ((event: React.ChangeEvent<HTMLTextAreaElement>) => void) | undefined;
  handleStop?: (() => void) | undefined;
  streamPaused?: boolean;
  onToggleStreamPause?: () => void;
  enhancingPrompt?: boolean | undefined;
  enhancePrompt?: (() => void) | undefined;
  onWebSearchResult?: (result: string) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: ((element: ElementInfo | null) => void) | undefined;
}

const ChatBoxImpl: React.FC<ChatBoxProps> = (props) => {
  return (
    <div
      className={classNames(
        'relative w-full max-w-full mx-auto z-prompt',
        'p-5 sm:p-6 rounded-[32px]',
        'border border-[var(--bolt-elements-glass-border)]',
        'bg-[var(--bolt-elements-bg-depth-2)]',
        'shadow-[0_4px_24px_-8px_rgba(0,0,0,0.15)]',
        'transition-[border-color,box-shadow,transform] duration-200 ease-out',
        'hover:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)]',
        'focus-within:border-accent-500/50 focus-within:shadow-[0_0_0_1px_rgba(20,184,166,0.4),0_8px_32px_-8px_rgba(20,184,166,0.1)] focus-within:-translate-y-[1px]',
      )}
    >
      <div className="mb-1">
        <ClientOnly>
          {() => (
            <div className={classNames(props.isModelSettingsCollapsed ? 'hidden' : '', 'space-y-2')}>
              <ModelSelector
                key={props.provider?.name + ':' + props.modelList.length}
                model={props.model}
                setModel={props.setModel}
                modelList={props.modelList}
                provider={props.provider}
                setProvider={props.setProvider}
                providerList={props.providerList || (PROVIDER_LIST as ProviderInfo[])}
                apiKeys={props.apiKeys}
                modelLoading={props.isModelLoading}
              />
              {(props.providerList || []).length > 0 &&
                props.provider &&
                !LOCAL_PROVIDERS.includes(props.provider.name) && (
                  <APIKeyManager
                    provider={props.provider}
                    apiKey={props.apiKeys[props.provider.name] || ''}
                    setApiKey={(key) => {
                      props.onApiKeysChange(props.provider.name, key);
                    }}
                  />
                )}
            </div>
          )}
        </ClientOnly>
      </div>
      <FilePreview
        files={props.uploadedFiles}
        imageDataList={props.imageDataList}
        onRemove={(index) => {
          props.setUploadedFiles?.(props.uploadedFiles.filter((_, i) => i !== index));
          props.setImageDataList?.(props.imageDataList.filter((_, i) => i !== index));
        }}
      />
      <ClientOnly>
        {() => (
          <ScreenshotStateManager
            setUploadedFiles={props.setUploadedFiles}
            setImageDataList={props.setImageDataList}
            uploadedFiles={props.uploadedFiles}
            imageDataList={props.imageDataList}
          />
        )}
      </ClientOnly>
      {props.selectedElement && (
        <div className="flex mx-1.5 gap-2 items-center justify-between rounded-lg rounded-b-none border border-b-none border-bolt-elements-borderColor text-bolt-elements-textPrimary flex py-1 px-2.5 font-medium text-xs">
          <div className="flex gap-2 items-center lowercase">
            <code className="bg-accent-500 rounded-4px px-1.5 py-1 mr-0.5 text-white">
              {props?.selectedElement?.tagName}
            </code>
            selected for inspection
          </div>
          <button
            className="bg-transparent text-accent-500 pointer-auto"
            onClick={() => props.setSelectedElement?.(null)}
          >
            Clear
          </button>
        </div>
      )}
      <div
        className={classNames(
          'relative rounded-[24px] border border-transparent',
          'bg-bolt-elements-background-depth-2/40 backdrop-blur-md transition-all duration-300',
          'focus-within:bg-bolt-elements-background-depth-1/80 focus-within:border-bolt-elements-borderColor/50',
        )}
      >
        <textarea
          ref={props.textareaRef}
          className={classNames(
            'w-full pl-6 pt-4 pr-24 pb-4 outline-none resize-none rounded-[24px]',
            'text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary bg-transparent',
            'text-[15px] sm:text-[16px] leading-[1.6]',
            'transition-all duration-300 ease-out',
          )}
          onDragEnter={(e) => {
            e.preventDefault();
            e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(20,184,166,0.45)';
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(20,184,166,0.45)';
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.currentTarget.style.boxShadow = 'none';
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.style.boxShadow = 'none';

            const files = Array.from(e.dataTransfer.files);
            files.forEach((file) => {
              if (file.type.startsWith('image/')) {
                const reader = new FileReader();

                reader.onload = (e) => {
                  const base64Image = e.target?.result as string;
                  props.setUploadedFiles?.([...props.uploadedFiles, file]);
                  props.setImageDataList?.([...props.imageDataList, base64Image]);
                };
                reader.readAsDataURL(file);
              }
            });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              if (event.shiftKey) {
                return;
              }

              event.preventDefault();

              if (props.isStreaming) {
                props.handleStop?.();
                return;
              }

              // ignore if using input method engine
              if (event.nativeEvent.isComposing) {
                return;
              }

              props.handleSendMessage?.(event);
            }
          }}
          value={props.input}
          onChange={(event) => {
            props.handleInputChange?.(event);
          }}
          onPaste={props.handlePaste}
          style={{
            minHeight: props.TEXTAREA_MIN_HEIGHT,
            maxHeight: props.TEXTAREA_MAX_HEIGHT,
          }}
          placeholder={
            props.chatMode === 'build' ? 'How can futureHub help you today?' : 'What would you like to discuss?'
          }
          translate="no"
          autoFocus={true}
        />
        <ClientOnly>
          {() => (
            <>
              {props.isStreaming && (
                <IconButton
                  title={props.streamPaused ? 'Resume generation' : 'Pause generation'}
                  className={classNames(
                    'absolute top-5 right-[4.25rem] p-1.5 rounded-lg w-9 h-9 transition-theme',
                    'bg-bolt-elements-background-depth-3/80 hover:bg-bolt-elements-background-depth-4',
                    'border border-bolt-elements-borderColor text-bolt-elements-textPrimary',
                    'hover:scale-[1.02] active:scale-[0.98] transition-transform duration-200 ease-out',
                  )}
                  onClick={(e) => {
                    e.preventDefault();
                    props.onToggleStreamPause?.();
                  }}
                >
                  <div
                    className={classNames('text-lg mx-auto', props.streamPaused ? 'i-ph:play-fill' : 'i-ph:pause-fill')}
                  />
                </IconButton>
              )}
              <SendButton
                show={props.input.length > 0 || props.isStreaming || props.uploadedFiles.length > 0}
                isStreaming={props.isStreaming}
                disabled={!props.providerList || props.providerList.length === 0}
                onClick={(event) => {
                  if (props.isStreaming) {
                    props.handleStop?.();
                    return;
                  }

                  if (props.input.length > 0 || props.uploadedFiles.length > 0) {
                    props.handleSendMessage?.(event);
                  }
                }}
              />
            </>
          )}
        </ClientOnly>
        <div className="flex justify-between items-center text-sm px-1 pt-4 pb-1">
          <div className="flex gap-1 items-center">
            <ColorSchemeDialog designScheme={props.designScheme} setDesignScheme={props.setDesignScheme} />
            <McpTools />
            <IconButton title="Upload file" className="transition-all" onClick={() => props.handleFileUpload()}>
              <div className="i-ph:paperclip text-xl"></div>
            </IconButton>
            <WebSearch onSearchResult={(result) => props.onWebSearchResult?.(result)} disabled={props.isStreaming} />
            <IconButton
              title="Enhance prompt"
              disabled={props.input.length === 0 || props.enhancingPrompt}
              className={classNames('transition-all', props.enhancingPrompt ? 'opacity-100' : '')}
              onClick={() => {
                props.enhancePrompt?.();
                toast.success('Prompt enhanced!');
              }}
            >
              {props.enhancingPrompt ? (
                <SkeletonPulse className="w-5 h-5" />
              ) : (
                <div className="i-bolt:stars text-xl transition-transform duration-200 hover:scale-[1.02]" />
              )}
            </IconButton>

            <SpeechRecognitionButton
              isListening={props.isListening}
              onStart={props.startListening}
              onStop={props.stopListening}
              disabled={props.isStreaming}
            />
            {props.chatStarted && (
              <IconButton
                title="Discuss"
                className={classNames(
                  'transition-all flex items-center gap-1 px-1.5',
                  props.chatMode === 'discuss'
                    ? '!bg-bolt-elements-item-backgroundAccent !text-bolt-elements-item-contentAccent'
                    : 'bg-bolt-elements-item-backgroundDefault text-bolt-elements-item-contentDefault',
                )}
                onClick={() => {
                  props.setChatMode?.(props.chatMode === 'discuss' ? 'build' : 'discuss');
                }}
              >
                <div className={`i-ph:chats text-xl`} />
                {props.chatMode === 'discuss' ? <span>Discuss</span> : <span />}
              </IconButton>
            )}
            <button
              title="AI Model Routing"
              className={classNames(
                'transition-[background-color,shadow,transform] duration-200 ease-out flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border active:scale-95',
                {
                  'bg-accent-500/10 text-accent-500 border-accent-500/20 shadow-sm hover:bg-accent-500/20':
                    props.isModelSettingsCollapsed,
                  'bg-bolt-elements-item-backgroundDefault text-bolt-elements-item-contentDefault border-bolt-elements-borderColor hover:bg-bolt-elements-item-backgroundActive':
                    !props.isModelSettingsCollapsed,
                },
              )}
              onClick={() => props.setIsModelSettingsCollapsed(!props.isModelSettingsCollapsed)}
            >
              <div
                className={classNames(
                  props.isModelSettingsCollapsed ? 'i-ph:magic-wand-fill' : 'i-ph:sliders-horizontal',
                  'text-sm',
                )}
              />
              <span>{props.isModelSettingsCollapsed ? 'Auto (Smart)' : 'Manual Setup'}</span>
            </button>
          </div>
          {props.input.length > 3 ? (
            <div className="text-xs text-bolt-elements-textTertiary">
              Use <kbd className="kdb px-1.5 py-0.5 rounded bg-bolt-elements-background-depth-2">Shift</kbd> +{' '}
              <kbd className="kdb px-1.5 py-0.5 rounded bg-bolt-elements-background-depth-2">Return</kbd> a new line
            </div>
          ) : null}
          <SupabaseConnection />
          <ExpoQrModal open={props.qrModalOpen} onClose={() => props.setQrModalOpen(false)} />
        </div>
      </div>
    </div>
  );
};

export const ChatBox = memo(ChatBoxImpl);
