/**
 * Lightweight persistent memory for autonomous agent (localStorage).
 * Injected into API system prompt + optional user-side blocks.
 */

const KEY = 'futurehub_agent_memory_v1';

export interface AgentMemoryState {
  decisions: { at: string; summary: string }[];
  preferences: Record<string, string>;
  compressedNotes: string[];
}

const defaultState = (): AgentMemoryState => ({
  decisions: [],
  preferences: {},
  compressedNotes: [],
});

function load(): AgentMemoryState {
  if (typeof localStorage === 'undefined') {
    return defaultState();
  }

  try {
    const raw = localStorage.getItem(KEY);

    if (!raw) {
      return defaultState();
    }

    const p = JSON.parse(raw) as AgentMemoryState;

    return {
      decisions: Array.isArray(p.decisions) ? p.decisions.slice(-80) : [],
      preferences: p.preferences && typeof p.preferences === 'object' ? p.preferences : {},
      compressedNotes: Array.isArray(p.compressedNotes) ? p.compressedNotes.slice(-40) : [],
    };
  } catch {
    return defaultState();
  }
}

function save(s: AgentMemoryState) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function getAgentMemoryState(): AgentMemoryState {
  return load();
}

export function recordAgentDecision(summary: string) {
  const s = load();
  const line = summary.trim().slice(0, 600);

  if (!line) {
    return;
  }

  s.decisions.push({ at: new Date().toISOString(), summary: line });
  s.decisions = s.decisions.slice(-80);
  save(s);
}

export function addCompressedNote(note: string) {
  const s = load();
  const n = note.trim().slice(0, 800);

  if (!n) {
    return;
  }

  s.compressedNotes.push(n);
  s.compressedNotes = s.compressedNotes.slice(-40);
  save(s);
}

export function setUserPreference(key: string, value: string) {
  const s = load();
  s.preferences[key] = value.slice(0, 500);
  save(s);
}

/** For system prompt injection (server) / continuation messages */
export function getAgentMemorySnippet(maxChars = 2000): string {
  const s = load();
  const parts: string[] = [];

  if (Object.keys(s.preferences).length) {
    parts.push('Preferences:', JSON.stringify(s.preferences));
  }

  if (s.compressedNotes.length) {
    parts.push('Recent notes:', s.compressedNotes.slice(-12).join('\n---\n'));
  }

  if (s.decisions.length) {
    parts.push(
      'Recent decisions:',
      s.decisions
        .slice(-15)
        .map((d) => `- ${d.at}: ${d.summary}`)
        .join('\n'),
    );
  }

  const out = parts.join('\n').trim();

  return out.length > maxChars ? `${out.slice(0, maxChars)}\n…` : out;
}
