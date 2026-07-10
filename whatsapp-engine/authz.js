/**
 * Autorização em app-layer (substitui RLS do Supabase) — decisão de
 * arquitetura registrada no plano de migração: sem PostgREST exposto a
 * cliente, o Express já é a única fronteira de confiança, e a lógica de
 * `can_access_channel` precisa existir em JS de qualquer forma para
 * autorizar o broadcast do WebSocket (LISTEN/NOTIFY não passa por RLS).
 *
 * Estas funções espelham 1:1 as funções SQL que existiam no Supabase
 * (current_role/is_socio/can_access_channel), só que recebendo o perfil já
 * resolvido pela sessão em vez de auth.uid().
 */

function isSocio(profile) {
  return !!profile && profile.role === 'socio';
}

/**
 * O driver `pg` só desserializa automaticamente arrays de tipos BUILTIN
 * (int[], text[] etc.) — arrays de tipo enum CUSTOMIZADO (nosso `user_role[]`,
 * usado em `channels.allowed_roles`) chegam como a representação textual crua
 * do Postgres (`"{socio,comercial}"`), não como array JS. Sem isso, todo
 * canal com visibility='role' fica inacessível (Array.isArray = false) e o
 * frontend quebra ao chamar `.map()` nesse campo.
 */
function parsePgArray(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  const str = String(value);
  if (str === '{}') return [];
  return str.slice(1, -1).split(',').filter(Boolean);
}

/** Variante que recebe a linha do canal já buscada (evita reconsultar
 * `channels` quando o chamador já tem a linha em mãos, ex.: listagem). */
async function canAccessChannelRow(pool, profile, channelRow) {
  if (!profile) return false;
  if (isSocio(profile)) return true;
  if (!channelRow) return false;
  if (channelRow.visibility === 'public') return true;
  if (channelRow.visibility === 'role') {
    const allowedRoles = parsePgArray(channelRow.allowed_roles);
    return Array.isArray(allowedRoles) && allowedRoles.includes(profile.role);
  }
  if (channelRow.visibility === 'private') {
    const { rows } = await pool.query(
      'select 1 from channel_members where channel_id = $1 and user_id = $2',
      [channelRow.id, profile.id],
    );
    return rows.length > 0;
  }
  return false;
}

/** Réplica de can_access_channel(_channel_id) do schema antigo. */
async function canAccessChannel(pool, profile, channelId) {
  if (!profile) return false;
  if (isSocio(profile)) return true;
  const { rows } = await pool.query('select id, visibility, allowed_roles from channels where id = $1', [channelId]);
  return canAccessChannelRow(pool, profile, rows[0]);
}

/**
 * Inverso de canAccessChannelRow — dado um canal, quem consegue vê-lo (usado
 * pelo fan-out de notificação MENSAGEM_INTERNA em comms.js). DM é caso
 * especial: só os `channel_members` reais, SEM incluir Sócio automaticamente
 * — Sócio consegue abrir qualquer DM por auditoria, mas não é participante
 * da conversa, então notificá-lo de toda DM alheia seria spam sem sentido.
 */
async function getChannelRecipients(pool, channelRow) {
  if (!channelRow) return [];
  if (channelRow.is_dm) {
    const { rows } = await pool.query('select user_id from channel_members where channel_id = $1', [channelRow.id]);
    return rows.map((r) => r.user_id);
  }
  const { rows: users } = await pool.query('select id, role from auth_users where is_active = true');
  if (channelRow.visibility === 'public') return users.map((u) => u.id);
  if (channelRow.visibility === 'role') {
    const allowedRoles = parsePgArray(channelRow.allowed_roles) || [];
    return users.filter((u) => u.role === 'socio' || allowedRoles.includes(u.role)).map((u) => u.id);
  }
  if (channelRow.visibility === 'private') {
    const { rows: members } = await pool.query('select user_id from channel_members where channel_id = $1', [channelRow.id]);
    const memberIds = new Set(members.map((m) => m.user_id));
    return users.filter((u) => u.role === 'socio' || memberIds.has(u.id)).map((u) => u.id);
  }
  return [];
}

/** CSRF — double-submit cookie. O cookie `csrf` (não-httpOnly, legível só por
 * JS do mesmo site) precisa ser ecoado pelo frontend no header x-csrf-token
 * em toda mutação autenticada; um atacante cross-site não consegue ler o
 * cookie da vítima para repetir o valor no header, mesmo que o navegador
 * anexe o cookie de sessão automaticamente. Só se aplica a rotas que já
 * exigem sessão — login/forgot-password/reset-password não passam por aqui
 * (não há sessão prévia pra "andar de carona", então CSRF clássico não se
 * aplica a elas). Dobrado dentro de requireSession/requireRole, não como
 * middleware solto, pra nunca esquecer de aplicar numa rota nova. */
const crypto = require('crypto');

function checkCsrf(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  const header = req.headers['x-csrf-token'];
  const cookie = req.cookies && req.cookies.csrf;
  // Comparação em tempo constante — string curta, mas não custa nada evitar
  // o timing side-channel de uma comparação `===` que aborta no 1º byte diferente.
  const safeEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  };
  if (!header || !cookie || !safeEqual(header, cookie)) {
    res.status(403).json({ error: 'Token CSRF inválido ou ausente.' });
    return false;
  }
  return true;
}

/**
 * Exige sessão "completa" (aal2) — populada por auth.js:sessionMiddleware.
 * Sessão fica em aal1 só durante a janela entre login e a confirmação do
 * código TOTP (ver POST /auth/mfa/challenge-verify); qualquer rota de recurso
 * normal exige aal2, senão uma sessão aal1 roubada/pendente já bastaria pra
 * acessar tudo, esvaziando o propósito do MFA. Usuários sem MFA configurado
 * já saem do login direto em aal2 (não há desafio pendente pra eles).
 */
function requireSession(req, res, next) {
  if (!req.profile || !req.session || req.session.aal !== 'aal2') {
    return res.status(401).json({ error: 'Login necessário.' });
  }
  if (!checkCsrf(req, res)) return;
  next();
}

/** Exige sessão completa (aal2) com papel dentre os informados. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.profile || !req.session || req.session.aal !== 'aal2') {
      return res.status(401).json({ error: 'Login necessário.' });
    }
    if (!roles.includes(req.profile.role)) return res.status(403).json({ error: 'Acesso restrito.' });
    if (!checkCsrf(req, res)) return;
    next();
  };
}

module.exports = { isSocio, canAccessChannel, canAccessChannelRow, getChannelRecipients, requireSession, requireRole, checkCsrf, parsePgArray };
