-- Fix workspace creation: atomic function that creates workspace + membership
-- in one transaction, bypassing the chicken-and-egg RLS problem.
-- Run this in the Supabase SQL Editor.

create or replace function public.create_workspace(ws_name text, ws_slug text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_ws public.workspaces%rowtype;
begin
  insert into public.workspaces (name, slug, owner_id)
  values (ws_name, ws_slug, auth.uid())
  returning * into new_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_ws.id, auth.uid(), 'owner');

  return row_to_json(new_ws);
end;
$$;
