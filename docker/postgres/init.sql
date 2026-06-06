-- AgentOS PostgreSQL Initialization
-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid_ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Event Store
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  domain TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT,
  data JSONB NOT NULL DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correlation_id UUID,
  causation_id UUID,
  workspace_id UUID,
  sequence BIGINT GENERATED ALWAYS AS IDENTITY
);

CREATE INDEX idx_events_domain_type ON events(domain, type);
CREATE INDEX idx_events_workspace ON events(workspace_id, timestamp);
CREATE INDEX idx_events_correlation ON events(correlation_id);
CREATE INDEX idx_events_source_time ON events(source, timestamp);

-- Capabilities
CREATE TABLE capabilities (
  path TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  root TEXT NOT NULL,
  parent TEXT,
  input_schema JSONB NOT NULL,
  output_schema JSONB NOT NULL,
  tags TEXT[] DEFAULT '{}',
  stability TEXT NOT NULL DEFAULT 'stable',
  deprecated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_capabilities_root ON capabilities(root);
CREATE INDEX idx_capabilities_tags ON capabilities USING GIN(tags);

-- Providers
CREATE TABLE providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  capability_path TEXT NOT NULL REFERENCES capabilities(path),
  agent_id UUID,
  service_id UUID,
  reliability_score REAL DEFAULT 0.5,
  avg_latency_ms INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 0.5,
  max_concurrent INTEGER DEFAULT 10,
  current_load INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_health_check TIMESTAMPTZ
);

CREATE INDEX idx_providers_capability ON providers(capability_path);
CREATE INDEX idx_providers_status ON providers(status);

-- Allocations
CREATE TABLE allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  agent_id UUID NOT NULL,
  task_id UUID,
  workspace_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  ru_allocated REAL NOT NULL DEFAULT 0,
  mu_allocated REAL NOT NULL DEFAULT 0,
  eu_allocated REAL NOT NULL DEFAULT 0,
  vu_allocated REAL NOT NULL DEFAULT 0,
  ru_consumed REAL NOT NULL DEFAULT 0,
  mu_consumed REAL NOT NULL DEFAULT 0,
  eu_consumed REAL NOT NULL DEFAULT 0,
  vu_consumed REAL NOT NULL DEFAULT 0,
  priority SMALLINT NOT NULL DEFAULT 3,
  preemptible BOOLEAN NOT NULL DEFAULT TRUE,
  granted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_allocations_agent ON allocations(agent_id);
CREATE INDEX idx_allocations_workspace ON allocations(workspace_id);
CREATE INDEX idx_allocations_state ON allocations(state);