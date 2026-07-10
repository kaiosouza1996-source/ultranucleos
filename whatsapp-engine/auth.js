/**
 * Autenticação própria — substitui Supabase Auth por completo.
 *
 *  - Senha: argon2id (resistência superior a bcrypt contra cracking por GPU).
 *  - Sessão: token opaco aleatório em cookie httpOnly+secure+SameSite=Lax;
 *    o banco guarda só o hash SHA-256 do token (nunca o valor cru) — permite
 *    revogar sessão instantaneamente (troca de senha, remoção de acesso).
 *  - MFA: TOTP (otplib), obrigatório na prática para Sócio (enforcement real
 *    é: quem tem factor verificado precisa completar o desafio; o secret
 *    fica criptografado em repouso com o mesmo AES-256-GCM de crypto.js).
 *  - Rate limit + bloqueio progressivo por conta (além do rate limit por IP
 *    já existente em server.js via express-rate-limit).
 *  - Recuperação de senha: token de uso único cripto-aleatório, expira em
 *    30min, enviado por SMTP próprio (mailer.js) — nunca reutilizável.
 *  - CSRF: double-submit cookie (ver authz.js:checkCsrf). Login/forgot/reset
 *    de senha ficam isentos de propósito — não há sessão prévia "andando de
 *    carona" nesses casos (ver comentário em authz.js:checkCsrf).
 */
const crypto = require('crypto');
const express = require('express');
const argon2 = require('argon2');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { query, PG_CONFIGURED } = require('./pg');
const { encrypt, decrypt } = require('./crypto');
const { sendPasswordResetEmail, SMTP_CONFIGURED } = require('./mailer');
const { requireSession, requireRole, checkCsrf } = require('./authz');
const { closeUserConnections } = require('./realtime');

const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);
const SESSION_COOKIE_NAME = 'sid';
const CSRF_COOKIE_NAME = 'csrf';
const SESSION_COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE !== 'false';
const APP_BASE_URL = process.env.APP_BASE_URL || '';
const LOGIN_FAIL_THRESHOLD = Number(process.env.LOGIN_RATE_LIMIT_MAX || 5);
const LOGIN_LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES || 15);
const PASSWORD_RESET_TTL_MIN = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MIN || 30);
const MFA_ISSUER = 'Ultra Nucleos';

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function cookieOpts(extra = {}) {
  return { httpOnly: true, secure: SESSION_COOKIE_SECURE, sameSite: 'lax', path: '/', ...extra };
}

function toProfile(row) {
  return { id: row.id, fullName: row.full_name, role: row.role };
}

async function createSession(userId, aal) {
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  await query(
    `insert into auth_sessions (token_hash, user_id, expires_at, aal) values ($1,$2,$3,$4)`,
    [tokenHash, userId, expiresAt, aal],
  );
  return { token, tokenHash, expiresAt };
}

function setSessionCookies(res, token) {
  const csrfToken = randomToken(16);
  const maxAge = SESSION_TTL_HOURS * 3600 * 1000;
  res.cookie(SESSION_COOKIE_NAME, token, cookieOpts({ maxAge }));
  res.cookie(CSRF_COOKIE_NAME, csrfToken, cookieOpts({ httpOnly: false, maxAge }));
}

function clearSessionCookies(res) {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOpts());
  res.clearCookie(CSRF_COOKIE_NAME, cookieOpts({ httpOnly: false }));
}

/** Resolve {profile, session} a partir de um token de sessão cru — usado
 * tanto pelo middleware HTTP quanto pela autenticação da conexão WebSocket
 * (que não passa pelo pipeline de cookie-parser do Express). */
async function resolveSessionFromToken(token) {
  if (!token) return null;
  const tokenHash = sha256(token);
  const { rows } = await query(
    `select s.aal, s.expires_at, s.revoked_at, u.id, u.full_name, u.role
     from auth_sessions s join auth_users u on u.id = s.user_id
     where s.token_hash = $1 and u.is_active = true`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) return null;
  return {
    session: { tokenHash, aal: row.aal },
    profile: { id: row.id, fullName: row.full_name, role: row.role },
  };
}

/** Parser mínimo de cookies para o handshake do WebSocket (não passa pelo
 * cookie-parser do Express, que só roda no ciclo request/response HTTP). */
function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

async function resolveSessionFromCookieHeader(cookieHeader) {
  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  try {
    return await resolveSessionFromToken(token);
  } catch (e) {
    console.error('[auth] resolveSessionFromCookieHeader:', e.message);
    return null;
  }
}

