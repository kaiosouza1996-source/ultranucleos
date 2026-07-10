-- Multi-funil de CRM (compartilhado entre toda a equipe — diferente do funil
-- padrão, que continua por usuário em SQLite: pipeline_stages/contact_stage)
-- + ocultar DM iniciada pelo próprio usuário (Parte D2).
begin;

create table if not exists funis (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_por uuid references auth_users(id),
  ordem integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists etapas_funil (
  id uuid primary key default gen_random_uuid(),
  funil_id uuid not null references funis(id) on delete cascade,
  nome text not null,
  ordem integer not null default 0,
  cor text
);
create index if not exists idx_etapas_funil_funil_id on etapas_funil (funil_id);

-- contato_id referencia a linha da tabela SQLite `contacts` (id TEXT) — sem FK
-- entre bancos; a validação de que o contato existe é feita em app-layer
-- contra o engine (GET /contacts), não aqui.
create table if not exists contato_funil_etapa (
  contato_id text not null,
  funil_id uuid not null references funis(id) on delete cascade,
  etapa_id uuid not null references etapas_funil(id),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth_users(id),
  primary key (contato_id, funil_id)
);

-- Ocultar DM (Parte D2) — só quem iniciou a DM (channels.created_by) pode
-- ocultá-la, e só some da PRÓPRIA lista (a linha do outro membro em
-- channel_members não é afetada).
alter table channel_members add column if not exists hidden_at timestamptz;

commit;
