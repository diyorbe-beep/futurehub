-- Autonomous agent platform (PostgreSQL + pgvector).
-- Run after: CREATE DATABASE ... ; optional CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  repo_url TEXT,
  workspace_files JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES agent_projects (id) ON DELETE SET NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  priority INT NOT NULL DEFAULT 0,
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 5,
  last_error TEXT,
  result_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON agent_jobs (status);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_project ON agent_jobs (project_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_created ON agent_jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS agent_job_logs (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES agent_jobs (id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_job_logs_job ON agent_job_logs (job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_decisions (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID REFERENCES agent_jobs (id) ON DELETE SET NULL,
  project_id UUID REFERENCES agent_projects (id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_job ON agent_decisions (job_id);

CREATE TABLE IF NOT EXISTS agent_user_preferences (
  id BIGSERIAL PRIMARY KEY,
  user_key TEXT NOT NULL UNIQUE,
  prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_memory_embeddings (
  id BIGSERIAL PRIMARY KEY,
  project_id UUID REFERENCES agent_projects (id) ON DELETE CASCADE,
  job_id UUID REFERENCES agent_jobs (id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('code', 'conversation', 'decision')),
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_project ON agent_memory_embeddings (project_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_job ON agent_memory_embeddings (job_id);

-- IVFFlat index optional (needs ANALYZE + sufficient rows). Created manually in prod if needed.
