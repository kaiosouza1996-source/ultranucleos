-- Item 1b do plano de segurança — login com Supabase Auth + RBAC.
-- Rode isto no SQL Editor do seu projeto Supabase (uma vez).
--
-- Papéis: Sócio (Kaio, Jociney, Yuri) | Comercial (Nicolas) | Operacional (Celene)
-- Pensado para autenticar o CRM inteiro E o futuro módulo de Comunicação Interna.

create type public.user_role as enum ('socio', 'comercial', 'operacional');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.user_role not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cada usuário só lê o próprio perfil. Isso também é o que o whatsapp-engine
-- usa para verificar o papel de quem chama /conversations/:id/archive e
-- /audit/* — o engine consulta esta tabela com o PRÓPRIO token do usuário
-- (Authorization: Bearer <access_token>), então essa policy é suficiente:
-- ele nunca precisa ler o perfil de outra pessoa.
create policy "select own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Ninguém edita o próprio papel pelo cliente — só via SQL Editor/dashboard
-- (evita que um usuário comercial se promova a sócio editando a própria linha).
-- (Sem policy de update/insert/delete para authenticated = bloqueado por padrão com RLS ligado.)

-- ─────────────────────────────────────────────────────────────────────────
-- Passo a passo para cadastrar os 5 usuários (fazer uma vez, manualmente):
--
-- 1. No Dashboard do Supabase → Authentication → Users → "Add user",
--    crie um usuário para cada pessoa (email + senha temporária):
--      Kaio, Jociney, Yuri, Nicolas, Celene
--
-- 2. Copie o "User UID" de cada um (aparece na lista de usuários) e rode:
--
-- insert into public.profiles (id, full_name, role) values
--   ('UUID-DO-KAIO',    'Kaio',    'socio'),
--   ('UUID-DO-JOCINEY', 'Jociney', 'socio'),
--   ('UUID-DO-YURI',    'Yuri',    'socio'),
--   ('UUID-DO-NICOLAS', 'Nicolas', 'comercial'),
--   ('UUID-DA-CELENE',  'Celene',  'operacional');
--
-- 3. Peça para cada um trocar a senha no primeiro login (ou envie um link de
--    "reset password" pelo próprio dashboard do Supabase).
