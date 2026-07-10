/**
 * Anexos da Comunicação Interna — substitui o bucket privado do Supabase
 * Storage por disco local (DATA_DIR/comms-attachments/<channelId>/<arquivo>),
 * com download sempre autenticado (checa canAccessChannel antes de servir,
 * papel que o Signed URL do Supabase cumpria).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('./pg');
const { canAccessChannel } = require('./authz');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const ATTACH_DIR = path.join(DATA_DIR, 'comms-attachments');
fs.mkdirSync(ATTACH_DIR, { recursive: true });

function sanitizeName(name) {
  return String(name || 'arquivo').replace(/[^\w.\-]+/g, '_').slice(-120);
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    // A rota de upload é POST /comms/channels/:id/attachments (param se
    // chama "id", não "channelId") — só o download (GET
    // /comms/attachments/:channelId/:filename) usa "channelId". Esse
    // mismatch fazia TODO upload falhar com "channelId ausente", mascarado
    // até agora pelo bug de CSRF que barrava a requisição antes de chegar aqui.
    const channelId = path.basename(req.params.id || req.params.channelId || '');
    if (!channelId) return cb(new Error('channelId ausente'));
    const dir = path.join(ATTACH_DIR, channelId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const random = crypto.randomBytes(8).toString('hex');
    cb(null, `${random}-${sanitizeName(file.originalname)}`);
  },
});

const uploadCommsAttachment = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

/** GET /comms/attachments/:channelId/:filename — montada direto em server.js
 * (fora do router /comms), então precisa repetir a mesma exigência de sessão
 * completa (aal2) que router.use(requireSession) garante para todo o resto
 * de /comms/*; sem isso, essa rota ficaria inconsistente (menos restrita) em
 * relação a todas as outras do módulo. */
async function downloadAttachment(req, res) {
  const { channelId, filename } = req.params;
  if (!req.profile || !req.session || req.session.aal !== 'aal2') {
    return res.status(401).json({ error: 'Login necessário.' });
  }

  let allowed = false;
  try {
    allowed = await canAccessChannel(pool, req.profile, channelId);
  } catch {
    allowed = false;
  }
  if (!allowed) return res.status(403).json({ error: 'Acesso restrito.' });

  const channelDir = path.join(ATTACH_DIR, path.basename(channelId));
  const filePath = path.join(channelDir, path.basename(filename));
  if (filePath !== channelDir && !filePath.startsWith(channelDir + path.sep)) {
    return res.status(400).json({ error: 'Caminho inválido.' });
  }
  res.sendFile(filePath, (err) => {
    if (err) res.status(404).json({ error: 'Arquivo não encontrado.' });
  });
}

module.exports = { uploadCommsAttachment, downloadAttachment, ATTACH_DIR };
