-- Comunicação Interna — módulo de chat interno (substitui o Discord).
-- Rode isto no SQL Editor do Supabase (uma vez), DEPOIS de 0001_profiles_and_roles.sql.
--
-- Reaproveita 100% o Supabase Auth + profiles/roles já existentes — nenhum
-- login novo. RLS mapeia papel -> canal -> permissão de leitura/escrita.
--
-- Tudo dentro de uma transação: se algo falhar no meio, nada fica pela
-- metade — dá pra corrigir e rodar de novo do zero sem se preocupar com
-- "já existe" (o DROP IF EXISTS/CREATE OR REPLACE cobre isso também).
begin;

-- ───────────────────── profiles: leitura por colegas ─────────────────────
drop policy if exists "colegas leem nome e papel uns dos outros" on public.profiles;
create policy "colegas leem nome e papel uns dos outros"
  on public.profiles for select
  using (auth.role() = 'authenticated');

-- ───────────────────────────── Tabelas (primeiro!) ─────────────────────────────
-- As funções auxiliares abaixo consultam essas tabelas — precisam existir antes.
do $$ begin
  create type public.channel_visibility as enum ('public', 'role', 'private');
exception when duplicate_object then null;
end $$;

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text,
  visibility public.channel_visibility not null default 'public',
  allowed_roles public.user_role[],
  is_dm boolean not null default false,
  is_handoff boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text,
  is_client_data boolean not null default false,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.client_data_cards (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id),
  message_id uuid references public.messages(id),
  created_by uuid not null references public.profiles(id),
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

create table if not exists public.comms_audit_log (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  actor_id uuid references public.profiles(id),
  actor_name text,
  action text not null,
  target_type text,
  target_id text,
  details jsonb
);

-- ───────────────────────────── Helpers ─────────────────────────────
create or replace function public.current_role() returns public.user_role
language sql security definer stable as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_socio() returns boolean
language sql security definer stable as $$
  select coalesce(public.current_role() = 'socio', false)
$$;

-- Sócio tem "acesso total" (ver Manual Operacional) — pode ler/escrever em
-- QUALQUER canal, mesmo os restritos a outros papéis.
create or replace function public.can_access_channel(_channel_id uuid) returns boolean
language sql security definer stable as $$
  select
    public.is_socio()
    or exists (
      select 1 from public.channels c
      where c.id = _channel_id
      and (
        c.visibility = 'public'
        or (c.visibility = 'role' and public.current_role() = any(c.allowed_roles))
        or (c.visibility = 'private' and exists (
          select 1 from public.channel_members m
          where m.channel_id = _channel_id and m.user_id = auth.uid()
        ))
      )
    )
$$;

create or replace function public.block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% é imutável — não pode ser alterado nem apagado (Seção 13 do Manual Operacional)', TG_TABLE_NAME;
end;
$$;

-- Mensagem só é imutável se marcada como dado de cliente OU se está num
-- canal de handoff — conversa comum continua editável/apagável pelo autor.
create or replace function public.messages_block_mutation() returns trigger
language plpgsql as $$
declare
  _is_handoff boolean;
begin
  select is_handoff into _is_handoff from public.channels where id = OLD.channel_id;
  if OLD.is_client_data or coalesce(_is_handoff, false) then
    raise exception 'Mensagens de dado de cliente ou de canal de handoff não podem ser alteradas/apagadas (Seção 13 do Manual Operacional)';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

-- ─────────────────────── Imutabilidade (triggers) ───────────────────────
drop trigger if exists client_data_cards_immutable on public.client_data_cards;
create trigger client_data_cards_immutable
  before update or delete on public.client_data_cards
  for each row execute function public.block_mutation();

drop trigger if exists comms_audit_log_immutable on public.comms_audit_log;
create trigger comms_audit_log_immutable
  before update or delete on public.comms_audit_log
  for each row execute function public.block_mutation();

drop trigger if exists messages_immutable on public.messages;
create trigger messages_immutable
  before update or delete on public.messages
  for each row execute function public.messages_block_mutation();

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages enable row level security;
alter table public.client_data_cards enable row level security;
alter table public.comms_audit_log enable row level security;

drop policy if exists "lê canal se tem acesso" on public.channels;
create policy "lê canal se tem acesso" on public.channels
  for select using (public.can_access_channel(id));
drop policy if exists "cria canal" on public.channels;
create policy "cria canal" on public.channels
  for insert with check (auth.uid() is not null and created_by = auth.uid());

drop policy if exists "lê membros de canal acessível" on public.channel_members;
create policy "lê membros de canal acessível" on public.channel_members
  for select using (public.can_access_channel(channel_id));
drop policy if exists "adiciona membro em canal acessível" on public.channel_members;
create policy "adiciona membro em canal acessível" on public.channel_members
  for insert with check (public.can_access_channel(channel_id));
drop policy if exists "sai do canal ou sócio remove" on public.channel_members;
create policy "sai do canal ou sócio remove" on public.channel_members
  for delete using (user_id = auth.uid() or public.is_socio());

drop policy if exists "lê mensagens de canal acessível" on public.messages;
create policy "lê mensagens de canal acessível" on public.messages
  for select using (public.can_access_channel(channel_id));
