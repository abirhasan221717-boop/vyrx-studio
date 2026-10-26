'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { db, getSetting, setSetting, deleteSetting, addLedger } = require('./db');
const { queueEmail, tpl } = require('./mailer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DEFAULT_HF_SPACE = 'r3gm/wan2-2-fp8da-aoti-preview';
const WAKE_WINDOW_MS = 10 * 60 * 1000; // ~10 minutes of wake retries

// ---------- secret storage (AES-256-GCM, key derived from SESSION_SECRET) ----------
function secretKey() {
  return crypto.createHash('sha256').update(process.env.SESSION_SECRET || 'vyrx-dev-secret-change-me').digest();
}
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}
function decryptSecret(enc) {
  if (!enc) return null;
  try {
    const [iv, tag, data] = enc.split('.').map((s) => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) { return null; }
}

function getEngineConfig() {
  const active = getSetting('active_engine') || 'hf';
  const hfToken = decryptSecret(getSetting('hf_token_enc'));
  const falKey = decryptSecret(getSetting('fal_key_enc'));
  return {
    active,
    hf: { token: hfToken, space: getSetting('hf_space') || DEFAULT_HF_SPACE, connected: !!hfToken, last4: hfToken ? hfToken.slice(-4) : null },
    fal: { key: falKey, connected: !!falKey, last4: falKey ? falKey.slice(-4) : null },
  };
}
function enginePublicState() {
  const c = getEngineConfig();
  return {
    activeEngine: c.active,
    hf: { connected: c.hf.connected, last4: c.hf.last4, space: c.hf.space },
    fal: { connected: c.fal.connected, last4: c.fal.last4 },
  };
}

// ---------- connection tests ----------
async function testHf(token, space) {
  const who = await fetch('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${token}` } });
  if (!who.ok) return { ok: false, detail: `Hugging Face rejected the saved token (${who.status}). Create a new Read token and save it.` };
  const info = await probeSpace(space);
  if (!info.ok) return { ok: false, detail: `Token is valid, but the Space "${space}" did not answer its API info (${info.detail}). It may be paused, renamed or deleted.` };
  return { ok: true, detail: 'Connected. Token valid and the Space answers.' };
}
async function testFal(key) {
  try {
    const r = await fetch('https://queue.fal.run/fal-ai/wan/v2.2-a14b/text-to-video', { headers: { Authorization: `Key ${key}` } });
    if (r.status === 401 || r.status === 403) return { ok: false, detail: `fal.ai rejected the saved key (${r.status}).` };
    return { ok: true, detail: 'Connected. fal.ai answered.' };
  } catch (e) { return { ok: false, detail: `Could not reach fal.ai: ${e.message}` }; }
}

// ---------- Hugging Face Space (Gradio) client ----------
function spaceHost(space) {
  return `${space.replace('/', '-').toLowerCase()}.hf.space`;
}
async function fetchWithTimeout(url, opts = {}, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}
async function probeSpace(space) {
  try {
    const r = await fetchWithTimeout(`https://${spaceHost(space)}/gradio_api/info`, {}, 20000);
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    const info = await r.json();
    return { ok: true, info };
  } catch (e) { return { ok: false, detail: e.message }; }
}

class EngineError extends Error {
  constructor(message, retryable = false) { super(message); this.retryable = retryable; }
}
const WAKE_STATUSES = new Set([429, 502, 503, 504]);
function classifyHttp(status, context) {
  if (WAKE_STATUSES.has(status)) return new EngineError(`The Space answered ${status} while ${context} — it is likely waking up.`, true);
  if (status === 401 || status === 403) return new EngineError(`The Space rejected the request while ${context} (HTTP ${status}) — the saved token may be invalid.`, false);
  if (status === 404) return new EngineError(`The Space was not found while ${context} (HTTP 404) — it may be paused, renamed or deleted.`, false);
  return new EngineError(`The Space answered HTTP ${status} while ${context}.`, false);
}

async function uploadRefFile(space, token, filePath, mime) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('files', new Blob([buf], { type: mime || 'application/octet-stream' }), path.basename(filePath));
  let r;
  try {
    r = await fetchWithTimeout(`https://${spaceHost(space)}/gradio_api/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    }, 60000);
  } catch (e) { throw new EngineError(`Connection failed while uploading the reference file (${e.message}) — the Space may be waking up.`, true); }
  if (!r.ok) throw classifyHttp(r.status, 'uploading the reference file');
  const paths = await r.json();
  const p = Array.isArray(paths) ? paths[0] : null;
  if (!p) throw new EngineError('The Space upload returned no file path.', false);
  return { path: p, meta: { _type: 'gradio.FileData' } };
}

// Build the data array for the Space's first usable named endpoint, using the
// Space's own declared defaults and filling prompt/duration/file params.
function buildChunkData(info, promptText, seconds, refFileData) {
  const endpoints = info.named_endpoints || {};
  const names = Object.keys(endpoints);
  if (!names.length) throw new EngineError('The Space exposes no named API endpoints.', false);
  // Prefer an endpoint that takes a text/prompt parameter.
  let chosen = null;
  for (const name of names) {
    const params = endpoints[name].parameters || [];
    if (params.some((p) => (p.type === 'string' || !p.type) && /prompt|text/i.test(`${p.label || ''} ${p.parameter_name || ''}`))) { chosen = name; break; }
  }
  if (!chosen) chosen = names.find((n) => /predict|generate|run/i.test(n)) || names[0];
  const params = endpoints[chosen].parameters || [];
  const data = params.map((p) => {
    const label = `${p.label || ''} ${p.parameter_name || ''}`;
    if (/image|video|file/i.test(label) && refFileData) return refFileData;
    if (/prompt|text/i.test(label) && (p.type === 'string' || p.type === undefined)) return promptText;
    if (/duration|seconds|length/i.test(label) && typeof p.default === 'number') return seconds;
    if (/seed/i.test(label) && typeof p.default === 'number') return Math.floor(Math.random() * 1e9);
    if (p.default !== undefined) return p.default;
    if (p.type === 'number' || p.type === 'integer') return 0;
    if (p.type === 'boolean') return false;
    if (p.type === 'string') return promptText;
    return null;
  });
  return { endpoint: chosen, data };
}

async function submitChunkHf(cfg, job, chunkSeconds) {
  const { token, space } = cfg.hf;
  const host = spaceHost(space);
  const probe = await probeSpace(space);
  if (!probe.ok) throw new EngineError(`The Space "${space}" did not answer its API info (${probe.detail}) while submitting. Free ZeroGPU Spaces do this while waking up.`, true);
  let refFileData = null;
  const refPath = job.ref_image || job.ref_video;
  if (refPath && fs.existsSync(refPath)) {
    const mime = job.ref_image ? 'image/png' : 'video/mp4';
    refFileData = await uploadRefFile(space, token, refPath, mime);
  }
  const voiceNote = job.voice_lang === 'bn' ? ' Dialogue and voice in Bengali language.' : ' Dialogue and voice in English language.';
  const { endpoint, data } = buildChunkData(probe.info, job.prompt + voiceNote, chunkSeconds, refFileData);
  let joinRes;
  try {
    joinRes = await fetchWithTimeout(`https://${host}/gradio_api/queue/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data, fn_index: undefined, session_hash: crypto.randomBytes(8).toString('hex') }),
    }, 60000);
  } catch (e) { throw new EngineError(`The Space "${space}" closed the connection while submitting (${e.message}). Free ZeroGPU Spaces do this while they are waking up.`, true); }
  if (!joinRes.ok) throw classifyHttp(joinRes.status, 'submitting to the queue');
  const joined = await joinRes.json();
  const sessionHash = joined.session_hash || joined.sessionHash;
  if (!sessionHash && !joined.event_id) throw new EngineError('The Space queue join returned no session.', true);
  // Poll the queue data stream (SSE-style) until completion.
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    let r;
    try {
      r = await fetchWithTimeout(`https://${host}/gradio_api/queue/data?session_hash=${encodeURIComponent(sessionHash)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }, 120000);
    } catch (e) { throw new EngineError(`Connection dropped while waiting for the video (${e.message}) — the Space may be waking up.`, true); }
    if (!r.ok) throw classifyHttp(r.status, 'waiting for the video');
    const text = await r.text();
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      let evt; try { evt = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
      if (evt.msg === 'process_completed') {
        const out = (evt.output && evt.output.data) || [];
        const file = out.find((o) => o && (o.path || o.url || (o.video && o.video.path)));
        const filePath = file && (file.path || (file.video && file.video.path));
        const fileUrl = file && file.url;
        if (!filePath && !fileUrl) throw new EngineError('The Space finished but returned no video file.', false);
        return { filePath, fileUrl };
      }
      if (evt.msg === 'process_failed' || evt.msg === 'queue_full') {
        const reason = (evt.error && evt.error.message) || evt.msg;
        if (/quota/i.test(reason)) throw new EngineError(`The free engine reported a quota problem: ${reason}`, false);
        throw new EngineError(`The Space reported an error: ${reason}`, /waking|starting|loading/i.test(reason));
      }
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new EngineError('Timed out waiting for the Space to finish the video.', true);
}

async function downloadChunk(cfg, job, result, destPath) {
  const host = spaceHost(cfg.hf.space);
  const url = result.fileUrl || `https://${host}/gradio_api/file=${result.filePath}`;
  let r;
  try {
    r = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${cfg.hf.token}` } }, 300000);
  } catch (e) { throw new EngineError(`Connection failed while downloading the generated chunk (${e.message}).`, true); }
  if (!r.ok) throw classifyHttp(r.status, 'downloading the generated chunk');
  fs.writeFileSync(destPath, Buffer.from(await r.arrayBuffer()));
}

// ---------- ffmpeg stitching ----------
function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: 10 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${String(stderr || err.message).slice(-400)}`));
      else resolve();
    });
  });
}
async function stitchChunks(jobDir, chunkFiles, outPath) {
  const listPath = path.join(jobDir, 'concat.txt');
  fs.writeFileSync(listPath, chunkFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  try {
    await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);
  } catch (e) {
    await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:v', 'libx264', '-c:a', 'aac', outPath]);
  }
}