/** Populado globalmente em server.js antes de qualquer rota — nunca bloqueia
 * por si só (cada rota decide via requireSession/requireRole). */
async function sessionMiddleware(req, res, next) {
  try {
    const token = req.cookies && req.cookies[SESSION_COOKIE_NAME];
    if (!token) return next();
    const resolved = await resolveSessionFromToken(token);
    if (!resolved) return next();
    req.session = resolved.session;
    req.profile = resolved.profile;
    next();
  } catch (e) {
    console.error('[auth] sessionMiddleware:', e.message);
    next();
  }
}

// ─────────────────────── bloqueio progressivo por conta ───────────────────────
async function checkLockout(email) {
  const { rows } = await query('select failed_count, locked_until from auth_lockouts where email = $1', [email]);
  const row = rows[0];
  if (row && row.locked_until && new Date(row.locked_until) > new Date()) return true;
  return false;
}

async function recordLoginAttempt(email, ip, success) {
  await query('insert into auth_login_attempts (email, ip, success) values ($1,$2,$3)', [email, ip, success]);
  if (success) {
    await query('delete from auth_lockouts where email = $1', [email]);
    return;
  }
  const { rows } = await query(
    `insert into auth_lockouts (email, failed_count)
     values ($1, 1)
     on conflict (email) do update set failed_count = auth_lockouts.failed_count + 1
     returning failed_count`,
    [email],
  );
  const failedCount = rows[0].failed_count;
  if (failedCount >= LOGIN_FAIL_THRESHOLD) {
    const overBy = failedCount - LOGIN_FAIL_THRESHOLD;
    const minutes = LOGIN_LOCKOUT_MINUTES * Math.pow(2, Math.min(overBy, 5));
    const until = new Date(Date.now() + minutes * 60000);
    await query('update auth_lockouts set locked_until = $2 where email = $1', [email, until]);
  }
}

const router = express.Router();

// Sem banco configurado, nenhuma rota de auth funciona — 503 explícito em vez
// de deixar cada query estourar um erro genérico (ou, pior, um handler sem
// try/catch travar a requisição pra sempre — ver nota do wrapper ah() abaixo).
router.use((req, res, next) => {
  if (!PG_CONFIGURED) return res.status(503).json({ error: 'Autenticação ainda não configurada neste servidor.' });
  next();
});

// Toda rota async precisa disso: sem ele, uma Promise rejeitada dentro de um
// handler do Express 4 nunca chega a next()/catch nenhum — a resposta HTTP
// simplesmente nunca é enviada e o cliente fica pendurado até o timeout.
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.post('/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  const ip = req.ip;

  if (await checkLockout(normalizedEmail)) {
    return res.status(429).json({ error: 'Muitas tentativas de login. Tente novamente mais tarde.' });
  }

  const { rows } = await query('select * from auth_users where email = $1 and is_active = true', [normalizedEmail]);
  const user = rows[0];
  const genericError = () => res.status(401).json({ error: 'E-mail ou senha inválidos.' });

  if (!user) {
    await recordLoginAttempt(normalizedEmail, ip, false);
    return genericError();
  }
  const passwordOk = await argon2.verify(user.password_hash, password).catch(() => false);
  if (!passwordOk) {
    await recordLoginAttempt(normalizedEmail, ip, false);
    return genericError();
  }
  await recordLoginAttempt(normalizedEmail, ip, true);

  const { rows: mfaRows } = await query('select status from auth_mfa_totp where user_id = $1', [user.id]);
  const mfaVerified = mfaRows[0] && mfaRows[0].status === 'verified';

  const { token } = await createSession(user.id, mfaVerified ? 'aal1' : 'aal2');
  setSessionCookies(res, token);

  if (mfaVerified) return res.json({ mfaRequired: true });
  return res.json({ mfaRequired: false, profile: toProfile(user) });
}));

router.post('/mfa/challenge-verify', ah(async (req, res) => {
  if (!req.profile || !req.session) return res.status(401).json({ error: 'Sessão inválida.' });
  if (!checkCsrf(req, res)) return;
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Código obrigatório.' });

  const { rows } = await query(
    "select secret_enc from auth_mfa_totp where user_id = $1 and status = 'verified'",
    [req.profile.id],
  );
  const row = rows[0];
  if (!row) return res.status(400).json({ error: 'MFA não configurado para este usuário.' });
  const secret = decrypt(row.secret_enc);
  const valid = secret && authenticator.check(String(code).trim(), secret);
  if (!valid) return res.status(401).json({ error: 'Código inválido ou expirado.' });

  await query("update auth_sessions set aal = 'aal2' where token_hash = $1", [req.session.tokenHash]);
  const { rows: userRows } = await query('select * from auth_users where id = $1', [req.profile.id]);
  res.json({ profile: toProfile(userRows[0]) });
}));

