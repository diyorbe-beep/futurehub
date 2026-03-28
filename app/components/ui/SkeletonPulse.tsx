import { memo, type CSSProperties } from 'react';
import { classNames } from '~/utils/classNames';

/** Lightweight skeleton bar — avoids spinner reflow */
export const SkeletonPulse = memo(({ className, style }: { className?: string; style?: CSSProperties }) => {
  return (
    <span
      className={classNames(
        'inline-block rounded-md bg-bolt-elements-background-depth-3',
        'animate-pulse motion-reduce:animate-none',
        className,
      )}
      style={style}
      aria-hidden
    />
  );
});
