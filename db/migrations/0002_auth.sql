-- Autenticação própria (substitui Supabase Auth por completo).
-- Sessão em tabela (não JWT stateless) — cookie httpOnly guarda um token
-- opaco aleatório; aqui só guardamos o hash SHA-256 dele, nunca o valor cru.
begin;

create table if not exists auth_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,             -- argon2id
  full_name text not null,
  role user_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Secret do TOTP nunca fica em texto puro — mesmo padrão AES-256-GCM
-- (whatsapp-engine/crypto.js) já usado para telefone/documento do CRM.
create table if not exists auth_mfa_totp (
  user_id uuid primary key references auth_users(id) on delete cascade,
  secret_enc text not null,
  status text not null default 'pending' check (status in ('pending', 'verified')),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);

create table if not exists auth_sessions (
  token_hash text primary key,
  user_id uuid not null references auth_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  aal text not null default 'aal1' check (aal in ('aal1', 'aal2')),
  user_agent text,
  ip inet,
  revoked_at timestamptz
);
create index if not exists idx_auth_sessions_user on auth_sessions(user_id) where revoked_at is null;

create table if not exists auth_password_resets (
  token_hash text primary key,
  user_id uuid not null references auth_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Rate limit por IP já existe em nível de Express (express-rate-limit). Estas
-- duas tabelas cobrem o requisito adicional de "bloqueio progressivo POR CONTA",
-- que um limite por IP sozinho não resolve (ex.: ataque distribuído contra 1 email).
create table if not exists auth_login_attempts (
  id bigserial primary key,
  email text not null,
  ip inet not null,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_login_attempts_email on auth_login_attempts(email, created_at);
create index if not exists idx_login_attempts_ip on auth_login_attempts(ip, created_at);

create table if not exists auth_lockouts (
  email text primary key,
  failed_count int not null default 0,
  locked_until timestamptz
);

commit;
