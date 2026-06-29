-- ============================================================
-- SKUMS AI Assistant Tables
-- Run AFTER schema.sql
-- ============================================================

-- ── Types ────────────────────────────────────────────────────

create type assistant_user_role as enum (
  'manufacturer', 'retailer', 'marketer', 'distributor', 'custom'
);

-- ── Workspace AI Config ──────────────────────────────────────

create table public.assistant_context_profiles (
  id                      uuid primary key default uuid_generate_v4(),
  workspace_id            uuid not null unique references public.workspaces(id) on delete cascade,
  user_role               assistant_user_role not null default 'retailer',
  system_prompt_additions text,
  slack_webhook_url       text,
  preferred_model         text not null default 'grok-3-mini'
                            check (preferred_model in ('grok-3', 'grok-3-mini')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.assistant_context_profiles enable row level security;

create policy "members can view assistant profile"
  on public.assistant_context_profiles for select
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = assistant_context_profiles.workspace_id
      and wm.user_id = auth.uid()
  ));

create policy "admins can insert assistant profile"
  on public.assistant_context_profiles for insert
  with check (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = assistant_context_profiles.workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner','admin','member')
  ));

create policy "admins can update assistant profile"
  on public.assistant_context_profiles for update
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = assistant_context_profiles.workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner','admin','member')
  ));

-- ── Conversation Threads ─────────────────────────────────────

create table public.assistant_conversations (
  id            uuid primary key default uuid_generate_v4(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  title         text not null default 'New conversation',
  context_type  text,   -- 'product' | 'inventory' | 'expiry' | 'general'
  context_id    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.assistant_conversations enable row level security;

create policy "users can view own conversations"
  on public.assistant_conversations for select
  using (user_id = auth.uid() and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = assistant_conversations.workspace_id
      and wm.user_id = auth.uid()
  ));

create policy "users can insert own conversations"
  on public.assistant_conversations for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = assistant_conversations.workspace_id
      and wm.user_id = auth.uid()
  ));

create policy "users can update own conversations"
  on public.assistant_conversations for update
  using (user_id = auth.uid());

create policy "users can delete own conversations"
  on public.assistant_conversations for delete
  using (user_id = auth.uid());

-- ── Messages (immutable) ─────────────────────────────────────

create table public.assistant_messages (
  id                uuid primary key default uuid_generate_v4(),
  conversation_id   uuid not null references public.assistant_conversations(id) on delete cascade,
  role              text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content           text,
  tool_calls        jsonb,
  tool_call_id      text,
  tool_name         text,
  reasoning         text,
  model_used        text,
  tokens_used       int,
  finish_reason     text,
  created_at        timestamptz not null default now()
);

alter table public.assistant_messages enable row level security;

create policy "users can view messages in own conversations"
  on public.assistant_messages for select
  using (
    conversation_id in (
      select id from public.assistant_conversations
      where user_id = auth.uid()
    )
  );

create policy "users can insert messages in own conversations"
  on public.assistant_messages for insert
  with check (
    conversation_id in (
      select id from public.assistant_conversations
      where user_id = auth.uid()
    )
  );

-- ── Indexes ──────────────────────────────────────────────────

create index idx_assistant_conversations_workspace on public.assistant_conversations(workspace_id);
create index idx_assistant_conversations_user on public.assistant_conversations(user_id);
create index idx_assistant_messages_conversation on public.assistant_messages(conversation_id);
create index idx_assistant_messages_created on public.assistant_messages(created_at);
