/**
 * Anotações — pastas/itens (bloco de notas ou tabela), hierarquia de 1 nível,
 * visibilidade pessoal/compartilhada. Mesma natureza de dado colaborativo de
 * Comunicação Interna/Agenda/Funis — vive em Postgres, autorização sempre
 * validada aqui (nunca só no frontend).
 *
 * Regra central: `visibility` é 'personal' (só created_by acessa — invisível
 * pra qualquer outra listagem/API) ou 'shared' (todo mundo tem autonomia
 * total: ver, editar, renomear, mover, excluir). canAccess() abaixo é a ÚNICA
 * porta de entrada pra essa regra — todo endpoint de leitura/escrita passa
 * por ela antes de tocar a linha.
 */
const express = require('express');
const { query } = require('./pg');
const { requireSession } = require('./authz');

function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function canAccess(row, profile) {
  return !!row && (row.visibility === 'shared' || row.created_by === profile.id);
}

async function logAudit(req, action, targetType, targetId, targetName, details) {
  try {
    await query(
      `insert into annotation_audit_log (actor_id, actor_name, action, target_type, target_id, target_name, details)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [req.profile.id, req.profile.fullName, action, targetType, targetId, targetName || null, details ? JSON.stringify(details) : null],
    );
  } catch (e) {
    console.error('[annotations] falha ao gravar audit log:', e.message);
  }
}

const mapFolder = (r) => ({
  id: r.id, name: r.name, visibility: r.visibility, ordem: r.ordem,
  createdBy: r.created_by, createdByName: r.created_by_name || null, createdAt: r.created_at,
  updatedBy: r.updated_by, updatedByName: r.updated_by_name || null, updatedAt: r.updated_at,
});
const mapItem = (r) => ({
  id: r.id, folderId: r.folder_id, name: r.name, type: r.type, visibility: r.visibility, ordem: r.ordem,
  createdBy: r.created_by, createdByName: r.created_by_name || null, createdAt: r.created_at,
  updatedBy: r.updated_by, updatedByName: r.updated_by_name || null, updatedAt: r.updated_at,
});
const mapNote = (r) => ({
  id: r.id, itemId: r.item_id, content: r.content, size: r.size, color: r.color, ordem: r.ordem,
  updatedBy: r.updated_by, updatedByName: r.updated_by_name || null, updatedAt: r.updated_at,
});
const mapColumn = (r) => ({ id: r.id, itemId: r.item_id, name: r.name, type: r.type, ordem: r.ordem });
const mapRow = (r) => ({
  id: r.id, itemId: r.item_id, data: r.data, ordem: r.ordem,
  updatedBy: r.updated_by, updatedByName: r.updated_by_name || null, updatedAt: r.updated_at,
});

// Template opcional oferecido na CRIAÇÃO de uma tabela — nunca aplicado
// automaticamente em nenhum outro fluxo (import, criação de pasta, etc).
const TABLE_TEMPLATES = {
  barras_corretagem: [
    { name: 'Nome da Barra', type: 'text' },
    { name: 'Corretagem', type: 'currency' },
    { name: 'Parceiro', type: 'text' },
    { name: 'Código', type: 'text' },
    { name: 'Link de Abertura de Conta', type: 'link' },
    { name: 'E-mail', type: 'email' },
  ],
};

function createRouter() {
  const router = express.Router();
  router.use(requireSession);

  const FOLDER_SELECT = `
    select f.*, u1.full_name as created_by_name, u2.full_name as updated_by_name
    from annotation_folders f
    left join auth_users u1 on u1.id = f.created_by
    left join auth_users u2 on u2.id = f.updated_by
  `;
  const ITEM_SELECT = `
    select i.*, u1.full_name as created_by_name, u2.full_name as updated_by_name
    from annotation_items i
    left join auth_users u1 on u1.id = i.created_by
    left join auth_users u2 on u2.id = i.updated_by
  `;

  async function getFolderOr404(req, res) {
    const { rows } = await query(`${FOLDER_SELECT} where f.id = $1`, [req.params.id]);
    if (!rows[0]) { res.status(404).json({ error: 'Pasta não encontrada.' }); return null; }
    return rows[0];
  }
  async function getItemOr404(req, res, idParam = 'id') {
    const { rows } = await query(`${ITEM_SELECT} where i.id = $1`, [req.params[idParam]]);
    if (!rows[0]) { res.status(404).json({ error: 'Item não encontrado.' }); return null; }
    return rows[0];
  }

  // Árvore inteira (pastas + itens) já filtrada por visibilidade — o
  // frontend nunca recebe uma linha 'personal' de outra pessoa, em nenhuma
  // hipótese (busca, listagem ou drag-and-drop).
  router.get('/tree', ah(async (req, res) => {
    const { rows: folders } = await query(
      `${FOLDER_SELECT} where f.visibility = 'shared' or f.created_by = $1 order by f.ordem, f.created_at`,
      [req.profile.id],
    );
    const { rows: items } = await query(
      `${ITEM_SELECT} where i.visibility = 'shared' or i.created_by = $1 order by i.ordem, i.created_at`,
      [req.profile.id],
    );
    res.json({ folders: folders.map(mapFolder), items: items.map(mapItem) });
  }));

  // ─────────────────────────── Pastas ───────────────────────────
  router.post('/folders', ah(async (req, res) => {
    const { name, visibility } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const vis = visibility === 'shared' ? 'shared' : 'personal';
    const { rows: ordRows } = await query('select coalesce(max(ordem), -1) + 1 as next from annotation_folders');
    const { rows } = await query(
      `insert into annotation_folders (name, visibility, ordem, created_by) values ($1,$2,$3,$4) returning *`,
      [String(name).trim(), vis, ordRows[0].next, req.profile.id],
    );
    res.json(mapFolder({ ...rows[0], created_by_name: req.profile.fullName }));
  }));

  router.patch('/folders/:id', ah(async (req, res) => {
    const folder = await getFolderOr404(req, res);
    if (!folder) return;
    if (!canAccess(folder, req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
    const sets = ['updated_by = $1', 'updated_at = now()'];
    const vals = [req.profile.id];
    if ('name' in req.body) { vals.push(String(req.body.name).trim()); sets.push(`name = $${vals.length}`); }
    if ('visibility' in req.body) { vals.push(req.body.visibility === 'shared' ? 'shared' : 'personal'); sets.push(`visibility = $${vals.length}`); }
    if ('ordem' in req.body) { vals.push(Number(req.body.ordem) || 0); sets.push(`ordem = $${vals.length}`); }
    vals.push(folder.id);
    const { rows } = await query(`update annotation_folders set ${sets.join(', ')} where id = $${vals.length} returning *`, vals);
    res.json(mapFolder({ ...rows[0], created_by_name: folder.created_by_name, updated_by_name: req.profile.fullName }));
  }));

  // Exclusão de pasta: se ela tiver itens VISÍVEIS pro chamador, exige
  // ?mode=cascade (apaga os itens junto) ou ?mode=move_to_root (solta na
  // raiz). Itens PESSOAIS de outra pessoa que estejam dentro da pasta nunca
  // são apagados por quem não é o dono — só voltam pra raiz, silenciosamente
  // (o chamador nem consegue vê-los pra decidir o contrário).
  router.delete('/folders/:id', ah(async (req, res) => {
    const folder = await getFolderOr404(req, res);
    if (!folder) return;
    if (!canAccess(folder, req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
    const { rows: items } = await query('select * from annotation_items where folder_id = $1', [folder.id]);
    const visibleItems = items.filter((it) => canAccess(it, req.profile));
    const hiddenItems = items.filter((it) => !canAccess(it, req.profile));
    const mode = req.query.mode;
    if (visibleItems.length > 0 && mode !== 'cascade' && mode !== 'move_to_root') {
      return res.status(409).json({ error: 'Esta pasta tem itens — escolha excluir os itens ou movê-los para a raiz.', itemCount: visibleItems.length, requiresMode: true });
    }
    if (mode === 'cascade' && visibleItems.length) {
      for (const it of visibleItems) {
        await query('delete from annotation_items where id = $1', [it.id]);
        if (it.visibility === 'shared') await logAudit(req, 'item.delete', 'item', it.id, it.name, { reason: 'pasta excluída' });
      }
    } else if (visibleItems.length) {
      await query('update annotation_items set folder_id = null where id = any($1::uuid[])', [visibleItems.map((i) => i.id)]);
    }
    if (hiddenItems.length) {
      await query('update annotation_items set folder_id = null where id = any($1::uuid[])', [hiddenItems.map((i) => i.id)]);
    }
    await query('delete from annotation_folders where id = $1', [folder.id]);
    if (folder.visibility === 'shared') await logAudit(req, 'folder.delete', 'folder', folder.id, folder.name, { mode: mode || null });
    res.json({ ok: true });
  }));

  // ─────────────────────────── Itens ───────────────────────────
  router.post('/items', ah(async (req, res) => {
    const { name, type, visibility, folderId, template } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
    if (type !== 'notes' && type !== 'table') return res.status(400).json({ error: 'Tipo inválido (notes ou table).' });
    let vis = visibility === 'shared' ? 'shared' : 'personal';
    let folder = null;
    if (folderId) {
      const { rows: fr } = await query('select * from annotation_folders where id = $1', [folderId]);
      folder = fr[0];
      if (!folder) return res.status(400).json({ error: 'Pasta inválida.' });
      if (!canAccess(folder, req.profile)) return res.status(403).json({ error: 'Sem acesso a esta pasta.' });
      vis = folder.visibility; // item nasce herdando a visibilidade da pasta em que é criado
    }
    const { rows: ordRows } = await query(
      'select coalesce(max(ordem), -1) + 1 as next from annotation_items where folder_id is not distinct from $1',
      [folderId || null],
    );
    const { rows } = await query(
      `insert into annotation_items (folder_id, name, type, visibility, ordem, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
      [folderId || null, String(name).trim(), type, vis, ordRows[0].next, req.profile.id],
    );
    const item = rows[0];
    // Template só entra se o usuário pediu explicitamente nesta chamada de
    // criação — nunca é aplicado por padrão (pedido explícito do usuário).
    if (type === 'table' && template && TABLE_TEMPLATES[template]) {
      const cols = TABLE_TEMPLATES[template];
      for (let i = 0; i < cols.length; i++) {
        await query('insert into annotation_table_columns (item_id, name, type, ordem) values ($1,$2,$3,$4)', [item.id, cols[i].name, cols[i].type, i]);
      }
    }
    res.json(mapItem({ ...item, created_by_name: req.profile.fullName }));
  }));

  router.patch('/items/:id', ah(async (req, res) => {
    const item = await getItemOr404(req, res);
    if (!item) return;
    if (!canAccess(item, req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
    const sets = ['updated_by = $1', 'updated_at = now()'];
    const vals = [req.profile.id];
    if ('name' in req.body) { vals.push(String(req.body.name).trim()); sets.push(`name = $${vals.length}`); }
    if ('ordem' in req.body) { vals.push(Number(req.body.ordem) || 0); sets.push(`ordem = $${vals.length}`); }
    if ('folderId' in req.body) {
      const folderId = req.body.folderId || null;
      let nextVisibility = item.visibility;
      if (folderId) {
        const { rows: fr } = await query('select * from annotation_folders where id = $1', [folderId]);
        if (!fr[0]) return res.status(400).json({ error: 'Pasta inválida.' });
        if (!canAccess(fr[0], req.profile)) return res.status(403).json({ error: 'Sem acesso a esta pasta.' });
        // Mover item pra dentro de uma pasta sempre faz o item herdar a
        // visibilidade dela — pedido explícito (aviso fica a cargo do
        // frontend, que confirma com o usuário ANTES de chamar esta rota).
        nextVisibility = fr[0].visibility;
      } else if ('visibility' in req.body) {
        nextVisibility = req.body.visibility === 'shared' ? 'shared' : 'personal';
      }
      vals.push(folderId); sets.push(`folder_id = $${vals.length}`);
      vals.push(nextVisibility); sets.push(`visibility = $${vals.length}`);
    } else if ('visibility' in req.body) {
      vals.push(req.body.visibility === 'shared' ? 'shared' : 'personal');
      sets.push(`visibility = $${vals.length}`);
    }
    vals.push(item.id);
    const { rows } = await query(`update annotation_items set ${sets.join(', ')} where id = $${vals.length} returning *`, vals);
    res.json(mapItem({ ...rows[0], created_by_name: item.created_by_name, updated_by_name: req.profile.fullName }));
  }));

  router.delete('/items/:id', ah(async (req, res) => {
    const item = await getItemOr404(req, res);
    if (!item) return;
    if (!canAccess(item, req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
    await query('delete from annotation_items where id = $1', [item.id]);
    if (item.visibility === 'shared') await logAudit(req, 'item.delete', 'item', item.id, item.name);
    res.json({ ok: true });
  }));

  // ────────────────────── Modo Bloco de Notas ──────────────────────
  router.get('/items/:id/notes', ah(async (req, res) => {
    const item = await getItemOr404(req, res);
    if (!item) return;
    if (!canAccess(item, req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
    const { rows } = await query(
      `select n.*, u.full_name as updated_by_name from annotation_notes n
       left join auth_users u on u.id = n.updated_by
       where n.item_id = $1 order by n.ordem, n.created_at`,
      [item.id],
    );
    res.json(rows.map(mapNote));
  }));

  router.post('/items/:id/notes', ah(async (req, res) => {
    const item = await getItemOr404(req, res);
    if (!item) return;
    if (!canAccess(item, req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
    const { size, color } = req.body || {};
    const { rows: ordRows } = await query('select coalesce(max(ordem), -1) + 1 as next from annotation_notes where item_id = $1', [item.id]);
    const { rows } = await query(
      `insert into annotation_notes (item_id, content, size, color, ordem, created_by, updated_by)
       values ($1,'', $2,$3,$4,$5,$5) returning *`,
      [item.id, size === 'large' ? 'large' : 'small', color || '#4A8EFF', ordRows[0].next, req.profile.id],
    );
    res.json(mapNote({ ...rows[0], updated_by_name: req.profile.fullName }));
  }));

  async function getNoteAndItemOr404(req, res) {
    const { rows } = await query('select * from annotation_notes where id = $1', [req.params.id]);
    if (!rows[0]) { res.status(404).json({ error: 'Balão não encontrado.' }); return null; }
    const item = await (async () => {
      const { rows: ir } = await query(`${ITEM_SELECT} where i.id = $1`, [rows[0].item_id]);
      return ir[0];
    })();
    if (!item || !canAccess(item, req.profile)) { res.status(403).json({ error: 'Acesso restrito.' }); return null; }
    return rows[0];
  }

  // Autosave — o frontend faz debounce, esta rota só grava o estado final.
  router.patch('/notes/:id', ah(async (req, res) => {
    const note = await getNoteAndItemOr404(req, res);
    if (!note) return;
    const sets = ['updated_by = $1', 'updated_at = now()'];
    const vals = [req.profile.id];
    if ('content' in req.body) { vals.push(String(req.body.content)); sets.push(`content = $${vals.length}`); }
    if ('size' in req.body) { vals.push(req.body.size === 'large' ? 'large' : 'small'); sets.push(`size = $${vals.length}`); }
    if ('color' in req.body) { vals.push(String(req.body.color)); sets.push(`color = $${vals.length}`); }
    if ('ordem' in req.body) { vals.push(Number(req.body.ordem) || 0); sets.push(`ordem = $${vals.length}`); }
    vals.push(note.id);
    const { rows } = await query(`update annotation_notes set ${sets.join(', ')} where id = $${vals.length} returning *`, vals);
    res.json(mapNote({ ...rows[0], updated_by_name: req.profile.fullName }));
  }));

  router.delete('/notes/:id', ah(async (req, res) => {
    const note = await getNoteAndItemOr404(req, res);
    if (!note) return;
    await query('delete from annotation_notes where id = $1', [note.id]);
    res.json({ ok: true });
  }));

  // ───────────────────────── Modo Tabela ─────────────────────────
  router.get('/items/:id/table', ah(async (req, res) => {
    const item = await getItemOr404(req, res);
    if (!item) return;
    if (!canAccess(item, req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
    const { rows: columns } = await query('select * from annotation_table_columns where item_id = $1 order by ordem', [item.id]);
    const { rows: dataRows } = await query(
      `select r.*, u.full_name as updated_by_name from annotation_table_rows r
       left join auth_users u on u.id = r.updated_by
       where r.item_id = $1 order by r.ordem, r.created_at`,
      [item.id],
    );
    res.json({ columns: columns.map(mapColumn), rows: dataRows.map(mapRow) });
  }));

  router.post('/items/:id/table/columns', ah(async (req, res) => {
    const item = await getItemOr404(req, res);
    if (!item) return;
    if (!canAccess(item, req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
    const { name, type } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nome da coluna é obrigatório.' });
    if (!['text', 'number', 'currency', 'link', 'email'].includes(type)) return res.status(400).json({ error: 'Tipo de coluna inválido.' });
    const { rows: ordRows } = await query('select coalesce(max(ordem), -1) + 1 as next from annotation_table_columns where item_id = $1', [item.id]);
    const { rows } = await query(
      'insert into annotation_table_columns (item_id, name, type, ordem) values ($1,$2,$3,$4) returning *',
      [item.id, String(name).trim(), type, ordRows[0].next],
    );
    res.json(mapColumn(rows[0]));
  }));

  async function getColumnAndItemOr404(req, res) {
    const { rows } = await query('select * from annotation_table_columns where id = $1', [req.params.id]);
    if (!rows[0]) { res.status(404).json({ error: 'Coluna não encontrada.' }); return null; }
    const { rows: ir } = await query(`${ITEM_SELECT} where i.id = $1`, [rows[0].item_id]);
    if (!ir[0] || !canAccess(ir[0], req.profile)) { res.status(403).json({ error: 'Acesso restrito.' }); return null; }
    return rows[0];
  }

  router.patch('/table/columns/:id', ah(async (req, res) => {
    const col = await getColumnAndItemOr404(req, res);
    if (!col) return;
    const sets = []; const vals = [];
    if ('name' in req.body) { vals.push(String(req.body.name).trim()); sets.push(`name = $${vals.length}`); }
    if ('type' in req.body) {
      if (!['text', 'number', 'currency', 'link', 'email'].includes(req.body.type)) return res.status(400).json({ error: 'Tipo de coluna inválido.' });
      vals.push(req.body.type); sets.push(`type = $${vals.length}`);
    }
    if ('ordem' in req.body) { vals.push(Number(req.body.ordem) || 0); sets.push(`ordem = $${vals.length}`); }
    if (!sets.length) return res.json(mapColumn(col));
    vals.push(col.id);
    const { rows } = await query(`update annotation_table_columns set ${sets.join(', ')} where id = $${vals.length} returning *`, vals);
    res.json(mapColumn(rows[0]));
  }));

  router.delete('/table/columns/:id', ah(async (req, res) => {
    const col = await getColumnAndItemOr404(req, res);
    if (!col) return;
    await query('delete from annotation_table_columns where id = $1', [col.id]);
    // As linhas mantêm a chave órfã dentro do JSONB (custo zero, ignorado
    // pelo frontend, que só renderiza colunas que ainda existem) — evita
    // varrer e reescrever toda annotation_table_rows.data a cada remoção.
    res.json({ ok: true });
  }));

  router.post('/items/:id/table/rows', ah(async (req, res) => {
    const item = await getItemOr404(req, res);
    if (!item) return;
    if (!canAccess(item, req.profile)) return res.status(403).json({ error: 'Acesso restrito.' });
    const { rows: ordRows } = await query('select coalesce(max(ordem), -1) + 1 as next from annotation_table_rows where item_id = $1', [item.id]);
    const { rows } = await query(
      'insert into annotation_table_rows (item_id, data, ordem, updated_by) values ($1, $2, $3, $4) returning *',
      [item.id, JSON.stringify(req.body?.data || {}), ordRows[0].next, req.profile.id],
    );
    res.json(mapRow({ ...rows[0], updated_by_name: req.profile.fullName }));
  }));

  async function getRowAndItemOr404(req, res) {
    const { rows } = await query('select * from annotation_table_rows where id = $1', [req.params.id]);
    if (!rows[0]) { res.status(404).json({ error: 'Linha não encontrada.' }); return null; }
    const { rows: ir } = await query(`${ITEM_SELECT} where i.id = $1`, [rows[0].item_id]);
    if (!ir[0] || !canAccess(ir[0], req.profile)) { res.status(403).json({ error: 'Acesso restrito.' }); return null; }
    return rows[0];
  }

  // Edição de célula — last-write-wins: aceita um merge parcial de `data`
  // (só as chaves alteradas) e sobrescreve, atualizando updated_at/updated_by.
  // Suficiente pro escopo (sem CRDT); em tabela compartilhada, quem salvar
  // por último em cada CÉLULA vence, sem perder as outras colunas da linha.
  router.patch('/table/rows/:id', ah(async (req, res) => {
    const row = await getRowAndItemOr404(req, res);
    if (!row) return;
    const sets = ['updated_by = $1', 'updated_at = now()'];
    const vals = [req.profile.id];
    if ('data' in req.body) {
      vals.push(JSON.stringify(req.body.data));
      sets.push(`data = data || $${vals.length}::jsonb`);
    }
    if ('ordem' in req.body) { vals.push(Number(req.body.ordem) || 0); sets.push(`ordem = $${vals.length}`); }
    vals.push(row.id);
    const { rows } = await query(`update annotation_table_rows set ${sets.join(', ')} where id = $${vals.length} returning *`, vals);
    res.json(mapRow({ ...rows[0], updated_by_name: req.profile.fullName }));
  }));

  router.delete('/table/rows/:id', ah(async (req, res) => {
    const row = await getRowAndItemOr404(req, res);
    if (!row) return;
    await query('delete from annotation_table_rows where id = $1', [row.id]);
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { createRouter, TABLE_TEMPLATES };
