-- Anotações — descentraliza planilhas/blocos de notas externos. Hierarquia de
-- UM nível só (raiz -> pasta -> item); pastas nunca contêm pastas. Cada pasta
-- e cada item tem visibilidade própria: 'personal' (só o criador vê/mexe,
-- invisível pra qualquer outra pessoa em qualquer listagem) ou 'shared'
-- (todo mundo vê e tem autonomia total). Mesma natureza de dado colaborativo
-- de Comunicação Interna/Agenda/Funis — por isso vive aqui em Postgres, não
-- no SQLite do engine.
begin;

do $$ begin
  create type annotation_visibility as enum ('personal', 'shared');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type annotation_item_type as enum ('notes', 'table');
exception when duplicate_object then null;
end $$;

create table if not exists annotation_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  visibility annotation_visibility not null default 'personal',
  ordem integer not null default 0,
  created_by uuid not null references auth_users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth_users(id),
  updated_at timestamptz not null default now()
);
create index if not exists idx_annotation_folders_created_by on annotation_folders(created_by);

-- folder_id nulo = item solto na raiz. Sem FK pra "pasta pai" recursiva — a
-- própria coluna já impede aninhamento (uma pasta não tem folder_id).
create table if not exists annotation_items (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references annotation_folders(id) on delete cascade,
  name text not null,
  type annotation_item_type not null,
  visibility annotation_visibility not null default 'personal',
  ordem integer not null default 0,
  created_by uuid not null references auth_users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth_users(id),
  updated_at timestamptz not null default now()
);
create index if not exists idx_annotation_items_folder on annotation_items(folder_id);
create index if not exists idx_annotation_items_created_by on annotation_items(created_by);

-- Modo Bloco de Notas — um item "notes" contém N balões (linhas aqui).
create table if not exists annotation_notes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references annotation_items(id) on delete cascade,
  content text not null default '',        -- HTML restrito (negrito/itálico/listas — sanitizado no backend)
  size text not null default 'small' check (size in ('small', 'large')),
  color text not null default '#4A8EFF',   -- hex — mesma convenção de Tags.tsx (PALETTE), não hsl(var(--x))
  ordem integer not null default 0,
  created_by uuid references auth_users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth_users(id),
  updated_at timestamptz not null default now()
);
create index if not exists idx_annotation_notes_item on annotation_notes(item_id);

-- Modo Tabela — colunas dinâmicas (schema) sem precisar de migration por
-- tabela criada; linhas guardadas como JSONB { <column_id>: valor }.
create table if not exists annotation_table_columns (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references annotation_items(id) on delete cascade,
  name text not null,
  type text not null check (type in ('text', 'number', 'currency', 'link', 'email')),
  ordem integer not null default 0
);
create index if not exists idx_annotation_table_columns_item on annotation_table_columns(item_id);

create table if not exists annotation_table_rows (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references annotation_items(id) on delete cascade,
  data jsonb not null default '{}',
  ordem integer not null default 0,
  updated_by uuid references auth_users(id),
  updated_at timestamptz not null default now()
);
create index if not exists idx_annotation_table_rows_item on annotation_table_rows(item_id);

-- Auditoria de exclusão — só relevante para pastas/itens COMPARTILHADOS (um
-- item pessoal só pode ser apagado pelo próprio dono; não há "outra pessoa"
-- pra auditar contra).
create table if not exists annotation_audit_log (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  actor_id uuid references auth_users(id),
  actor_name text,
  action text not null,        -- 'folder.delete' | 'item.delete'
  target_type text not null,   -- 'folder' | 'item'
  target_id uuid not null,
  target_name text,
  details jsonb
);
create index if not exists idx_annotation_audit_log_target on annotation_audit_log(target_type, target_id);

commit;
