'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { db, getSetting, setSetting, deleteSetting, addLedger, ensureDailyGrant } = require('./db');
const { queueEmail, alertAdmin, tpl } = require('./mailer');
const engine = require('./engine');

const ADMIN_EMAIL = 'abirhasan221717@gmail.com'; // server-side only, NEVER sent to clients
const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = engine.UPLOAD_DIR;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `ref-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname || '')}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// ---------------- session helpers ----------------
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function currentUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
  return row || null;
}
function publicUser(u) {
  if (!u) return null;
  const base = { id: u.id, name: u.name, role: u.role, status: u.status, language: u.language, credits: u.credits };
  // The admin address must never reach any client response.
  if (u.role !== 'admin') base.email = u.email;
  return base;
}
function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ ok: false, error: 'Not logged in.' });
  req.user = u;
  next();
}
function requireAdmin(req, res, next) {
  const u = currentUser(req);
  if (!u || u.role !== 'admin') return res.status(403).json({ ok: false, error: 'Admin only.' });
  req.user = u;
  next();
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token, user_id) VALUES(?, ?)').run(token, userId);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax`);
}

// ---------------- auth ----------------
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, language } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  if (!em || !password || String(password).length < 6) return res.status(400).json({ ok: false, error: 'Email and a password of at least 6 characters are required.' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(em)) return res.status(400).json({ ok: false, error: 'An account with this email already exists.' });
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare("INSERT INTO users(email, name, password_hash, status, language) VALUES(?, ?, ?, 'pending', ?)")
    .run(em, String(name || '').trim(), hash, String(language || 'en'));
  await alertAdmin(`${'VYRX Studio'}: New account application`,
    `A new account application is waiting for your approval.\n\nName: ${String(name || '')}\nEmail: ${em}\nTime: ${new Date().toISOString()}\n\nOpen the VYRX Studio admin panel to approve or reject it.`, 'signup_alert');
  res.json({ ok: true, pending: true, userId: info.lastInsertRowid });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(em);
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json({ ok: false, error: 'Wrong email or password.' });
  if (u.role !== 'admin') {
    if (u.status === 'pending') return res.status(403).json({ ok: false, error: 'Your account is waiting for admin approval.' });
    if (u.status === 'rejected') return res.status(403).json({ ok: false, error: 'Your application was not approved.' });
    if (u.status === 'banned') return res.status(403).json({ ok: false, error: 'This account has been suspended by the admin.' });
  }
  startSession(res, u.id);
  const fresh = ensureDailyGrant(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id));
  res.json({ ok: true, user: publicUser(fresh) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req).session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.json({ ok: true, user: null });
  const fresh = ensureDailyGrant(u);
  const unread = db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND user_unread = 1').get(u.id).c;
  res.json({ ok: true, user: publicUser(fresh), supportUnread: unread });
});

app.post('/api/me/language', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET language = ? WHERE id = ?').run(String(req.body.language || 'en'), req.user.id);
  res.json({ ok: true });
});

// Forgot password: one-time 6-digit code by email (30 min, single use).
app.post('/api/auth/forgot', async (req, res) => {
  const em = String((req.body || {}).email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(em);
  if (u) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO password_resets(user_id, code, expires_at) VALUES(?, ?, ?)').run(u.id, code, expires);
    const m = tpl.resetCode(u.name, code);
    await queueEmail(u.email, m.subject, m.body, 'password_reset');
  }
  res.json({ ok: true }); // never reveal whether the email exists
});
app.post('/api/auth/reset', (req, res) => {
  const { email, code, newPassword } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(em);
  if (!u || !newPassword || String(newPassword).length < 6) return res.status(400).json({ ok: false, error: 'Invalid request.' });
  const row = db.prepare('SELECT * FROM password_resets WHERE user_id = ? AND code = ? AND used = 0 ORDER BY id DESC').get(u.id, String(code || ''));
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return res.status(400).json({ ok: false, error: 'This code is wrong or has expired.' });
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(newPassword), 10), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  res.json({ ok: true });
});

