'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { db, getSetting, setSetting, deleteSetting, addLedger } = require('./db');
const { queueEmail, tpl } = require('./mailer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DEFAULT_HF_SPACE = 'multimodalart/wan2-1-fast'; // r3gm aoti Spaces reject API sessions ('session_not_found') — verified 2026-10-26; wan2-1-fast queue flow verified end-to-end
const DEFAULT_IMAGE_SPACE = 'black-forest-labs/FLUX.1-schnell';
const WAKE_WINDOW_MS = 10 * 60 * 1000; // ~10 minutes of wake retries
const CHUNK_CAP_SECONDS = 10; // hard cap for one generated chunk

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
    imageSpace: getSetting('hf_image_space') || DEFAULT_IMAGE_SPACE,
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

// ---------- errors / http helpers ----------
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
async function fetchWithTimeout(url, opts = {}, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// ---------- Hugging Face Space (Gradio 5) client ----------
// The client is config-driven: it reads the Space's own /config, finds the
// generate dependency, and builds the data array in the dependency's exact
// input order from the components' declared props. This matters because the
// default video Space is image-to-video: its first input is a REQUIRED start
// image, and submitting without one makes the Space answer HTTP 400.

// Test hook: VYRX_HF_HOST_MAP='{"owner/name":"http://127.0.0.1:1234"}' pins a
// Space to a specific base URL (used by the local mock test-suite only).
function hostOverride(space) {
  try {
    const raw = process.env.VYRX_HF_HOST_MAP;
    if (!raw) return null;
    const map = JSON.parse(raw);
    const v = map && map[space];
    return typeof v === 'string' && v ? v.replace(/\/+$/, '') : null;
  } catch (e) { return null; }
}

async function resolveSpaceHost(space, token) {
  const override = hostOverride(space);
  if (override) return override;
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const r = await fetchWithTimeout(`https://huggingface.co/api/spaces/${space}`, { headers }, 20000);
    if (r.ok) {
      const j = await r.json();
      if (j && j.host) return String(j.host).replace(/\/+$/, '');
      if (j && j.subdomain) return `https://${j.subdomain}.hf.space`;
    }
  } catch (e) { /* fall through to the derived host */ }
  return `https://${space.toLowerCase().replace('/', '-').replace(/_/g, '-')}.hf.space`;
}

async function fetchSpaceConfig(space, token) {
  const host = await resolveSpaceHost(space, token);
  let r;
  try {
    r = await fetchWithTimeout(`${host}/config`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, 30000);
  } catch (e) {
    throw new EngineError(`Connection failed while reading the config of the Space "${space}" (${e.message}) — the Space may be waking up.`, true);
  }
  if (!r.ok) throw classifyHttp(r.status, `reading the config of the Space "${space}"`);
  let config;
  try { config = await r.json(); } catch (e) { throw new EngineError(`The Space "${space}" returned an unreadable config.`, false); }
  if (!config || !Array.isArray(config.components) || !Array.isArray(config.dependencies)) {
    throw new EngineError(`The Space "${space}" returned a config with an unexpected shape.`, false);
  }
  return { host, config };
}

async function probeSpace(space, token) {
  try {
    const { host, config } = await fetchSpaceConfig(space, token);
    return { ok: true, host, config, dep: findGenerateDep(config) };
  } catch (e) { return { ok: false, detail: e.message }; }
}

// ---------- connection tests ----------
async function testHf(token, space) {
  const who = await fetch('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${token}` } });
  if (!who.ok) return { ok: false, detail: `Hugging Face rejected the saved token (${who.status}). Create a new Read token and save it.` };
  const info = await probeSpace(space, token);
  if (!info.ok) return { ok: false, detail: `Token is valid, but the Space "${space}" did not answer its config (${info.detail}). It may be paused, renamed or deleted.` };
  if (!info.dep) return { ok: false, detail: `Token is valid and the Space "${space}" answers, but no usable generate endpoint was found in its config.` };
  return { ok: true, detail: 'Connected. Token valid and the Space answers.' };
}
async function testFal(key) {
  try {
    const r = await fetch('https://queue.fal.run/fal-ai/wan/v2.2-a14b/text-to-video', { headers: { Authorization: `Key ${key}` } });
    if (r.status === 401 || r.status === 403) return { ok: false, detail: `fal.ai rejected the saved key (${r.status}).` };
    return { ok: true, detail: 'Connected. fal.ai answered.' };
  } catch (e) { return { ok: false, detail: `Could not reach fal.ai: ${e.message}` }; }
}

// ---------- config-driven payload building ----------
function componentMap(config) {
  const m = new Map();
  for (const c of config.components || []) m.set(c.id, c);
  return m;
}
function labelOf(comp) { return (comp && comp.props && comp.props.label) || ''; }
function depComponents(config, dep) {
  const m = componentMap(config);
  return (dep.inputs || []).map((id) => m.get(id)).filter(Boolean);
}

// Pick the dependency that generates media: prefer a queued endpoint whose
// inputs include an image and/or a prompt textbox; frame-extraction helpers
// (video input) are penalised so they are never chosen.
function findGenerateDep(config) {
  const deps = (config.dependencies || []).filter((d) => d && d.api_name && Array.isArray(d.inputs) && d.inputs.length);
  let best = null;
  let bestScore = -Infinity;
  for (const d of deps) {
    const ins = depComponents(config, d);
    if (!ins.length) continue;
    const hasImage = ins.some((c) => c.type === 'image');
    const hasVideoIn = ins.some((c) => c.type === 'video');
    const hasPrompt = ins.some((c) => c.type === 'textbox' && /prompt/i.test(labelOf(c)) && !/negative/i.test(labelOf(c)));
    let score = 0;
    if (d.queue) score += 2;
    if (hasImage) score += 4;
    if (hasPrompt) score += 4;
    if (/generate/i.test(d.api_name)) score += 3;
    if (/infer|predict|run/i.test(d.api_name)) score += 1;
    if (hasVideoIn) score -= 6;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return bestScore > 0 ? best : null;
}

function depHasImageInput(config, dep) {
  return depComponents(config, dep).some((c) => c.type === 'image');
}

// Seconds one chunk may cover: the Space's own Duration maximum, capped.
function chunkCapSeconds(config, dep) {
  for (const c of depComponents(config, dep)) {
    if ((c.type === 'slider' || c.type === 'number') && /duration/i.test(labelOf(c))) {
      const max = c.props && typeof c.props.maximum === 'number' ? c.props.maximum : CHUNK_CAP_SECONDS;
      return Math.max(1, Math.min(max, CHUNK_CAP_SECONDS));
    }
  }
  return CHUNK_CAP_SECONDS;
}

const SKIP = Symbol('skip');
function defaultComponentValue(ctx) {
  return ctx.props.value === undefined ? null : ctx.props.value;
}
// Build data[] strictly in the dependency's input order. `fill(ctx)` returns
// a value, or SKIP to keep the component's declared default.
function buildDataFromConfig(config, dep, fill) {
  const comps = componentMap(config);
  let imageSeen = 0;
  return (dep.inputs || []).map((id) => {
    const comp = comps.get(id);
    if (!comp) return null;
    const ctx = {
      comp, type: comp.type, label: labelOf(comp), props: comp.props || {},
      imageIndex: comp.type === 'image' ? imageSeen++ : -1,
    };
    const v = fill(ctx);
    return v === SKIP ? defaultComponentValue(ctx) : v;
  });
}

function videoFill({ promptText, seconds, startFileData }) {
  return (ctx) => {
    const { type, label, props } = ctx;
    if (type === 'image') return ctx.imageIndex === 0 ? startFileData : null;
    if (type === 'textbox' || type === 'textarea') {
      if (/negative/i.test(label)) return props.value !== undefined ? props.value : '';
      if (/prompt/i.test(label)) return promptText;
      return SKIP;
    }
    if (type === 'slider' || type === 'number') {
      if (/duration/i.test(label)) {
        const min = typeof props.minimum === 'number' ? props.minimum : 0;
        const max = typeof props.maximum === 'number' ? props.maximum : CHUNK_CAP_SECONDS;
        return Math.max(min, Math.min(max, seconds));
      }
      if (/seed/i.test(label)) {
        const min = typeof props.minimum === 'number' ? props.minimum : 0;
        const max = typeof props.maximum === 'number' ? Math.min(props.maximum, 2147483647) : 2147483647;
        return Math.floor(min + Math.random() * Math.max(1, max - min));
      }
      return SKIP;
    }
    if (type === 'checkbox') {
      if (/randomize/i.test(label) && /seed/i.test(label)) return true;
      return SKIP;
    }
    return SKIP;
  };
}

function imageFill({ promptText, width, height }) {
  return (ctx) => {
    const { type, label } = ctx;
    if (type === 'textbox' || type === 'textarea') {
      if (/prompt/i.test(label) && !/negative/i.test(label)) return promptText;
      return SKIP;
    }
    if (type === 'slider' || type === 'number') {
      if (/width/i.test(label)) return width;
      if (/height/i.test(label)) return height;
      if (/seed/i.test(label)) return 0;
      return SKIP;
    }
    if (type === 'checkbox') {
      if (/randomize/i.test(label)) return true;
      return SKIP;
    }
    return SKIP;
  };
}

// ---------- Gradio 5 call mechanics ----------
async function gradioUpload(host, token, filePath, mime) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('files', new Blob([buf], { type: mime || 'application/octet-stream' }), path.basename(filePath));
  let r;
  try {
    r = await fetchWithTimeout(`${host}/gradio_api/upload`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    }, 120000);
  } catch (e) { throw new EngineError(`Connection failed while uploading a file to the Space (${e.message}) — the Space may be waking up.`, true); }
  if (!r.ok) throw classifyHttp(r.status, 'uploading a file to the Space');
  const paths = await r.json().catch(() => null);
  const p = Array.isArray(paths) ? paths[0] : null;
  if (!p) throw new EngineError('The Space upload returned no file path.', false);
  return { path: p, orig_name: path.basename(filePath), meta: { _type: 'gradio.FileData' } };
}

// Gradio queue protocol (verified live 2026-10-26): the /gradio_api/call/{fn}
// sugar endpoint returns "404: Session not found" error events on current
// ZeroGPU Spaces — the working flow is POST /gradio_api/queue/join with
// fn_index + session_hash, then stream GET /gradio_api/queue/data?session_hash=…
// and follow the msg events for our event_id. process_completed carries the
// real failure text in output.error (e.g. the ZeroGPU quota message).
function parseQueueMessage(parsed, eventId) {
  if (!parsed || typeof parsed !== 'object') return { state: 'pending' };
  if (parsed.event_id && parsed.event_id !== eventId) return { state: 'pending' };
  switch (parsed.msg) {
    case 'process_completed': {
      const out = parsed.output || {};
      if (out.error) return { state: 'error', message: String(out.error) };
      if (Array.isArray(out.data)) return { state: 'complete', outputs: out.data };
      if (parsed.success === false) return { state: 'error', message: 'the Space reported a failed run' };
      return { state: 'complete', outputs: [] };
    }
    case 'process_failed':
    case 'queue_full':
      return { state: 'error', message: (parsed.error && parsed.error.message) || String(parsed.msg) };
    default:
      if (typeof parsed.error === 'string' && parsed.error) return { state: 'error', message: parsed.error };
      return { state: 'pending' };
  }
}

function outcomeToError(outcome) {
  const reason = outcome.message || 'unknown error';
  if (/quota/i.test(reason)) return new EngineError(`The free engine reported a quota problem: ${reason}`, false);
  return new EngineError(`The Space reported an error: ${reason}`, /waking|starting|loading|queue is full/i.test(reason));
}

async function pollQueueData(host, token, sessionHash, eventId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let r;
    try {
      r = await fetchWithTimeout(`${host}/gradio_api/queue/data?session_hash=${encodeURIComponent(sessionHash)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }, timeoutMs + 60000);
    } catch (e) { throw new EngineError(`Connection dropped while waiting for the Space to finish (${e.message}) — it may be waking up.`, true); }
    if (!r.ok) throw classifyHttp(r.status, 'waiting for the Space to finish');
    if (!r.body || typeof r.body.getReader !== 'function') throw new EngineError('The Space queue stream was not readable.', true);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let terminal = null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          let parsed; try { parsed = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
          const outcome = parseQueueMessage(parsed, eventId);
          if (outcome.state !== 'pending') { terminal = outcome; break; }
        }
        if (terminal) break;
        if (Date.now() > deadline) break;
      }
    } catch (e) {
      // Socket dropped mid-stream (the old "terminated") — fall through and
      // re-attach; the queue replays this session's events.
      terminal = null;
    } finally {
      try { await reader.cancel(); } catch (e) { /* already closed */ }
    }
    if (terminal && terminal.state === 'complete') return terminal.outputs;
    if (terminal && terminal.state === 'error') throw outcomeToError(terminal);
    // Stream closed without a terminal event — re-attach after a short pause.
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new EngineError('Timed out waiting for the Space to finish.', true);
}

async function gradioCall(host, token, dep, data, timeoutMs = 15 * 60 * 1000) {
  if (!dep || typeof dep.id !== 'number') throw new EngineError('The Space config did not expose a callable generation endpoint.', false);
  const sessionHash = crypto.randomBytes(8).toString('hex');
  let r;
  try {
    r = await fetchWithTimeout(`${host}/gradio_api/queue/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data, fn_index: dep.id, session_hash: sessionHash }),
    }, 120000);
  } catch (e) { throw new EngineError(`The Space closed the connection while submitting (${e.message}). Free ZeroGPU Spaces do this while they are waking up.`, true); }
  if (!r.ok) throw classifyHttp(r.status, 'submitting to the queue');
  const joined = await r.json().catch(() => null);
  const eventId = joined && joined.event_id;
  if (!eventId) throw new EngineError('The Space queue returned no event id.', true);
  return pollQueueData(host, token, sessionHash, eventId, timeoutMs);
}

