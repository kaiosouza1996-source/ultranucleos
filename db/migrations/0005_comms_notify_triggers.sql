-- Realtime — substitui a "publication supabase_realtime" do Supabase por
-- NOTIFY nativo do Postgres. O processo Node (whatsapp-engine/realtime.js)
-- mantém um client dedicado com `LISTEN comms_events` e faz o broadcast via
-- WebSocket para quem tem acesso ao canal (autorização em app-layer).
begin;

create or replace function notify_comms_event() returns trigger
language plpgsql as $$
begin
  perform pg_notify('comms_events', json_build_object(
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'row', row_to_json(coalesce(NEW, OLD))
  )::text);
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists messages_notify on messages;
create trigger messages_notify
  after insert or update on messages
  for each row execute function notify_comms_event();

drop trigger if exists channel_reads_notify on channel_reads;
create trigger channel_reads_notify
  after insert or update on channel_reads
  for each row execute function notify_comms_event();

commit;
