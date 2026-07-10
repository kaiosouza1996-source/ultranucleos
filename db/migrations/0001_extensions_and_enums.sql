-- Fundação: extensões e enums usados pelo restante do schema.
-- Postgres self-hosted (Docker) — substitui o Postgres gerenciado do Supabase.
begin;

create extension if not exists pgcrypto;

do $$ begin
  create type user_role as enum ('socio', 'comercial', 'operacional');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type channel_visibility as enum ('public', 'role', 'private');
exception when duplicate_object then null;
end $$;

commit;