// ---------- job lifecycle ----------
function touchJob(id, fields) {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE jobs SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(fields), id);
}
async function failJob(job, reason) {
  touchJob(job.id, { status: 'failed', stage: '', error: reason });
  if (!job.refunded && job.cost > 0) {
    addLedger(job.user_id, job.cost, `Refund: video job #${job.id} failed`);
    touchJob(job.id, { refunded: 1 });
    const user = db.prepare('SELECT email, name FROM users WHERE id = ?').get(job.user_id);
    if (user) { const m = tpl.jobFailed(user.name, job.id, job.cost); await queueEmail(user.email, m.subject, m.body, 'job_failed'); }
  }
}
function backoffMs(attempts) {
  return Math.min(90000, 20000 * Math.pow(2, Math.max(0, attempts - 1))); // 20s,40s,80s,90s…
}

async function advanceJob(job, cfg) {
  const total = job.progress_total || Math.max(1, Math.ceil(job.duration_sec / 5));
  const jobDir = path.join(UPLOAD_DIR, `job-${job.id}`);
  fs.mkdirSync(jobDir, { recursive: true });
  let done = job.progress_done || 0;
  while (done < total) {
    const chunkSeconds = Math.min(5, job.duration_sec - done * 5);
    const dest = path.join(jobDir, `chunk-${done}.mp4`);
    try {
      if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
        const result = await submitChunkHf(cfg, job, chunkSeconds);
        await downloadChunk(cfg, job, result, dest);
      }
    } catch (e) {
      if (e instanceof EngineError && e.retryable) {
        const now = Date.now();
        const wakeSince = job.wake_since ? new Date(job.wake_since).getTime() : now;
        if (now - wakeSince > WAKE_WINDOW_MS) { await failJob(job, e.message); return; }
        const attempts = (job.wake_attempts || 0) + 1;
        touchJob(job.id, {
          status: 'processing', stage: 'waking', error: e.message,
          wake_since: job.wake_since || new Date(now).toISOString(), wake_attempts: attempts,
          next_retry_at: new Date(now + backoffMs(attempts)).toISOString(),
        });
        return; // try again on a later tick
      }
      await failJob(job, e.message || String(e));
      return;
    }
    done += 1;
    touchJob(job.id, { progress_done: done, progress_total: total, stage: 'generating', wake_since: null, wake_attempts: 0, next_retry_at: null, error: null });
    job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id);
  }
  // All chunks ready → stitch into ONE final video.
  touchJob(job.id, { stage: 'stitching' });
  const chunks = [];
  for (let i = 0; i < total; i++) chunks.push(path.join(jobDir, `chunk-${i}.mp4`));
  const outPath = path.join(jobDir, 'final.mp4');
  try {
    await stitchChunks(jobDir, chunks, outPath);
  } catch (e) { await failJob(job, e.message); return; }
  touchJob(job.id, { status: 'done', stage: '', result_path: outPath, error: null });
}

