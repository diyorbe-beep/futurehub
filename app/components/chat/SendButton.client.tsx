import { memo, type MouseEvent } from 'react';

interface SendButtonProps {
  show: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onImagesSelected?: (images: File[]) => void;
}

export const SendButton = memo(({ show, isStreaming, disabled, onClick }: SendButtonProps) => {
  if (!show) {
    return null;
  }

  return (
    <button
      type="button"
      className="absolute flex justify-center items-center top-[22px] right-[22px] p-2 rounded-full w-10 h-10 text-white bg-accent-500 hover:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.08] active:scale-[0.92] shadow-[0_4px_16px_rgba(20,184,166,0.3)] hover:shadow-[0_6px_20px_rgba(20,184,166,0.4)] disabled:shadow-none disabled:hover:scale-100 will-change-transform"
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();

        if (!disabled) {
          onClick?.(event);
        }
      }}
    >
      <div className="text-xl">
        {!isStreaming ? <div className="i-ph:arrow-up-bold" /> : <div className="i-ph:stop-circle-fill" />}
      </div>
    </button>
  );
});
