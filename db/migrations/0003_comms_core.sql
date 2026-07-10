-- Comunicação Interna — núcleo (porta 1:1 de supabase/migrations/0002 e 0003,
-- trocando FK de auth.users/public.profiles por auth_users, e trocando
-- auth.uid()/auth.role() por parâmetros explícitos, já que a autorização
-- agora é feita 100% em app-layer no Express — ver whatsapp-engine/authz.js).
begin;

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text,
  visibility channel_visibility not null default 'public',
  allowed_roles user_role[],
  is_dm boolean not null default false,
  is_handoff boolean not null default false,
  created_by uuid references auth_users(id),
  created_at timestamptz not null default now(),
  server_id uuid,
  category_id uuid,
  position integer not null default 0
);

create table if not exists channel_members (
  channel_id uuid not null references channels(id) on delete cascade,
  user_id uuid not null references auth_users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  author_id uuid not null references auth_users(id),
  body text,
  is_client_data boolean not null default false,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  attachment_path text,
  attachment_name text,
  attachment_type text
);

create table if not exists client_data_cards (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id),
  message_id uuid references messages(id),
  created_by uuid not null references auth_users(id),
  cliente_nome text not null,
  perfil text not null,
  instrumento text not null,
  urgencia text not null check (urgencia in ('baixa', 'media', 'alta')),
  telefone text,
  documento text,
  observacoes text,
  autorizacao_expressa boolean not null,
  constraint chk_autorizacao_expressa check (autorizacao_expressa = true),
  created_at timestamptz not null default now()
);

create table if not exists comms_audit_log (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  actor_id uuid references auth_users(id),
  actor_name text,
  action text not null,
  target_type text,
  target_id text,
  details jsonb
);

create table if not exists channel_reads (
  user_id uuid not null references auth_users(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

-- ─────────────────── Imutabilidade (idêntico ao Supabase — não dependia
-- de auth.uid(), só de TG_OP/OLD, então é copiado tal qual) ───────────────────
create or replace function block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% é imutável — não pode ser alterado nem apagado (Seção 13 do Manual Operacional)', TG_TABLE_NAME;
end;
$$;

create or replace function messages_block_mutation() returns trigger
language plpgsql as $$
declare
  _is_handoff boolean;
begin
  select is_handoff into _is_handoff from channels where id = OLD.channel_id;
  if OLD.is_client_data or coalesce(_is_handoff, false) then
    raise exception 'Mensagens de dado de cliente ou de canal de handoff não podem ser alteradas/apagadas (Seção 13 do Manual Operacional)';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

drop trigger if exists client_data_cards_immutable on client_data_cards;
create trigger client_data_cards_immutable
  before update or delete on client_data_cards
  for each row execute function block_mutation();

drop trigger if exists comms_audit_log_immutable on comms_audit_log;
create trigger comms_audit_log_immutable
  before update or delete on comms_audit_log
  for each row execute function block_mutation();

drop trigger if exists messages_immutable on messages;
create trigger messages_immutable
  before update or delete on messages
  for each row execute function messages_block_mutation();

-- ─────────────────── Funções utilitárias (sem RLS/auth.uid()) ───────────────────
-- _actor_id/_me são resolvidos no Express a partir da sessão (req.profile.id)
-- e passados explicitamente — a app é a fronteira de confiança, não o Postgres.
create or replace function log_comms_audit(_actor_id uuid, _actor_name text, _action text, _target_type text, _target_id text, _details jsonb default null)
returns void language sql as $$
  insert into comms_audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (_actor_id, _actor_name, _action, _target_type, _target_id, _details)
$$;

create or replace function get_or_create_dm(_me uuid, _other uuid) returns uuid
language plpgsql as $$
declare
  _channel_id uuid;
begin
  if _me is null then raise exception 'não autenticado'; end if;
  if _other = _me then raise exception 'não é possível criar DM consigo mesmo'; end if;

  select c.id into _channel_id
  from channels c
  where c.is_dm = true
    and exists (select 1 from channel_members m1 where m1.channel_id = c.id and m1.user_id = _me)
    and exists (select 1 from channel_members m2 where m2.channel_id = c.id and m2.user_id = _other)
    and (select count(*) from channel_members m where m.channel_id = c.id) = 2
  limit 1;

  if _channel_id is not null then
    return _channel_id;
  end if;

  insert into channels (name, visibility, is_dm, created_by)
  values ('DM', 'private', true, _me)
  returning id into _channel_id;

  insert into channel_members (channel_id, user_id) values (_channel_id, _me), (_channel_id, _other);

  return _channel_id;
end;
$$;

-- Recebe a lista de canais acessíveis (já filtrada em JS via canAccessChannel)
-- em vez de recalcular a autorização dentro do SQL.
create or replace function get_unread_counts(_me uuid, _accessible_channel_ids uuid[])
returns table(channel_id uuid, unread_count bigint)
language sql stable as $$
  select m.channel_id, count(*) as unread_count
  from messages m
  left join channel_reads r on r.channel_id = m.channel_id and r.user_id = _me
  where m.channel_id = any(_accessible_channel_ids)
    and m.author_id <> _me
    and m.created_at > coalesce(r.last_read_at, 'epoch'::timestamptz)
  group by m.channel_id
$$;

commit;