let ticking = false;
async function tickEngine() {
  if (ticking) return;
  ticking = true;
  try {
    const cfg = getEngineConfig();
    const hasEngine = cfg.active === 'hf' ? !!cfg.hf.token : !!cfg.fal.key;
    const jobs = db.prepare("SELECT * FROM jobs WHERE status IN ('waiting_engine','queued','processing') ORDER BY id ASC LIMIT 3").all();
    for (const job of jobs) {
      if (!hasEngine) {
        if (job.status !== 'waiting_engine') touchJob(job.id, { status: 'waiting_engine', stage: '' });
        continue;
      }
      if (job.status === 'waiting_engine') touchJob(job.id, { status: 'queued' });
      if (job.next_retry_at && new Date(job.next_retry_at).getTime() > Date.now()) continue;
      if (cfg.active !== 'hf') { await failJob(job, 'The fal.ai engine slot is saved but fal generation is not enabled in this build; switch the active engine to Hugging Face.'); continue; }
      touchJob(job.id, { status: 'processing', stage: job.stage || 'generating' });
      const fresh = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id);
      await advanceJob(fresh, cfg);
    }
  } catch (e) {
    // worker must never crash the server
    console.error('tickEngine error:', e.message);
  } finally { ticking = false; }
}

function startWorker() {
  setInterval(tickEngine, 60 * 1000);
  setTimeout(tickEngine, 5000);
}

module.exports = {
  DEFAULT_HF_SPACE, UPLOAD_DIR, encryptSecret, getEngineConfig, enginePublicState,
  testHf, testFal, startWorker, tickEngine,
  setSetting, deleteSetting,
};