drop policy if exists "posta mensagem em canal acessível" on public.messages;
create policy "posta mensagem em canal acessível" on public.messages
  for insert with check (public.can_access_channel(channel_id) and author_id = auth.uid());
drop policy if exists "autor ou sócio edita/apaga (se não imutável)" on public.messages;
create policy "autor ou sócio edita/apaga (se não imutável)" on public.messages
  for update using (author_id = auth.uid() or public.is_socio());
drop policy if exists "autor ou sócio apaga (se não imutável)" on public.messages;
create policy "autor ou sócio apaga (se não imutável)" on public.messages
  for delete using (author_id = auth.uid() or public.is_socio());

drop policy if exists "lê card de handoff em canal acessível" on public.client_data_cards;
create policy "lê card de handoff em canal acessível" on public.client_data_cards
  for select using (public.can_access_channel(channel_id));
drop policy if exists "cria card com autorização expressa" on public.client_data_cards;
create policy "cria card com autorização expressa" on public.client_data_cards
  for insert with check (public.can_access_channel(channel_id) and created_by = auth.uid() and autorizacao_expressa = true);

drop policy if exists "só sócio lê o audit log" on public.comms_audit_log;
create policy "só sócio lê o audit log" on public.comms_audit_log
  for select using (public.is_socio());

create or replace function public.log_comms_audit(_action text, _target_type text, _target_id text, _details jsonb default null)
returns void language plpgsql security definer as $$
declare
  _name text;
begin
  select full_name into _name from public.profiles where id = auth.uid();
  insert into public.comms_audit_log (actor_id, actor_name, action, target_type, target_id, details)
  values (auth.uid(), _name, _action, _target_type, _target_id, _details);
end;
$$;

-- Busca a DM existente entre eu e _other, ou cria uma nova — atômico (evita
-- duas DMs duplicadas se ambos clicarem "conversar" ao mesmo tempo).
create or replace function public.get_or_create_dm(_other uuid) returns uuid
language plpgsql security definer as $$
declare
  _channel_id uuid;
  _me uuid := auth.uid();
begin
  if _me is null then raise exception 'não autenticado'; end if;
  if _other = _me then raise exception 'não é possível criar DM consigo mesmo'; end if;

  select c.id into _channel_id
  from public.channels c
  where c.is_dm = true
    and exists (select 1 from public.channel_members m1 where m1.channel_id = c.id and m1.user_id = _me)
    and exists (select 1 from public.channel_members m2 where m2.channel_id = c.id and m2.user_id = _other)
    and (select count(*) from public.channel_members m where m.channel_id = c.id) = 2
  limit 1;

  if _channel_id is not null then
    return _channel_id;
  end if;

  insert into public.channels (name, visibility, is_dm, created_by)
  values ('DM', 'private', true, _me)
  returning id into _channel_id;

  insert into public.channel_members (channel_id, user_id) values (_channel_id, _me), (_channel_id, _other);

  return _channel_id;
end;
$$;

-- ───────────────────────── Canais padrão (seed) ─────────────────────────
-- Todos com visibility='role' (acesso calculado pelo papel, sem precisar de
-- linha em channel_members) — exceto GERAL, que é público pra empresa toda.
-- HANDOFF é um canal extra (não estava na lista original de categorias do
-- Discord) criado para resolver uma lacuna real: COMERCIAL e OPERACIONAL são
-- restritos a papéis diferentes, então Nicolas (comercial) e Celene
-- (operacional) não teriam nenhum canal padrão em comum pra fazer o handoff
-- estruturado exigido — HANDOFF é visível a ambos os papéis (+ Sócio) e é
-- o canal onde os cards de dado de cliente (imutáveis) devem ser postados.
insert into public.channels (name, category, description, visibility, allowed_roles, is_handoff)
select * from (values
  ('Geral',       'GERAL',       'Avisos e conversa geral da empresa.',                                   'public'::public.channel_visibility, null::public.user_role[], false),
  ('Comercial',   'COMERCIAL',   'Canal do time comercial.',                                               'role'::public.channel_visibility,   array['comercial','socio']::public.user_role[], false),
  ('Operacional', 'OPERACIONAL', 'Canal do back-office/operacional.',                                      'role'::public.channel_visibility,   array['operacional','socio']::public.user_role[], false),
  ('Compliance',  'COMPLIANCE',  'Avisos e regras de compliance — Seção 13 do Manual Operacional.',        'role'::public.channel_visibility,   array['socio','comercial','operacional']::public.user_role[], false),
  ('Sócios',      'SOCIOS',      'Canal privado dos sócios.',                                              'role'::public.channel_visibility,   array['socio']::public.user_role[], false),
  ('Handoff',     'HANDOFF',     'Passagem estruturada de cliente do Comercial para o Operacional.',       'role'::public.channel_visibility,   array['comercial','operacional','socio']::public.user_role[], true)
) as seed(name, category, description, visibility, allowed_roles, is_handoff)
where not exists (select 1 from public.channels c where c.category = seed.category);

-- ───────────────────────── Realtime ─────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

commit;
