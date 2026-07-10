-- Comunicação Interna — hierarquia real de Servidor → Categoria → Canal
-- (igual Discord). Rode isto no SQL Editor do Supabase DEPOIS de 0002 e 0003.
begin;

create table if not exists public.comms_servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon_emoji text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.comms_categories (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.comms_servers(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.channels add column if not exists server_id uuid references public.comms_servers(id) on delete cascade;
alter table public.channels add column if not exists category_id uuid references public.comms_categories(id) on delete set null;
alter table public.channels add column if not exists position integer not null default 0;

-- Servidor/categoria são só ORGANIZAÇÃO — a segurança de verdade continua nos
-- canais (can_access_channel, já existente, inalterada). Todo autenticado vê
-- a estrutura de pastas; criar/apagar servidor é coisa de Sócio (papel
-- administrativo); categoria e canal qualquer autenticado cria, e só quem
-- criou (ou Sócio) apaga.
alter table public.comms_servers enable row level security;
alter table public.comms_categories enable row level security;

drop policy if exists "todo mundo autenticado lê servidores" on public.comms_servers;
create policy "todo mundo autenticado lê servidores" on public.comms_servers
  for select using (auth.role() = 'authenticated');
drop policy if exists "sócio cria servidor" on public.comms_servers;
create policy "sócio cria servidor" on public.comms_servers
  for insert with check (public.is_socio());
drop policy if exists "sócio apaga servidor" on public.comms_servers;
create policy "sócio apaga servidor" on public.comms_servers
  for delete using (public.is_socio());

drop policy if exists "todo mundo autenticado lê categorias" on public.comms_categories;
create policy "todo mundo autenticado lê categorias" on public.comms_categories
  for select using (auth.role() = 'authenticated');
drop policy if exists "autenticado cria categoria" on public.comms_categories;
create policy "autenticado cria categoria" on public.comms_categories
  for insert with check (auth.uid() is not null);
drop policy if exists "criador ou sócio apaga categoria" on public.comms_categories;
create policy "criador ou sócio apaga categoria" on public.comms_categories
  for delete using (created_by = auth.uid() or public.is_socio());

-- Canal nunca tinha policy de DELETE de verdade (só a de moderação de
-- mensagem) — faltava essa pra permitir apagar canal.
drop policy if exists "criador ou sócio apaga canal" on public.channels;
create policy "criador ou sócio apaga canal" on public.channels
  for delete using (created_by = auth.uid() or public.is_socio());

-- ─────────────── Migra os 6 canais já existentes ───────────────
-- Cria o servidor "Áurea Investing" (se ainda não existir) e uma categoria
-- real pra cada rótulo de texto usado até agora, movendo os canais pra dentro.
do $$
declare
  _server_id uuid;
  _cat record;
  _cat_id uuid;
begin
  select id into _server_id from public.comms_servers where name = 'Áurea Investing' limit 1;
  if _server_id is null then
    insert into public.comms_servers (name, icon_emoji) values ('Áurea Investing', '🅰️') returning id into _server_id;
  end if;

  for _cat in select distinct category from public.channels where category is not null and server_id is null
  loop
    select id into _cat_id from public.comms_categories where server_id = _server_id and name = _cat.category limit 1;
    if _cat_id is null then
      insert into public.comms_categories (server_id, name) values (_server_id, _cat.category) returning id into _cat_id;
    end if;
    update public.channels set server_id = _server_id, category_id = _cat_id where category = _cat.category and server_id is null;
  end loop;

  -- Canais sem categoria (customizados criados antes desta migration) também
  -- entram no servidor padrão, só sem categoria (aparecem em "Sem categoria").
  update public.channels set server_id = _server_id where server_id is null and is_dm = false;
end $$;

commit;
