import { useStore } from '@nanostores/react';
import { developerAgentRuntime } from '~/lib/stores/developerAgentRuntime';
import { autonomousAgentPaused } from '~/lib/stores/agentJobs';
import { classNames } from '~/utils/classNames';

export function DeveloperAgentBanner() {
  const { running, phase, step, maxSteps } = useStore(developerAgentRuntime);
  const safetyPaused = useStore(autonomousAgentPaused);

  if (!running && phase === 'idle' && !safetyPaused) {
    return null;
  }

  return (
    <div
      className={classNames(
        'mb-2 px-3 py-2 rounded-lg border text-sm',
        'border-accent-500/25 bg-accent-500/10 text-bolt-elements-textPrimary',
      )}
      role="status"
      aria-live="polite"
    >
      <span className="font-medium text-accent-500">AI Developer</span>
      <span className="text-bolt-elements-textSecondary mx-2">·</span>
      <span>
        {safetyPaused
          ? `Paused (safety cap ${maxSteps}) — resume from Agent jobs`
          : phase === 'complete'
            ? `Complete · ${step} iteration(s)`
            : `Iteration ${step} · safety cap ${maxSteps} · ${phase}`}
      </span>
      <span className="text-bolt-elements-textTertiary ml-2 hidden sm:inline">
        {safetyPaused
          ? 'Autonomous loop stopped at the iteration ceiling until you resume.'
          : 'Autonomous continuation in progress — you can keep working; no reply required.'}
      </span>
    </div>
  );
}
