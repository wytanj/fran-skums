-- Fix create_workspace overload ambiguity.
-- See core/db/051_fix_create_workspace_overload.sql for full notes.
--
-- Error when signing up / creating a workspace without org_id:
--   could not choose the best candidate function between:
--     public.create_workspace(ws_name => text, ws_slug => text),
--     public.create_workspace(ws_name => text, ws_slug => text, ws_org_id => uuid)

drop function if exists public.create_workspace(text, text);

create or replace function public.create_workspace(ws_name text, ws_slug text, ws_org_id uuid default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_ws public.workspaces%rowtype;
begin
  if ws_org_id is not null then
    if not exists (
      select 1 from public.organization_members
      where organization_id = ws_org_id
        and user_id = auth.uid()
        and role in ('owner', 'admin')
    ) then
      raise exception 'Must be org admin to create workspace in organization';
    end if;
  end if;

  insert into public.workspaces (name, slug, owner_id, organization_id)
  values (ws_name, ws_slug, auth.uid(), ws_org_id)
  returning * into new_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_ws.id, auth.uid(), 'owner');

  return row_to_json(new_ws);
end;
$$;
