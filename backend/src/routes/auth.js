import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired, signToken } from '../middleware/auth.js';
import { users } from '../db/repos.js';
import { db } from '../db/index.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { publicUser } from '../lib/serialize.js';
import {
  createUpgradeLink,
  createLoginLink,
  consumeLoginLink,
} from '../services/magicLink.js';
import { sendEmail, welcomeEmail, loginLinkEmail } from '../services/email.js';
import { logger } from '../lib/logger.js';

const router = Router();

/** Waliduje body schematem zod; rzuca AppError 400 z listą pól. */
function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('Błąd walidacji danych', result.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    })));
  }
  return result.data;
}

// ====================================================================
// REJESTRACJA — z user_type (Consumer / Investor)
// ====================================================================

const registerSchema = z.object({
  email: z.string().email('Nieprawidłowy adres email'),
  password: z.string().min(8, 'Hasło musi mieć min. 8 znaków').max(200),
  user_type: z.enum(['consumer', 'investor']).optional().default('consumer'),
  home_city: z.string().min(2).max(60).optional(),
  search_radius_km: z.coerce.number().positive().max(50).optional().default(5),
});

router.post('/register', ah(async (req, res) => {
  const data = parseBody(registerSchema, req.body);

  const email = data.email.toLowerCase().trim();
  if (users.findByEmail(email)) throw conflict('Konto z tym adresem email już istnieje');

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = users.create({
    email,
    passwordHash,
    userType: data.user_type,
    homeCity: data.home_city ?? null,
    searchRadiusKm: data.search_radius_km,
  });

  audit({ userId: user.id, action: 'register', detail: { user_type: data.user_type }, ip: req.ip });
  sendEmail({ to: email, ...welcomeEmail(user) })
    .catch((err) => logger.error({ err: err.message }, 'Email powitalny nie wysłany'));

  res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
}));

// ====================================================================
// LOGOWANIE — email + hasło
// ====================================================================

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Hash-atrapa — utrzymuje stały czas odpowiedzi, gdy konto nie istnieje.
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789012345678901234567890';

router.post('/login', ah(async (req, res) => {
  const data = parseBody(loginSchema, req.body);
  const user = users.findByEmail(data.email.toLowerCase().trim());
  const ok = await bcrypt.compare(data.password, user?.password_hash ?? DUMMY_HASH);

  if (!user || !user.password_hash || !ok) {
    audit({ userId: user?.id ?? null, action: 'login_failed', ip: req.ip });
    throw unauthorized('Nieprawidłowy email lub hasło');
  }

  audit({ userId: user.id, action: 'login', ip: req.ip });
  res.json({ token: signToken(user.id), user: publicUser(user) });
}));

// ====================================================================
// LOGOWANIE MAGIC-LINK (passwordless) — request + consume
// ====================================================================

const requestLoginLinkSchema = z.object({ email: z.string().email() });

router.post('/login/magic', ah(async (req, res) => {
  const data = parseBody(requestLoginLinkSchema, req.body);
  const email = data.email.toLowerCase().trim();

  // Idempotent z zewnątrz: zawsze 200 OK, niezależnie czy konto istnieje
  // (anti-enumeration; nie ujawniamy które emaile są w bazie).
  const user = users.findByEmail(email);
  if (user) {
    const link = createLoginLink(user.id);
    audit({ userId: user.id, action: 'request_login_link', ip: req.ip });
    sendEmail({ to: email, ...loginLinkEmail(link.url) })
      .catch((err) => logger.error({ err: err.message }, 'Login link email nie wysłany'));
  } else {
    audit({ userId: null, action: 'request_login_link_no_account', detail: { email }, ip: req.ip });
  }

  res.json({ ok: true, message: 'Jeśli konto istnieje, link logowania został wysłany na email.' });
}));

const consumeLoginLinkSchema = z.object({ token: z.string().min(1) });

router.post('/login/magic/consume', ah(async (req, res) => {
  const data = parseBody(consumeLoginLinkSchema, req.body);
  const userId = consumeLoginLink(data.token);
  if (!userId) throw unauthorized('Link logowania jest nieprawidłowy, użyty lub wygasł');

  const user = users.findById(userId);
  if (!user) throw notFound('Konto nie istnieje');

  audit({ userId: user.id, action: 'login_magic', ip: req.ip });
  res.json({ token: signToken(user.id), user: publicUser(user) });
}));

// ====================================================================
// PROFIL — /me (CRUD)
// ====================================================================

