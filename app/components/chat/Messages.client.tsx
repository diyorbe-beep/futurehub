import type { Message } from 'ai';
import { Fragment } from 'react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { forwardRef } from 'react';
import type { ForwardedRef } from 'react';
import type { ProviderInfo } from '~/types/model';

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: Message[];
  append?: (message: Message) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
  reload?: () => void;
}

export const Messages = forwardRef<HTMLDivElement, MessagesProps>(
  (props: MessagesProps, ref: ForwardedRef<HTMLDivElement> | undefined) => {
    const { id, isStreaming = false, messages = [] } = props;

    return (
      <div id={id} className={props.className} ref={ref}>
        {messages.length > 0
          ? messages.map((message, index) => {
              const { role, content, id: messageId, annotations, parts } = message;
              const isUserMessage = role === 'user';
              const isFirst = index === 0;
              const isHidden = annotations?.includes('hidden');

              if (isHidden) {
                return <Fragment key={index} />;
              }

              return (
                <div
                  key={index}
                  className={classNames('flex gap-4 py-3 w-full rounded-lg animate-slide-up-fade', {
                    'mt-6': !isFirst,
                  })}
                  style={{ animationDelay: `${Math.min(index * 0.05, 0.2)}s`, animationFillMode: 'both' }}
                >
                  <div className="grid grid-col-1 w-full">
                    {isUserMessage ? (
                      <UserMessage content={content} parts={parts} />
                    ) : (
                      <AssistantMessage
                        content={content}
                        annotations={message.annotations}
                        messageId={messageId}
                        onReload={index === messages.length - 1 ? props.reload : undefined}
                        append={props.append}
                        chatMode={props.chatMode}
                        setChatMode={props.setChatMode}
                        model={props.model}
                        provider={props.provider}
                        parts={parts}
                        addToolResult={props.addToolResult}
                      />
                    )}
                  </div>
                </div>
              );
            })
          : null}
        {isStreaming && (
          <div
            className="flex justify-center items-center w-full mt-6 animate-slide-up-fade"
            style={{ animationDelay: '0.1s' }}
          >
            <div className="flex items-center gap-2 bg-bolt-elements-background-depth-2/60 backdrop-blur-md px-4 py-2 rounded-full border border-bolt-elements-borderColor/50 shadow-[0_4px_16px_rgba(0,0,0,0.05)]">
              <div className="i-svg-spinners:3-dots-fade text-2xl text-accent-500"></div>
              <span className="text-[13px] font-medium text-bolt-elements-textSecondary tracking-wide">
                Thinking...
              </span>
            </div>
          </div>
        )}
      </div>
    );
  },
);