function firstFileData(outputs) {
  for (const o of outputs || []) {
    if (!o) continue;
    if (o.path || o.url) return o;
    if (o.video && (o.video.path || o.video.url)) return o.video;
    if (o.image && (o.image.path || o.image.url)) return o.image;
  }
  return null;
}
function fileDownloadUrl(host, f) {
  if (f.url && /^https?:\/\//i.test(f.url)) return f.url;
  if (f.url && f.url.startsWith('/')) return host + f.url;
  if (f.path) return `${host}/gradio_api/file=${f.path}`;
  if (f.url) return `${host}/${f.url}`;
  return null;
}
async function downloadSpaceFile(host, token, f, destPath, what) {
  const url = fileDownloadUrl(host, f);
  if (!url) throw new EngineError(`The Space finished but returned no downloadable file for ${what}.`, false);
  let r;
  try {
    r = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, 300000);
  } catch (e) { throw new EngineError(`Connection failed while downloading ${what} (${e.message}).`, true); }
  if (!r.ok) throw classifyHttp(r.status, `downloading ${what}`);
  fs.writeFileSync(destPath, Buffer.from(await r.arrayBuffer()));
}

// ---------- ffmpeg helpers ----------
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
async function extractFrame(videoPath, outPath, last) {
  const args = last
    ? ['-y', '-sseof', '-0.5', '-i', videoPath, '-frames:v', '1', '-q:v', '2', outPath]
    : ['-y', '-i', videoPath, '-frames:v', '1', '-q:v', '2', outPath];
  await ffmpeg(args);
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) throw new Error('Frame extraction produced no file.');
}
async function extractLastFrame(videoPath, outPath) {
  try { await extractFrame(videoPath, outPath, true); }
  catch (e) { await extractFrame(videoPath, outPath, false); }
}

