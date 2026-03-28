import { atom } from 'nanostores';

export type AgentJobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface AgentJob {
  id: string;
  goal: string;
  status: AgentJobStatus;
  createdAt: number;
  updatedAt: number;
  logs: string[];
  subtasks?: string[];
  lastError?: string;
}

const STORAGE_KEY = 'futurehub_agent_jobs_v1';

export const agentJobs = atom<AgentJob[]>([]);

/** Bumped when a new job is queued so Chat can try to start it */
export const agentJobKick = atom(0);

/** Set true when autonomous hits safety iteration cap; user must resume from Agent Jobs panel */
export const autonomousAgentPaused = atom(false);

/** True until Chat consumes it: user clicked resume after safety pause (must append next step for running job). */
export const agentResumeAfterSafety = atom(false);

export function requestAutonomousResume() {
  autonomousAgentPaused.set(false);
  agentResumeAfterSafety.set(true);
  agentJobKick.set(Date.now());
}

function persist(jobs: AgentJob[]) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    /* ignore quota */
  }
}

function loadInitial(): AgentJob[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as AgentJob[];

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

if (typeof window !== 'undefined') {
  agentJobs.set(loadInitial());
}

export function enqueueAgentJob(goal: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const job: AgentJob = {
    id,
    goal: goal.trim(),
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    logs: [`[queued] ${new Date().toISOString()}`],
  };
  agentJobs.set([...agentJobs.get(), job]);
  persist(agentJobs.get());
  agentJobKick.set(Date.now());

  return id;
}

export function updateAgentJob(id: string, patch: Partial<AgentJob>) {
  const next = agentJobs.get().map((j) => (j.id === id ? { ...j, ...patch, updatedAt: Date.now() } : j));
  agentJobs.set(next);
  persist(next);
}

export function appendAgentJobLog(id: string, line: string) {
  const j = agentJobs.get().find((x) => x.id === id);

  if (!j) {
    return;
  }

  const entry = `[${new Date().toISOString()}] ${line}`;
  const logs = [...j.logs, entry].slice(-300);
  updateAgentJob(id, { logs });
}

export function getNextPendingJob(): AgentJob | undefined {
  return agentJobs.get().find((j) => j.status === 'pending');
}

export function markAgentJobRunning(id: string) {
  updateAgentJob(id, { status: 'running', lastError: undefined });
  appendAgentJobLog(id, 'status=running');
}

export function markAgentJobDone(id: string) {
  updateAgentJob(id, { status: 'done' });
  appendAgentJobLog(id, 'status=done');
}

export function markAgentJobFailed(id: string, err: string) {
  updateAgentJob(id, { status: 'failed', lastError: err });
  appendAgentJobLog(id, `failed: ${err}`);
}

export function parseSubtasksFromAssistant(text: string): string[] | undefined {
  const m = text.match(/<agent_subtasks>\s*([\s\S]*?)\s*<\/agent_subtasks>/i);

  if (!m) {
    return undefined;
  }

  try {
    const arr = JSON.parse(m[1].trim()) as unknown;

    return Array.isArray(arr) ? arr.map(String) : undefined;
  } catch {
    return undefined;
  }
}

export function extractAgentJobIdFromMessage(content: string): string | null {
  const m = content.match(/\[AGENT_JOB id=([a-zA-Z0-9-]+)\]/);

  return m ? m[1] : null;
}
