-- Comunicação Interna — extras: edição de mensagem, anexos, não lidas.
-- Rode isto no SQL Editor do Supabase (uma vez), DEPOIS de 0002.

-- ───────────────────────── Edição de mensagem ─────────────────────────
-- A policy de UPDATE já existe (0002: "autor ou sócio edita/apaga se não
-- imutável") e o trigger messages_immutable já bloqueia edição de mensagens
-- de dado de cliente/canal de handoff — só falta a coluna pra marcar "editado".
alter table public.messages add column if not exists edited_at timestamptz;

-- ───────────────────────────── Anexos ─────────────────────────────
alter table public.messages add column if not exists attachment_path text;
alter table public.messages add column if not exists attachment_name text;
alter table public.messages add column if not exists attachment_type text;

insert into storage.buckets (id, name, public)
values ('comms-attachments', 'comms-attachments', false)
on conflict (id) do nothing;

-- Caminho do arquivo é sempre "<channel_id>/<nome-aleatório>" — a policy usa
-- a mesma regra de acesso a canal (can_access_channel) já usada em tudo mais,
-- então um anexo só é lido/enviado por quem já pode ver aquele canal.
create policy "lê anexo se acessa o canal"
  on storage.objects for select
  using (bucket_id = 'comms-attachments' and public.can_access_channel(((storage.foldername(name))[1])::uuid));

create policy "envia anexo se acessa o canal"
  on storage.objects for insert
  with check (bucket_id = 'comms-attachments' and public.can_access_channel(((storage.foldername(name))[1])::uuid));

-- ───────────────────────── Mensagens não lidas ─────────────────────────
create table public.channel_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);
alter table public.channel_reads enable row level security;

create policy "cada um só mexe no próprio marcador de leitura"
  on public.channel_reads for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.get_unread_counts()
returns table(channel_id uuid, unread_count bigint)
language sql security definer stable as $$
  select m.channel_id, count(*) as unread_count
  from public.messages m
  left join public.channel_reads r on r.channel_id = m.channel_id and r.user_id = auth.uid()
  where public.can_access_channel(m.channel_id)
    and m.author_id <> auth.uid()
    and m.created_at > coalesce(r.last_read_at, 'epoch'::timestamptz)
  group by m.channel_id
$$;

-- Realtime para channel_reads (pra zerar o badge de não lida em outras abas
-- da mesma pessoa, se estiver aberta em duas telas ao mesmo tempo).
alter publication supabase_realtime add table public.channel_reads;
