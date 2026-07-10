-- Comunicação Interna — hierarquia Servidor → Categoria → Canal, já com o
-- seed padrão direto (ambiente novo, sem dado legado pra migrar categorias
-- de texto como no Supabase original).
begin;

create table if not exists comms_servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon_emoji text,
  created_by uuid references auth_users(id),
  created_at timestamptz not null default now()
);

create table if not exists comms_categories (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references comms_servers(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_by uuid references auth_users(id),
  created_at timestamptz not null default now(),
  unique (server_id, name)
);

-- Colunas server_id/category_id/position já existem desde 0003; aqui só
-- adicionamos as foreign keys, que dependiam de comms_servers/comms_categories
-- existirem primeiro.
do $$ begin
  alter table channels add constraint channels_server_id_fkey
    foreign key (server_id) references comms_servers(id) on delete cascade;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table channels add constraint channels_category_id_fkey
    foreign key (category_id) references comms_categories(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- ─────────────────── Seed: servidor único + categorias + canais padrão ───────────────────
do $$
declare
  _server_id uuid;
  _cat_geral uuid;
  _cat_comercial uuid;
  _cat_operacional uuid;
  _cat_compliance uuid;
  _cat_socios uuid;
  _cat_handoff uuid;
begin
  select id into _server_id from comms_servers where name = 'Áurea Investing' limit 1;
  if _server_id is null then
    insert into comms_servers (name, icon_emoji) values ('Áurea Investing', '🅰️') returning id into _server_id;
  end if;

  insert into comms_categories (server_id, name, position)
    values (_server_id, 'GERAL', 0)
    on conflict (server_id, name) do nothing
    returning id into _cat_geral;
  if _cat_geral is null then select id into _cat_geral from comms_categories where server_id = _server_id and name = 'GERAL'; end if;

  insert into comms_categories (server_id, name, position)
    values (_server_id, 'COMERCIAL', 1)
    on conflict (server_id, name) do nothing
    returning id into _cat_comercial;
  if _cat_comercial is null then select id into _cat_comercial from comms_categories where server_id = _server_id and name = 'COMERCIAL'; end if;

  insert into comms_categories (server_id, name, position)
    values (_server_id, 'OPERACIONAL', 2)
    on conflict (server_id, name) do nothing
    returning id into _cat_operacional;
  if _cat_operacional is null then select id into _cat_operacional from comms_categories where server_id = _server_id and name = 'OPERACIONAL'; end if;

  insert into comms_categories (server_id, name, position)
    values (_server_id, 'COMPLIANCE', 3)
    on conflict (server_id, name) do nothing
    returning id into _cat_compliance;
  if _cat_compliance is null then select id into _cat_compliance from comms_categories where server_id = _server_id and name = 'COMPLIANCE'; end if;

  insert into comms_categories (server_id, name, position)
    values (_server_id, 'SOCIOS', 4)
    on conflict (server_id, name) do nothing
    returning id into _cat_socios;
  if _cat_socios is null then select id into _cat_socios from comms_categories where server_id = _server_id and name = 'SOCIOS'; end if;

  insert into comms_categories (server_id, name, position)
    values (_server_id, 'HANDOFF', 5)
    on conflict (server_id, name) do nothing
    returning id into _cat_handoff;
  if _cat_handoff is null then select id into _cat_handoff from comms_categories where server_id = _server_id and name = 'HANDOFF'; end if;

  insert into channels (name, category, description, visibility, allowed_roles, is_handoff, server_id, category_id, position)
  select * from (values
    ('Geral',       'GERAL',       'Avisos e conversa geral da empresa.',                                   'public'::channel_visibility, null::user_role[], false, _server_id, _cat_geral, 0),
    ('Comercial',   'COMERCIAL',   'Canal do time comercial.',                                               'role'::channel_visibility,   array['comercial','socio']::user_role[], false, _server_id, _cat_comercial, 0),
    ('Operacional', 'OPERACIONAL', 'Canal do back-office/operacional.',                                      'role'::channel_visibility,   array['operacional','socio']::user_role[], false, _server_id, _cat_operacional, 0),
    ('Compliance',  'COMPLIANCE',  'Avisos e regras de compliance — Seção 13 do Manual Operacional.',        'role'::channel_visibility,   array['socio','comercial','operacional']::user_role[], false, _server_id, _cat_compliance, 0),
    ('Sócios',      'SOCIOS',      'Canal privado dos sócios.',                                              'role'::channel_visibility,   array['socio']::user_role[], false, _server_id, _cat_socios, 0),
    ('Handoff',     'HANDOFF',     'Passagem estruturada de cliente do Comercial para o Operacional.',       'role'::channel_visibility,   array['comercial','operacional','socio']::user_role[], true, _server_id, _cat_handoff, 0)
  ) as seed(name, category, description, visibility, allowed_roles, is_handoff, server_id, category_id, position)
  where not exists (select 1 from channels c where c.category = seed.category);
end $$;

commit;
