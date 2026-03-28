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
      className="absolute flex justify-center items-center top-5 right-5 p-1.5 rounded-lg w-9 h-9 text-white bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 transition-[transform,background-color,opacity] duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] will-change-transform shadow-sm"
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();

        if (!disabled) {
          onClick?.(event);
        }
      }}
    >
      <div className="text-lg">
        {!isStreaming ? <div className="i-ph:arrow-right" /> : <div className="i-ph:stop-circle-bold" />}
      </div>
    </button>
  );
});