// ---------- pipeline steps ----------
// Generate the job's single start image from its prompt with the image Space.
async function generateStartImage(cfg, job, jobDir) {
  const dest = path.join(jobDir, 'start-image.png');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const space = cfg.imageSpace || DEFAULT_IMAGE_SPACE;
  const { host, config } = await fetchSpaceConfig(space, cfg.hf.token);
  const dep = findGenerateDep(config);
  if (!dep) throw new EngineError(`The image Space "${space}" exposes no usable generate endpoint.`, false);
  const data = buildDataFromConfig(config, dep, imageFill({ promptText: job.prompt, width: 1024, height: 576 }));
  const outputs = await gradioCall(host, cfg.hf.token, dep, data);
  const file = firstFileData(outputs);
  if (!file) throw new EngineError('The image Space finished but returned no image.', false);
  await downloadSpaceFile(host, cfg.hf.token, file, dest, 'the generated start image');
  return dest;
}

// Start image for chunk 1: reference image > reference video's first frame >
// image generated from the prompt. (Only used when the Space needs an image.)
async function resolveJobStartImage(cfg, job, jobDir) {
  if (job.ref_image && fs.existsSync(job.ref_image)) return job.ref_image;
  if (job.ref_video && fs.existsSync(job.ref_video)) {
    const dest = path.join(jobDir, 'start-image.png');
    if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
      try { await extractFrame(job.ref_video, dest, false); }
      catch (e) { throw new EngineError(`Could not read a frame from the reference video: ${e.message}`, false); }
    }
    return dest;
  }
  return generateStartImage(cfg, job, jobDir);
}

