/**
 * SMTP próprio (nunca serviço terceiro) — usado para recuperação de senha.
 * Credenciais sempre via variável de ambiente (nunca hardcoded).
 */
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

const SMTP_CONFIGURED = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

// Só para desenvolvimento local: alguns antivírus/firewalls corporativos fazem
// inspeção de TLS (SSL inspection) e substituem o certificado do servidor SMTP
// por um autoassinado próprio, que o Node rejeita por padrão (corretamente).
// NUNCA usar em produção — lá a rede é a da própria VPS, sem esse tipo de
// interceptação, e a validação de certificado deve continuar rígida.
const SMTP_ALLOW_SELF_SIGNED = process.env.SMTP_ALLOW_SELF_SIGNED === 'true';

let transporter = null;
if (SMTP_CONFIGURED) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: SMTP_ALLOW_SELF_SIGNED ? { rejectUnauthorized: false } : undefined,
  });
} else {
  console.warn('[BOOT] SMTP_HOST/SMTP_USER/SMTP_PASS não configuradas — recuperação de senha por e-mail ficará indisponível.');
}

async function sendPasswordResetEmail(to, resetLink) {
  if (!transporter) throw new Error('SMTP não configurado.');
  await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: 'Redefinição de senha — Ultra Nucleos',
    text: `Você solicitou a redefinição de senha. Acesse o link abaixo (válido por tempo limitado):\n\n${resetLink}\n\nSe não foi você, ignore este e-mail.`,
    html: `<p>Você solicitou a redefinição de senha.</p><p><a href="${resetLink}">Clique aqui para definir uma nova senha</a> (link válido por tempo limitado).</p><p>Se não foi você, ignore este e-mail.</p>`,
  });
}

module.exports = { sendPasswordResetEmail, SMTP_CONFIGURED };