// ---------------- admin: setup & state ----------------
app.get('/api/admin/state', (req, res) => {
  const exists = !!db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  res.json({ ok: true, adminExists: exists, adminNeedsSetup: !exists });
});
app.post('/api/admin/setup', (req, res) => {
  if (db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()) return res.status(400).json({ ok: false, error: 'Admin already set up.' });
  const { password } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters.' });
  const info = db.prepare("INSERT INTO users(email, name, password_hash, role, status) VALUES(?, 'Admin', ?, 'admin', 'active')")
    .run(ADMIN_EMAIL, bcrypt.hashSync(String(password), 10));
  startSession(res, info.lastInsertRowid);
  res.json({ ok: true });
});

// ---------------- admin: users & approvals ----------------
app.get('/api/admin/data', requireAdmin, (req, res) => {
  const users = db.prepare("SELECT id, email, name, status, credits, language, created_at FROM users WHERE role = 'user' ORDER BY id DESC").all()
    .map((u) => ({ ...u, videos: db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE user_id = ?').get(u.id).c }));
  const stats = {
    users: db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'user'").get().c,
    pending: db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'user' AND status = 'pending'").get().c,
    videos: db.prepare('SELECT COUNT(*) AS c FROM jobs').get().c,
    creditsSpent: Math.abs(db.prepare("SELECT COALESCE(SUM(delta),0) AS s FROM ledger WHERE delta < 0 AND reason LIKE 'Video job%'").get().s),
  };
  res.json({ ok: true, users, stats });
});

app.post('/api/admin/set-status', requireAdmin, async (req, res) => {
  const { userId, status } = req.body || {};
  if (!['active', 'rejected', 'banned', 'pending'].includes(status)) return res.status(400).json({ ok: false, error: 'Bad status.' });
  const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(Number(userId));
  if (!target) return res.status(404).json({ ok: false, error: 'User not found.' });
  const prev = target.status;
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, target.id);
  if (status === 'banned' || status === 'rejected') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  if (prev !== status) {
    if (status === 'active') { const m = tpl.approved(target.name); await queueEmail(target.email, m.subject, m.body, 'approved'); ensureDailyGrant(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)); }
    if (status === 'rejected') { const m = tpl.rejected(target.name); await queueEmail(target.email, m.subject, m.body, 'rejected'); }
    if (status === 'banned') { const m = tpl.banned(target.name); await queueEmail(target.email, m.subject, m.body, 'banned'); }
  }
  res.json({ ok: true });
});

app.post('/api/admin/adjust-credits', requireAdmin, async (req, res) => {
  const { userId, amount } = req.body || {};
  const amt = Math.trunc(Number(amount));
  if (!Number.isFinite(amt) || amt === 0) return res.status(400).json({ ok: false, error: 'Enter a non-zero amount.' });
  const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'user'").get(Number(userId));
  if (!target) return res.status(404).json({ ok: false, error: 'User not found.' });
  const balance = addLedger(target.id, amt, `Admin adjustment ${amt >= 0 ? '+' : ''}${amt}`);
  const m = tpl.creditAdjust(target.name, amt, balance);
  await queueEmail(target.email, m.subject, m.body, 'credit_adjust');
  res.json({ ok: true, balance });
});

// ---------------- admin: emails log ----------------
app.get('/api/admin/emails', requireAdmin, (req, res) => {
  const emails = db.prepare('SELECT id, to_addr, subject, kind, status, created_at FROM emails ORDER BY id DESC LIMIT 200').all();
  res.json({ ok: true, emails });
});

// ---------------- admin: engine settings ----------------
app.get('/api/admin/engine', requireAdmin, (req, res) => {
  res.json({ ok: true, engine: engine.enginePublicState() });
});
app.post('/api/admin/engine/save', requireAdmin, (req, res) => {
  const { hfToken, hfSpace, falKey, activeEngine } = req.body || {};
  if (typeof hfToken === 'string' && hfToken.trim()) setSetting('hf_token_enc', engine.encryptSecret(hfToken.trim()));
  if (typeof falKey === 'string' && falKey.trim()) setSetting('fal_key_enc', engine.encryptSecret(falKey.trim()));
  if (typeof hfSpace === 'string' && hfSpace.trim()) setSetting('hf_space', hfSpace.trim());
  if (activeEngine === 'hf' || activeEngine === 'fal') setSetting('active_engine', activeEngine);
  res.json({ ok: true, engine: engine.enginePublicState() });
});
app.post('/api/admin/engine/disconnect', requireAdmin, (req, res) => {
  const { which } = req.body || {};
  if (which === 'hf') deleteSetting('hf_token_enc');
  if (which === 'fal') deleteSetting('fal_key_enc');
  res.json({ ok: true, engine: engine.enginePublicState() });
});
app.post('/api/admin/engine/test', requireAdmin, async (req, res) => {
  const cfg = engine.getEngineConfig();
  const which = (req.body || {}).which || cfg.active;
  if (which === 'hf') {
    if (!cfg.hf.token) return res.json({ ok: false, detail: 'No Hugging Face token saved.' });
    return res.json(await engine.testHf(cfg.hf.token, cfg.hf.space));
  }
  if (!cfg.fal.key) return res.json({ ok: false, detail: 'No fal.ai key saved.' });
  return res.json(await engine.testFal(cfg.fal.key));
});

// ---------------- jobs ----------------
app.get('/api/jobs', requireAuth, (req, res) => {
  const jobs = db.prepare('SELECT id, prompt, duration_sec, model, voice_lang, status, stage, progress_done, progress_total, cost, error, created_at FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json({ ok: true, jobs });
});
app.get('/api/ledger', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT delta, reason, balance_after, created_at FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  res.json({ ok: true, ledger: rows });
});

const jobUpload = upload.fields([{ name: 'refImage', maxCount: 1 }, { name: 'refVideo', maxCount: 1 }]);
app.post('/api/jobs', requireAuth, jobUpload, (req, res) => {
  const u = ensureDailyGrant(req.user);
  if (u.status !== 'active') return res.status(403).json({ ok: false, error: 'Your account is not active.' });
  const prompt = String((req.body || {}).prompt || '').trim();
  const durationSec = Math.max(1, Math.min(1200, Math.trunc(Number((req.body || {}).durationSec) || 30)));
  if (!prompt) return res.status(400).json({ ok: false, error: 'A prompt is required.' });
  const cost = Math.max(1, Math.round(durationSec * 50 / 60));
  if (u.credits < cost) return res.status(400).json({ ok: false, error: `Not enough credits. This video costs ${cost} credits; your balance is ${u.credits}.` });
  const refImage = req.files && req.files.refImage ? req.files.refImage[0].path : null;
  const refVideo = req.files && req.files.refVideo ? req.files.refVideo[0].path : null;
  const cfg = engine.getEngineConfig();
  const hasEngine = cfg.active === 'hf' ? !!cfg.hf.token : !!cfg.fal.key;
  const total = Math.max(1, Math.ceil(durationSec / 5));
  const info = db.prepare(`INSERT INTO jobs(user_id, prompt, duration_sec, model, voice_lang, ref_image, ref_video, status, progress_total, cost)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(u.id, prompt, durationSec, String((req.body || {}).model || 'wan'), String((req.body || {}).voiceLang || 'en'), refImage, refVideo, hasEngine ? 'queued' : 'waiting_engine', total, cost);
  addLedger(u.id, -cost, `Video job #${info.lastInsertRowid}`);
  const fresh = db.prepare('SELECT credits FROM users WHERE id = ?').get(u.id);
  res.json({ ok: true, jobId: info.lastInsertRowid, cost, balance: fresh.credits, status: hasEngine ? 'queued' : 'waiting_engine' });
});

app.get('/api/jobs/:id/video', requireAuth, (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(Number(req.params.id));
  if (!job || (job.user_id !== req.user.id && req.user.role !== 'admin')) return res.status(404).json({ ok: false, error: 'Not found.' });
  if (!job.result_path || !fs.existsSync(job.result_path)) return res.status(404).json({ ok: false, error: 'Video not ready.' });
  res.download(job.result_path, `vyrx-video-${job.id}.mp4`);
});

// ---------------- support ----------------
app.post('/api/support', requireAuth, async (req, res) => {
  const { subject, message } = req.body || {};
  if (!subject || !message) return res.status(400).json({ ok: false, error: 'Subject and message are required.' });
  const info = db.prepare("INSERT INTO tickets(user_id, subject, admin_unread) VALUES(?, ?, 1)").run(req.user.id, String(subject));
  db.prepare("INSERT INTO ticket_messages(ticket_id, sender, body) VALUES(?, 'user', ?)").run(info.lastInsertRowid, String(message));
  await alertAdmin(`${'VYRX Studio'}: New support message`,
    `A user sent a support message.\n\nSubject: ${String(subject)}\n\n${String(message)}\n\nOpen the VYRX Studio admin panel (Support inbox) to read it and reply. Replies are delivered inside the site only.`, 'support_alert');
  res.json({ ok: true, ticketId: info.lastInsertRowid });
});
app.get('/api/support/mine', requireAuth, (req, res) => {
  const tickets = db.prepare('SELECT * FROM tickets WHERE user_id = ? ORDER BY id DESC').all(req.user.id)
    .map((t) => ({ ...t, messages: db.prepare('SELECT sender, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id ASC').all(t.id) }));
  res.json({ ok: true, tickets });
});
app.post('/api/support/:id/reply', requireAuth, async (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!t) return res.status(404).json({ ok: false, error: 'Ticket not found.' });
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ ok: false, error: 'Message required.' });
  db.prepare("INSERT INTO ticket_messages(ticket_id, sender, body) VALUES(?, 'user', ?)").run(t.id, String(message));
  db.prepare("UPDATE tickets SET admin_unread = 1, status = 'open', user_unread = 0 WHERE id = ?").run(t.id);
  await alertAdmin(`${'VYRX Studio'}: Support reply`, `A user replied to support ticket #${t.id} (${t.subject}). Open the admin panel Support inbox to read it.`, 'support_alert');
  res.json({ ok: true });
});
app.post('/api/support/:id/seen', requireAuth, (req, res) => {
  db.prepare('UPDATE tickets SET user_unread = 0 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});
app.get('/api/admin/support', requireAdmin, (req, res) => {
  const tickets = db.prepare(`SELECT t.*, u.name AS user_name FROM tickets t JOIN users u ON u.id = t.user_id ORDER BY t.id DESC`).all()
    .map((t) => ({ ...t, messages: db.prepare('SELECT sender, body, created_at FROM ticket_messages WHERE ticket_id = ? ORDER BY id ASC').all(t.id) }));
  res.json({ ok: true, tickets });
});
app.post('/api/admin/support/:id/reply', requireAdmin, (req, res) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(req.params.id));
  if (!t) return res.status(404).json({ ok: false, error: 'Ticket not found.' });
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ ok: false, error: 'Message required.' });
  // Support replies are delivered IN-SITE ONLY — no email is sent for replies.
  db.prepare("INSERT INTO ticket_messages(ticket_id, sender, body) VALUES(?, 'admin', ?)").run(t.id, String(message));
  db.prepare("UPDATE tickets SET user_unread = 1, admin_unread = 0, status = 'replied' WHERE id = ?").run(t.id);
  res.json({ ok: true });
});
app.post('/api/admin/support/:id/seen', requireAdmin, (req, res) => {
  db.prepare('UPDATE tickets SET admin_unread = 0 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'Not found.' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

engine.startWorker();
app.listen(PORT, () => console.log(`VYRX Studio listening on port ${PORT}`));