router.post('/logout', ah(async (req, res) => {
  if (req.session && !checkCsrf(req, res)) return;
  if (req.session) {
    await query('update auth_sessions set revoked_at = now() where token_hash = $1', [req.session.tokenHash]);
    closeUserConnections(req.profile.id);
  }
  clearSessionCookies(res);
  res.json({});
}));

router.get('/session', requireSession, ah(async (req, res) => {
  res.json({ profile: req.profile });
}));

// ─────────────────────────── MFA enroll ───────────────────────────
// aal1 só é suficiente para o PRIMEIRO enroll (o usuário ainda não tem fator
// nenhum, então não tem como já estar em aal2 — bootstrapping). Se já existe
// um fator VERIFICADO, exige aal2: caso contrário, uma sessão aal1 roubada
// durante a janela entre login e desafio de MFA poderia sobrescrever
// silenciosamente o segredo TOTP de outra pessoa (on conflict do update).
router.post('/mfa/enroll', ah(async (req, res) => {
  if (!req.profile) return res.status(401).json({ error: 'Login necessário.' });
  if (!checkCsrf(req, res)) return;
  const { rows: existingRows } = await query("select status from auth_mfa_totp where user_id = $1", [req.profile.id]);
  const alreadyVerified = existingRows[0] && existingRows[0].status === 'verified';
  if (alreadyVerified && (!req.session || req.session.aal !== 'aal2')) {
    return res.status(403).json({ error: 'Esta ação exige verificação em duas etapas concluída nesta sessão.' });
  }
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(req.profile.id, MFA_ISSUER, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauth);
  await query(
    `insert into auth_mfa_totp (user_id, secret_enc, status)
     values ($1, $2, 'pending')
     on conflict (user_id) do update set secret_enc = excluded.secret_enc, status = 'pending', verified_at = null`,
    [req.profile.id, encrypt(secret)],
  );
  res.json({ qrCodeDataUrl, secret });
}));

router.post('/mfa/enroll/confirm', ah(async (req, res) => {
  if (!req.profile) return res.status(401).json({ error: 'Login necessário.' });
  if (!checkCsrf(req, res)) return;
  const { code } = req.body || {};
  const { rows } = await query('select secret_enc from auth_mfa_totp where user_id = $1', [req.profile.id]);
  const row = rows[0];
  if (!row) return res.status(400).json({ error: 'Nenhum enroll pendente.' });
  const secret = decrypt(row.secret_enc);
  const valid = secret && code && authenticator.check(String(code).trim(), secret);
  if (!valid) return res.status(400).json({ error: 'Código inválido.' });
  await query("update auth_mfa_totp set status = 'verified', verified_at = now() where user_id = $1", [req.profile.id]);
  // A sessão atual já provou posse do segundo fator agora mesmo — eleva para aal2.
  if (req.session) await query("update auth_sessions set aal = 'aal2' where token_hash = $1", [req.session.tokenHash]);
  res.json({});
}));

router.post('/mfa/unenroll', requireSession, ah(async (req, res) => {
  await query('delete from auth_mfa_totp where user_id = $1', [req.profile.id]);
  res.json({});
}));

router.get('/mfa/factors', ah(async (req, res) => {
  if (!req.profile) return res.status(401).json({ error: 'Login necessário.' });
  const { rows } = await query("select status from auth_mfa_totp where user_id = $1 and status = 'verified'", [req.profile.id]);
  res.json({ verified: rows.length > 0 });
}));

// ─────────────────── troca de senha (usuário logado) ───────────────────
// Diferente de /reset-password (token por e-mail, sem sessão prévia): aqui o
// usuário já está autenticado e só precisa provar que conhece a senha ATUAL
// antes de trocar — fluxo de "defina sua própria senha" pedido explicitamente
// para os usuários criados manualmente com senha aleatória de onboarding.
router.post('/change-password', requireSession, ah(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Senha atual e nova senha (mínimo 8 caracteres) são obrigatórias.' });
  }
  const { rows } = await query('select password_hash from auth_users where id = $1', [req.profile.id]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const ok = await argon2.verify(user.password_hash, String(currentPassword)).catch(() => false);
  if (!ok) return res.status(401).json({ error: 'Senha atual incorreta.' });
  const passwordHash = await argon2.hash(String(newPassword), { type: argon2.argon2id });
  await query('update auth_users set password_hash = $2, updated_at = now() where id = $1', [req.profile.id, passwordHash]);
  // Revoga toda OUTRA sessão ativa (outros dispositivos/abas) — mantém a
  // sessão atual viva, já que quem está trocando acabou de provar identidade
  // com a senha atual + sessão aal2 válida, sem precisar logar de novo.
  await query('update auth_sessions set revoked_at = now() where user_id = $1 and revoked_at is null and token_hash <> $2', [req.profile.id, req.session.tokenHash]);
  res.json({});
}));