router.get('/me', authRequired, ah(async (req, res) => {
  audit({ userId: req.user.id, action: 'view_profile', ip: req.ip });
  res.json({ user: publicUser(req.user) });
}));

const updateProfileSchema = z.object({
  user_type: z.enum(['consumer', 'investor']).optional(),
  home_city: z.string().min(2).max(60).optional(),
  search_radius_km: z.coerce.number().positive().max(50).optional(),
});

router.patch('/me', authRequired, ah(async (req, res) => {
  const data = parseBody(updateProfileSchema, req.body);
  const updated = users.updateProfile(req.user.id, {
    userType: data.user_type,
    homeCity: data.home_city,
    searchRadiusKm: data.search_radius_km,
  });
  audit({ userId: req.user.id, action: 'update_profile', detail: data, ip: req.ip });
  res.json({ user: publicUser(updated) });
}));

const notifPrefsSchema = z.object({
  notif_email: z.boolean().optional(),
  notif_push: z.boolean().optional(),
});

router.put('/me/notif-prefs', authRequired, ah(async (req, res) => {
  const data = parseBody(notifPrefsSchema, req.body);
  const updated = users.updateNotifPrefs(req.user.id, {
    notifEmail: data.notif_email ?? Boolean(req.user.notif_email),
    notifPush: data.notif_push ?? Boolean(req.user.notif_push),
  });
  audit({ userId: req.user.id, action: 'update_notif_prefs', ip: req.ip });
  res.json({ user: publicUser(updated) });
}));

const pushTokenSchema = z.object({
  push_token: z.string().min(1).max(300),
  platform: z.enum(['ios', 'android']),
});

router.put('/me/push-token', authRequired, ah(async (req, res) => {
  const data = parseBody(pushTokenSchema, req.body);
  users.updatePushToken(req.user.id, data.push_token, data.platform);
  res.json({ ok: true });
}));

// ====================================================================
// GDPR — RODO art. 17 right-to-be-forgotten
// ====================================================================

const deleteAccountSchema = z.object({
  confirm: z.literal('USUN-MOJE-KONTO'),
  reason: z.string().max(500).optional(),
});

router.delete('/me', authRequired, ah(async (req, res) => {
  // Wymaga jawnego potwierdzenia by uniknąć przypadkowego DELETE bez body.
  const data = parseBody(deleteAccountSchema, req.body);

  // Audit PRZED delete (cascade kasuje audit_logs.user_id po DELETE — zachowujemy entry).
  audit({
    userId: req.user.id,
    action: 'gdpr_account_deleted',
    detail: {
      email_hash: req.user.email ? req.user.email.slice(0, 3) + '***@' + req.user.email.split('@')[1] : null,
      user_type: req.user.user_type,
      premium_tier: req.user.premium_tier,
      reason: data.reason ?? null,
    },
    ip: req.ip,
  });

  // GDPR cascade behavior:
  //   - searches/matches/magic_links/feedback → ON DELETE CASCADE (schema)
  //   - support_tickets.user_id → ON DELETE SET NULL (zachowuje ticket jako anonymous)
  //   - audit_logs.user_id → NIE ma FK constraint (schema gap), więc manualnie SET NULL
  //     by zachować audit_log dla compliance ale anonymizować
  //   - investor_analysis / ai_usage NIE są user-scoped — zachowane
  db.prepare('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?').run(req.user.id);
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);

  if (result.changes === 0) {
    // Race condition: user już usunięty w innej sesji.
    throw notFound('Konto już nie istnieje');
  }

  res.json({
    ok: true,
    message: 'Twoje konto zostało usunięte. Dane osobowe zostały kasowane zgodnie z RODO art. 17.',
    deleted_at: new Date().toISOString(),
  });
}));

// ====================================================================
// MAGIC LINK DO CHECKOUTU — dual plan
// ====================================================================

const upgradeLinkSchema = z.object({
  plan: z.enum(['standard', 'investor']),
});

router.post('/upgrade-link', authRequired, ah(async (req, res) => {
  const data = parseBody(upgradeLinkSchema, req.body);

  // Nie pozwól na duplikat tej samej subskrypcji.
  if (req.user.premium_tier === data.plan) {
    throw badRequest(`Plan ${data.plan} jest już aktywny`);
  }

  const link = createUpgradeLink(req.user.id, data.plan);
  audit({ userId: req.user.id, action: 'create_upgrade_link', detail: { plan: data.plan }, ip: req.ip });
  res.json(link);
}));

export default router;
