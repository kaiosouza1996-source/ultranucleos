/**
 * Funis de CRM customizados — diferente do "Funil do CRM" padrão (que é por
 * usuário, vive em SQLite: pipeline_stages/contact_stage, intocado por este
 * módulo), estes são COMPARTILHADOS por toda a equipe: qualquer papel
 * autenticado pode criar um funil novo e ele aparece igual para todo mundo
 * (decisão confirmada com o usuário — ver plano). Vivem em Postgres porque
 * são dado de colaboração multiusuário, mesma natureza de Comunicação
 * Interna/Agenda.
 *
 * contato_id referencia a tabela `contacts` do SQLite do engine (id TEXT) —
 * não há FK entre bancos; a existência do contato é responsabilidade de quem
 * chama (o frontend só manda ids que já veio de GET /contacts).
 */
const express = require('express');
const { query } = require('./pg');
const { requireSession } = require('./authz');

function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const mapEtapa = (r) => ({ id: r.id, funilId: r.funil_id, nome: r.nome, ordem: r.ordem, cor: r.cor });
const mapFunil = (r, etapas) => ({
  id: r.id, nome: r.nome, criadoPor: r.criado_por, ordem: r.ordem, ativo: r.ativo, createdAt: r.created_at,
  etapas: (etapas || []).map(mapEtapa),
});

function createRouter() {
  const router = express.Router();
  router.use(requireSession);

  router.get('/', ah(async (req, res) => {
    const { rows: funis } = await query('select * from funis where ativo = true order by ordem, created_at');
    const { rows: etapas } = await query('select * from etapas_funil order by ordem');
    const byFunil = {};
    for (const e of etapas) (byFunil[e.funil_id] ||= []).push(e);
    res.json(funis.map((f) => mapFunil(f, byFunil[f.id])));
  }));

  router.post('/', ah(async (req, res) => {
    const { nome, etapas } = req.body || {};
    if (!nome || !String(nome).trim()) return res.status(400).json({ error: 'nome é obrigatório.' });
    const { rows: ordRows } = await query('select coalesce(max(ordem), -1) + 1 as next from funis');
    const { rows } = await query(
      'insert into funis (nome, criado_por, ordem) values ($1,$2,$3) returning *',
      [String(nome).trim(), req.profile.id, ordRows[0].next],
    );
    const funil = rows[0];
    const etapaList = Array.isArray(etapas) ? etapas : [];
    const inserted = [];
    for (let i = 0; i < etapaList.length; i++) {
      const e = etapaList[i];
      if (!e?.nome) continue;
      const { rows: er } = await query(
        'insert into etapas_funil (funil_id, nome, ordem, cor) values ($1,$2,$3,$4) returning *',
        [funil.id, String(e.nome).trim(), e.ordem ?? i, e.cor || null],
      );
      inserted.push(er[0]);
    }
    res.json(mapFunil(funil, inserted));
  }));

  async function getFunilOr404(req, res) {
    const { rows } = await query('select * from funis where id = $1', [req.params.id]);
    if (!rows[0]) { res.status(404).json({ error: 'Funil não encontrado.' }); return null; }
    return rows[0];
  }

  router.patch('/:id', ah(async (req, res) => {
    const funil = await getFunilOr404(req, res);
    if (!funil) return;
    const { nome, ordem, ativo } = req.body || {};
    const { rows } = await query(
      'update funis set nome = coalesce($1, nome), ordem = coalesce($2, ordem), ativo = coalesce($3, ativo) where id = $4 returning *',
      [nome || null, ordem ?? null, typeof ativo === 'boolean' ? ativo : null, req.params.id],
    );
    res.json(mapFunil(rows[0]));
  }));

  router.delete('/:id', ah(async (req, res) => {
    const funil = await getFunilOr404(req, res);
    if (!funil) return;
    // Exclusão do funil padrão nem é possível aqui — ele não existe nesta
    // tabela (vive em pipeline_stages/SQLite). Só funis customizados chegam
    // a este DELETE.
    await query('delete from funis where id = $1', [req.params.id]);
    res.json({ ok: true });
  }));

  router.post('/:id/etapas', ah(async (req, res) => {
    const funil = await getFunilOr404(req, res);
    if (!funil) return;
    const { nome, ordem, cor } = req.body || {};
    if (!nome || !String(nome).trim()) return res.status(400).json({ error: 'nome é obrigatório.' });
    const { rows: ordRows } = await query('select coalesce(max(ordem), -1) + 1 as next from etapas_funil where funil_id = $1', [req.params.id]);
    const { rows } = await query(
      'insert into etapas_funil (funil_id, nome, ordem, cor) values ($1,$2,$3,$4) returning *',
      [req.params.id, String(nome).trim(), ordem ?? ordRows[0].next, cor || null],
    );
    res.json(mapEtapa(rows[0]));
  }));

  router.patch('/:id/etapas/:etapaId', ah(async (req, res) => {
    const { nome, ordem, cor } = req.body || {};
    const { rows } = await query(
      `update etapas_funil set nome = coalesce($1, nome), ordem = coalesce($2, ordem), cor = coalesce($3, cor)
       where id = $4 and funil_id = $5 returning *`,
      [nome || null, ordem ?? null, cor || null, req.params.etapaId, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Etapa não encontrada.' });
    res.json(mapEtapa(rows[0]));
  }));

  router.delete('/:id/etapas/:etapaId', ah(async (req, res) => {
    const { rows: remaining } = await query('select id from etapas_funil where funil_id = $1 and id <> $2', [req.params.id, req.params.etapaId]);
    if (!remaining.length) return res.status(400).json({ error: 'Pelo menos uma etapa deve existir no funil.' });
    // Contatos que estavam na etapa apagada migram para a primeira etapa
    // restante — mesmo padrão de DELETE /pipeline/stages/:key no funil padrão.
    const fallbackId = remaining[0].id;
    await query('update contato_funil_etapa set etapa_id = $1 where funil_id = $2 and etapa_id = $3', [fallbackId, req.params.id, req.params.etapaId]);
    await query('delete from etapas_funil where id = $1 and funil_id = $2', [req.params.etapaId, req.params.id]);
    res.json({ ok: true });
  }));

  // Mapeamento contato → etapa deste funil (o frontend cruza contatoId com a
  // lista já carregada de GET /contacts — não há join entre bancos aqui).
  router.get('/:id/contatos', ah(async (req, res) => {
    const { rows } = await query('select * from contato_funil_etapa where funil_id = $1', [req.params.id]);
    res.json(rows.map((r) => ({ contatoId: r.contato_id, etapaId: r.etapa_id, atualizadoEm: r.atualizado_em, atualizadoPor: r.atualizado_por })));
  }));

  router.post('/:funilId/contatos/:contatoId/etapa', ah(async (req, res) => {
    const { etapaId } = req.body || {};
    if (!etapaId) return res.status(400).json({ error: 'etapaId é obrigatório.' });
    const { rows: etapaRows } = await query('select id from etapas_funil where id = $1 and funil_id = $2', [etapaId, req.params.funilId]);
    if (!etapaRows[0]) return res.status(400).json({ error: 'Etapa inválida para este funil.' });
    await query(
      `insert into contato_funil_etapa (contato_id, funil_id, etapa_id, atualizado_por)
       values ($1,$2,$3,$4)
       on conflict (contato_id, funil_id) do update set etapa_id = $3, atualizado_em = now(), atualizado_por = $4`,
      [req.params.contatoId, req.params.funilId, etapaId, req.profile.id],
    );
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { createRouter };
