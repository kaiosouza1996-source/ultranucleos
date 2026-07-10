-- Comunicação Interna — permite reordenar categorias e canais direto na tela
-- (sem precisar de SQL). Rode isto DEPOIS de 0004.
begin;

drop policy if exists "criador ou sócio reordena categoria" on public.comms_categories;
create policy "criador ou sócio reordena categoria" on public.comms_categories
  for update using (created_by = auth.uid() or public.is_socio())
  with check (created_by = auth.uid() or public.is_socio());

drop policy if exists "criador ou sócio reordena canal" on public.channels;
create policy "criador ou sócio reordena canal" on public.channels
  for update using (created_by = auth.uid() or public.is_socio())
  with check (created_by = auth.uid() or public.is_socio());

-- Ordem inicial (igual à foto que você mandou) — depois disso, use as setinhas
-- ▲▼ na tela pra reorganizar quando quiser, sem precisar rodar SQL de novo.
update public.comms_categories set position = 0 where name = 'GERAL';
update public.comms_categories set position = 1 where name = 'COMERCIAL';
update public.comms_categories set position = 2 where name = 'OPERACIONAL';
update public.comms_categories set position = 3 where name = 'COMPLIANCE';
update public.comms_categories set position = 4 where name = 'SOCIOS';
update public.comms_categories set position = 5 where name = 'HANDOFF';

commit;
