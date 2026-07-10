/**
 * Study sessions and pipeline candidates — explore → decide → promote.
 */

export type StudySessionStatus =
  | 'open'
  | 'briefed'
  | 'proposed'
  | 'closed'
  | 'cancelled'

export type StudyArtifactType =
  | 'serp_table'
  | 'brief'
  | 'match'
  | 'chart_spec'
  | 'raw_job'
  | 'export_table'
  | 'note'
  | 'other'

export type PipelineCandidateKind =
  | 'watchlist_seed'
  | 'catalog_product'
  | 'purchase_interest'
  | 'price_model'
  | 'forecast_input'
  | 'supplier_research'
  | 'channel_listing'

export type PipelineCandidateStatus =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'deferred'
  | 'executed'
  | 'failed'

export interface StudySession {
  id: string
  workspace_id: string
  status: StudySessionStatus
  hypothesis: string
  marketplace: string
  country: string
  query: string | null
  linked_product_id: string | null
  opened_by: string | null
  closed_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface StudyArtifact {
  id: string
  workspace_id: string
  session_id: string
  artifact_type: StudyArtifactType
  title: string | null
  payload: Record<string, unknown>
  evidence_refs: string[]
  grok_model: string | null
  crawl_job_id: string | null
  created_at: string
}

export interface PipelineCandidate {
  id: string
  workspace_id: string
  source_study_id: string | null
  kind: PipelineCandidateKind
  status: PipelineCandidateStatus
  title: string
  summary: string | null
  payload: Record<string, unknown>
  evidence_refs: string[]
  listing_id: string | null
  product_id: string | null
  proposed_by: string | null
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  executed_at: string | null
  execution_result: Record<string, unknown>
  idempotency_key: string | null
  created_at: string
  updated_at: string
}

/** Required shape for Grok study/BI outputs (numbers must come from tools). */
export interface GroundedGrokResult {
  claims: Array<{ text: string; evidence_ref: string }>
  unknowns: string[]
  recommendation: { action: string; confidence: number }
  numbers_from_model_only: false
}