// ─────────────────────────── recuperação de senha ───────────────────────────
router.post('/forgot-password', ah(async (req, res) => {
  const { email } = req.body || {};
  // Resposta sempre 200/genérica — nunca revela se o e-mail existe (evita
  // enumeração de contas válidas).
  if (email) {
    const normalizedEmail = String(email).trim().toLowerCase();
    const { rows } = await query('select id from auth_users where email = $1 and is_active = true', [normalizedEmail]);
    const user = rows[0];
    if (user && SMTP_CONFIGURED) {
      const token = randomToken(32);
      const tokenHash = sha256(token);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MIN * 60000);
      await query('insert into auth_password_resets (token_hash, user_id, expires_at) values ($1,$2,$3)', [tokenHash, user.id, expiresAt]);
      const link = `${APP_BASE_URL}/reset-password?token=${token}`;
      sendPasswordResetEmail(normalizedEmail, link).catch((e) => console.error('[auth] falha ao enviar e-mail de reset:', e.message));
    }
  }
  res.json({});
}));

router.post('/reset-password', ah(async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Token e nova senha (mínimo 8 caracteres) são obrigatórios.' });
  }
  const tokenHash = sha256(String(token));
  const { rows } = await query('select * from auth_password_resets where token_hash = $1', [tokenHash]);
  const row = rows[0];
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Link de redefinição inválido ou expirado.' });
  }
  const passwordHash = await argon2.hash(String(newPassword), { type: argon2.argon2id });
  await query('update auth_users set password_hash = $2, updated_at = now() where id = $1', [row.user_id, passwordHash]);
  await query('update auth_password_resets set used_at = now() where token_hash = $1', [tokenHash]);
  // Trocar a senha revoga TODAS as sessões ativas — força novo login em todo lugar.
  await query('update auth_sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [row.user_id]);
  closeUserConnections(row.user_id);
  res.json({});
}));

// ─────────────────────────── administração (Sócio) ───────────────────────────
router.post('/admin/create-user', requireRole('socio'), ah(async (req, res) => {
  const { email, fullName, role } = req.body || {};
  if (!email || !fullName || !['socio', 'comercial', 'operacional'].includes(role)) {
    return res.status(400).json({ error: 'email, fullName e role (socio|comercial|operacional) são obrigatórios.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  // Senha inicial é um valor aleatório descartável — nunca comunicado; o
  // usuário sempre define a senha real pelo fluxo de "esqueci minha senha".
  const throwawayHash = await argon2.hash(randomToken(32), { type: argon2.argon2id });
  const { rows } = await query(
    `insert into auth_users (email, password_hash, full_name, role) values ($1,$2,$3,$4)
     on conflict (email) do nothing
     returning id`,
    [normalizedEmail, throwawayHash, fullName, role],
  );
  if (!rows[0]) return res.status(409).json({ error: 'Já existe um usuário com este e-mail.' });
  const userId = rows[0].id;

  const token = randomToken(32);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MIN * 60000);
  await query('insert into auth_password_resets (token_hash, user_id, expires_at) values ($1,$2,$3)', [tokenHash, userId, expiresAt]);
  const tempResetLink = `${APP_BASE_URL}/reset-password?token=${token}`;
  if (SMTP_CONFIGURED) {
    sendPasswordResetEmail(normalizedEmail, tempResetLink).catch((e) => console.error('[auth] falha ao enviar e-mail de criação de conta:', e.message));
    // Com SMTP configurado, o link chega por e-mail — não devolve o token de
    // posse direta na resposta HTTP (reduz a superfície de exposição: histórico
    // do navegador, proxies, ferramentas de log que capturam corpo de resposta).
    return res.json({ userId });
  }
  res.json({ userId, tempResetLink });
}));

// Erros lançados por qualquer rota acima caem aqui — nunca um handler
// pendurado esperando uma resposta que nunca chega.
router.use((err, req, res, next) => {
  console.error('[auth] erro:', err.message);
  res.status(400).json({ error: err.message || 'Erro ao processar requisição.' });
});

module.exports = { router, sessionMiddleware, resolveSessionFromCookieHeader, SESSION_COOKIE_NAME, CSRF_COOKIE_NAME };
