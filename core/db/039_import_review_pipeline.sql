-- ============================================================
-- Import Review Pipeline Metadata
--
-- Purpose:
--   Preserve changing supplier file formats as staged imports.
--   Deterministic mappers and LLM-assisted normalizers can propose
--   column mappings and graph write plans, but human approval remains
--   explicit before committing rows to the product graph.
--
-- Run AFTER: 038_auth_identity.sql
-- ============================================================

alter table public.import_jobs
  add column if not exists mapping_source text not null default 'manual'
    check (mapping_source in ('manual', 'saved_mapping', 'deterministic', 'llm_assisted')),
  add column if not exists inferred_column_mapping jsonb not null default '{}',
  add column if not exists normalization_model text,
  add column if not exists review_status text not null default 'pending'
    check (review_status in ('pending', 'needs_review', 'approved', 'rejected', 'partially_approved')),
  add column if not exists approved_row_count int not null default 0,
  add column if not exists rejected_row_count int not null default 0;

alter table public.import_job_rows
  add column if not exists normalization_confidence numeric(5,4),
  add column if not exists approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected', 'needs_review')),
  add column if not exists approval_notes text;

create index if not exists idx_import_jobs_review_status
  on public.import_jobs(workspace_id, review_status);

create index if not exists idx_import_job_rows_approval_status
  on public.import_job_rows(import_job_id, approval_status);

comment on column public.import_jobs.inferred_column_mapping is
  'Column mapping proposed by deterministic or LLM-assisted import normalization. Review before commit.';

comment on column public.import_jobs.normalization_model is
  'Optional model or pipeline identifier that produced the staged normalized write plan.';

comment on column public.import_job_rows.normalization_confidence is
  'Optional confidence score from deterministic or LLM-assisted row normalization.';
