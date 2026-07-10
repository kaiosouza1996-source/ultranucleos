-- Agenda (eventos pessoais/corporativos) + Notificações (sino no header).
-- Mesma natureza da Comunicação Interna (dado de colaboração multiusuário) —
-- fica no Postgres, não no SQLite do engine (que é só dado de WhatsApp/CRM).
begin;

do $$ begin
  create type calendar_event_type as enum ('PESSOAL', 'CORPORATIVO');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type notification_type as enum ('MENSAGEM_INTERNA', 'AGENDA_CORPORATIVA_CRIADA', 'AGENDA_LEMBRETE');
exception when duplicate_object then null;
end $$;

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  data_hora_inicio timestamptz not null,
  data_hora_fim timestamptz,
  criado_por uuid not null references auth_users(id),
  tipo calendar_event_type not null default 'PESSOAL',
  lembrete_minutos_antes integer not null default 15,
  -- Evita reenviar o mesmo lembrete a cada tick do scanner (ver
  -- whatsapp-engine/agenda.js::startReminderScanner) — projeto não tem
  -- cron/scheduler, então o disparo é por polling.
  reminder_sent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists calendar_events_inicio_idx on calendar_events (data_hora_inicio);
create index if not exists calendar_events_criado_por_idx on calendar_events (criado_por);

-- Notificação é por usuário — se 5 pessoas recebem a mesma notificação, são 5
-- linhas aqui, cada uma com seu próprio `lida` (uma pessoa marcar como lida
-- nunca zera o contador de outra). Sem FK polimórfica em `referencia_id`
-- (aponta para `messages` ou `calendar_events` conforme `tipo`) — mesmo
-- padrão informal já usado em `client_data_cards`/`comms_audit_log` para
-- referências heterogêneas.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  tipo notification_type not null,
  referencia_id uuid,
  usuario_destino_id uuid not null references auth_users(id),
  lida boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists notifications_destino_idx on notifications (usuario_destino_id, lida);

commit;