function imageMime(p) {
  if (/\.png$/i.test(p)) return 'image/png';
  if (/\.webp$/i.test(p)) return 'image/webp';
  return 'image/jpeg';
}

async function runVideoChunk(cfg, vctx, job, chunkSeconds, startImagePath) {
  const { host, config, dep } = vctx;
  let startFileData = null;
  if (startImagePath) {
    startFileData = await gradioUpload(host, cfg.hf.token, startImagePath, imageMime(startImagePath));
  }
  const voiceNote = job.voice_lang === 'bn' ? ' Dialogue and voice in Bengali language.' : ' Dialogue and voice in English language.';
  const data = buildDataFromConfig(config, dep, videoFill({
    promptText: job.prompt + voiceNote, seconds: chunkSeconds, startFileData,
  }));
  const outputs = await gradioCall(host, cfg.hf.token, dep, data);
  const file = firstFileData(outputs);
  if (!file) throw new EngineError('The Space finished but returned no video file.', false);
  return { host, file };
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

// Shared failure path: retryable errors park the job in the "waking" state
// with exponential backoff until the wake window expires; anything else is a
// genuine failure (real reason stored + automatic refund via failJob).
async function handleJobFailure(job, e) {
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
    return;
  }
  await failJob(job, (e && e.message) || String(e));
}

