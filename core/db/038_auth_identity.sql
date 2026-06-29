-- Auth identity hardening for Google SSO and other OAuth providers.
-- Keeps public.profiles populated from the common Supabase OAuth metadata keys.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(new.raw_user_meta_data ->> 'user_name', ''),
      new.email,
      ''
    ),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', ''),
      ''
    )
  )
  on conflict (id) do update
  set
    full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name),
    avatar_url = coalesce(nullif(public.profiles.avatar_url, ''), excluded.avatar_url),
    updated_at = now();

  return new;
end;
$$;
