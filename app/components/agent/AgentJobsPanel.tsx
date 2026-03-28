import { useStore } from '@nanostores/react';
import { useCallback, useState } from 'react';
import {
  agentJobs,
  enqueueAgentJob,
  autonomousAgentPaused,
  requestAutonomousResume,
  type AgentJob,
} from '~/lib/stores/agentJobs';
import { classNames } from '~/utils/classNames';
import { IconButton } from '~/components/ui/IconButton';

function statusColor(s: AgentJob['status']) {
  switch (s) {
    case 'pending':
      return 'text-amber-500';
    case 'running':
      return 'text-teal-500';
    case 'done':
      return 'text-emerald-500';
    case 'failed':
      return 'text-red-500';
    default:
      return 'text-bolt-elements-textSecondary';
  }
}

export function AgentJobsPanel() {
  const jobs = useStore(agentJobs);
  const safetyPaused = useStore(autonomousAgentPaused);
  const [goal, setGoal] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const onQueue = useCallback(() => {
    const g = goal.trim();

    if (!g) {
      return;
    }

    enqueueAgentJob(g);
    setGoal('');
  }, [goal]);

  const onResumeSafety = useCallback(() => {
    requestAutonomousResume();
  }, []);

  return (
    <div
      className={classNames(
        'rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2',
        'p-3 text-sm mb-2',
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="font-medium text-bolt-elements-textPrimary">Agent jobs</div>
        {safetyPaused && (
          <button
            type="button"
            onClick={onResumeSafety}
            className="text-xs px-2 py-1 rounded-md bg-accent-500/15 text-accent-500 hover:bg-accent-500/25 transition-colors duration-200"
          >
            Resume autonomous run
          </button>
        )}
      </div>
      <p className="text-xs text-bolt-elements-textTertiary mb-2">
        Queue goals; they run sequentially in Build mode with AI Developer + Autonomous continuation enabled.
      </p>
      <div className="flex gap-2 mb-3">
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. Add auth + settings page"
          className={classNames(
            'flex-1 min-w-0 rounded-md px-2 py-1.5 text-xs',
            'bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor',
            'text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary',
          )}
          onKeyDown={(e) => e.key === 'Enter' && onQueue()}
        />
        <button
          type="button"
          onClick={onQueue}
          className="shrink-0 text-xs px-3 py-1.5 rounded-md bg-accent-500 text-white hover:bg-accent-600 transition-colors duration-200"
        >
          Queue
        </button>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto modern-scrollbar">
        {jobs.length === 0 ? (
          <p className="text-xs text-bolt-elements-textTertiary">No jobs queued.</p>
        ) : (
          [...jobs].reverse().map((j) => (
            <div
              key={j.id}
              className="rounded border border-bolt-elements-borderColor/60 p-2 bg-bolt-elements-background-depth-1/50"
            >
              <div className="flex items-start justify-between gap-2">
                <span className={classNames('text-xs font-medium uppercase', statusColor(j.status))}>{j.status}</span>
                <IconButton
                  title={expanded === j.id ? 'Collapse' : 'Logs'}
                  onClick={() => setExpanded((x) => (x === j.id ? null : j.id))}
                  icon="i-ph:list"
                  size="sm"
                />
              </div>
              <p className="text-xs text-bolt-elements-textPrimary mt-1 line-clamp-3">{j.goal}</p>
              {j.subtasks && j.subtasks.length > 0 && (
                <ul className="mt-1 text-[10px] text-bolt-elements-textSecondary list-disc pl-4">
                  {j.subtasks.slice(0, 6).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
              {j.lastError && <p className="text-[10px] text-red-500 mt-1">{j.lastError}</p>}
              {expanded === j.id && j.logs.length > 0 && (
                <pre className="mt-2 text-[10px] text-bolt-elements-textTertiary whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {j.logs.slice(-25).join('\n')}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