async function advanceJob(job, cfg) {
  const jobDir = path.join(UPLOAD_DIR, `job-${job.id}`);
  fs.mkdirSync(jobDir, { recursive: true });

  // Resolve the video Space once per advance: its config drives the chunk
  // size, the parameter payload and whether a start image is required.
  let vctx;
  try {
    const { host, config } = await fetchSpaceConfig(cfg.hf.space, cfg.hf.token);
    const dep = findGenerateDep(config);
    if (!dep) throw new EngineError(`The Space "${cfg.hf.space}" exposes no usable generate endpoint in its config.`, false);
    vctx = { host, config, dep, cap: chunkCapSeconds(config, dep), needsImage: depHasImageInput(config, dep) };
  } catch (e) { await handleJobFailure(job, e); return; }

  const total = Math.max(1, Math.ceil(job.duration_sec / vctx.cap));
  if (total !== (job.progress_total || 0)) {
    touchJob(job.id, { progress_total: total });
    job.progress_total = total;
  }
  let done = job.progress_done || 0;

  // Start image for the next chunk: chunk 1 uses the job's start image;
  // later chunks chain from the previous chunk's last frame. A true
  // text-to-video Space (no image input) skips all of this.
  let startImagePath = null;
  if (vctx.needsImage) {
    try {
      if (done === 0) {
        startImagePath = await resolveJobStartImage(cfg, job, jobDir);
      } else {
        const framePath = path.join(jobDir, `last-frame-${done - 1}.png`);
        if (!fs.existsSync(framePath) || fs.statSync(framePath).size === 0) {
          await extractLastFrame(path.join(jobDir, `chunk-${done - 1}.mp4`), framePath);
        }
        startImagePath = framePath;
      }
    } catch (e) { await handleJobFailure(job, e); return; }
  }

  while (done < total) {
    const chunkSeconds = Math.min(vctx.cap, job.duration_sec - done * vctx.cap);
    const dest = path.join(jobDir, `chunk-${done}.mp4`);
    try {
      if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
        const result = await runVideoChunk(cfg, vctx, job, chunkSeconds, startImagePath);
        await downloadSpaceFile(result.host, cfg.hf.token, result.file, dest, 'the generated chunk');
      }
      if (done + 1 < total && vctx.needsImage) {
        const framePath = path.join(jobDir, `last-frame-${done}.png`);
        if (!fs.existsSync(framePath) || fs.statSync(framePath).size === 0) {
          await extractLastFrame(dest, framePath);
        }
        startImagePath = framePath;
      }
    } catch (e) { await handleJobFailure(job, e); return; }
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
  DEFAULT_HF_SPACE, DEFAULT_IMAGE_SPACE, UPLOAD_DIR, encryptSecret, getEngineConfig, enginePublicState,
  testHf, testFal, startWorker, tickEngine,
  setSetting, deleteSetting,
  _internals: {
    resolveSpaceHost, fetchSpaceConfig, findGenerateDep, buildDataFromConfig,
    videoFill, imageFill, chunkCapSeconds, depHasImageInput, parseQueueMessage,
  },
};
