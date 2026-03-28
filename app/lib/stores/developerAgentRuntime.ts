import { map } from 'nanostores';

export type DeveloperAgentPhase = 'idle' | 'planning' | 'working' | 'verifying' | 'complete';

/**
 * Client-only UI/runtime state for autonomous developer continuation (not persisted).
 */
/** Upper bound for UI; real stop is `<developer_agent_status done="true" />` or safety pause in Chat. */
const DEFAULT_MAX_STEPS = 2048;

export const developerAgentRuntime = map({
  running: false,
  phase: 'idle' as DeveloperAgentPhase,
  step: 0,
  maxSteps: DEFAULT_MAX_STEPS,
});

export function resetDeveloperAgentRuntime() {
  developerAgentRuntime.set({
    running: false,
    phase: 'idle',
    step: 0,
    maxSteps: DEFAULT_MAX_STEPS,
  });
}
