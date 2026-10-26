'use strict';
const nodemailer = require('nodemailer');
const { db } = require('./db');

// Emails are always recorded in the outbox. If SMTP env vars are configured the
// mail is actually sent and the record flips to Sent/Failed; otherwise the
// record honestly stays "Queued".
function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
let transporter = null;
function getTransporter() {
  if (!smtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

async function queueEmail(to, subject, body, kind = 'notice') {
  const info = db.prepare('INSERT INTO emails(to_addr, subject, body, kind) VALUES(?, ?, ?, ?)').run(to, subject, body, kind);
  const id = info.lastInsertRowid;
  const t = getTransporter();
  if (t) {
    try {
      await t.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to, subject, text: body,
      });
      db.prepare("UPDATE emails SET status = 'Sent' WHERE id = ?").run(id);
    } catch (e) {
      db.prepare("UPDATE emails SET status = 'Failed' WHERE id = ?").run(id);
    }
  }
  return id;
}

// The admin address lives only on the server (users table, role='admin').
// It is never included in any API response.
function adminEmail() {
  const row = db.prepare("SELECT email FROM users WHERE role = 'admin' LIMIT 1").get();
  return row ? row.email : null;
}
async function alertAdmin(subject, body, kind = 'admin_alert') {
  const to = adminEmail();
  if (to) await queueEmail(to, subject, body, kind);
}

const BRAND = 'VYRX Studio';
const tpl = {
  approved: (name) => ({
    subject: `${BRAND}: Your application has been approved`,
    body: `Hello ${name || 'there'},\n\nGood news — your ${BRAND} application has been approved. You can now log in and start creating videos.\n\nHow credits work:\n- You receive +500 free credits every day.\n- Creating a video costs 50 credits per minute (for example, 30 seconds = 25 credits).\n- No subscription, ever.\n\nWelcome aboard,\n${BRAND}`,
  }),
  rejected: (name) => ({
    subject: `${BRAND}: About your application`,
    body: `Hello ${name || 'there'},\n\nThank you for applying to ${BRAND}. Your application was not approved at this time.\n\n${BRAND}`,
  }),
  banned: (name) => ({
    subject: `${BRAND}: Your account has been suspended`,
    body: `Hello ${name || 'there'},\n\nYour ${BRAND} account has been suspended by the admin. You can no longer log in or generate videos.\n\n${BRAND}`,
  }),
  creditAdjust: (name, delta, balance) => ({
    subject: `${BRAND}: Your credit balance changed`,
    body: `Hello ${name || 'there'},\n\nYour ${BRAND} credit balance was adjusted by the admin: ${delta >= 0 ? '+' : ''}${delta} credits.\nYour new balance is ${balance} credits.\n\n${BRAND}`,
  }),
  jobFailed: (name, jobId, cost) => ({
    subject: `${BRAND}: Video generation failed — credits refunded`,
    body: `Hello ${name || 'there'},\n\nVideo job #${jobId} could not be generated. The ${cost} credits for this job were refunded to your balance automatically.\n\n${BRAND}`,
  }),
  resetCode: (name, code) => ({
    subject: `${BRAND}: Your password reset code`,
    body: `Hello ${name || 'there'},\n\nYour one-time ${BRAND} password reset code is: ${code}\nIt expires in 30 minutes and can be used only once.\nIf you did not request this, you can ignore this email.\n\n${BRAND}`,
  }),
};

module.exports = { queueEmail, alertAdmin, tpl, smtpConfigured };
