-- Fix workspace SELECT policy to also allow owners to see their workspaces
-- even if the workspace_members row hasn't been created yet or is inaccessible.
-- Run this in the Supabase SQL Editor.

drop policy if exists "Members can view workspace" on public.workspaces;

create policy "Members can view workspace"
  on public.workspaces for select
  using (
    owner_id = auth.uid()
    or id in (select public.get_my_workspace_ids())
  );
