'use strict';
let LANG = localStorage.getItem('vyrx_lang') || 'en';
let ME = null;
let SUPPORT_UNREAD = 0;
const $app = document.getElementById('app');
const $bar = document.getElementById('topbar');
const T = (k) => t(LANG, k);

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
function setLang(l) {
  LANG = l; localStorage.setItem('vyrx_lang', l);
  document.documentElement.lang = l;
  document.documentElement.dir = RTL_LANGS.includes(l) ? 'rtl' : 'ltr';
  renderBar(); render();
}
async function loadMe() {
  try { const d = await api('/api/me'); ME = d.user; SUPPORT_UNREAD = d.supportUnread || 0; if (ME && ME.language && ME.language !== LANG) { LANG = ME.language; localStorage.setItem('vyrx_lang', LANG); } } catch (e) { ME = null; }
  document.documentElement.dir = RTL_LANGS.includes(LANG) ? 'rtl' : 'ltr';
}

let VIEW = 'home';
function go(v) { VIEW = v; render(); window.scrollTo(0, 0); }

function renderBar() {
  const langOpts = LANGS.map(([v, n]) => `<option value="${v}" ${v === LANG ? 'selected' : ''}>${n}</option>`).join('');
  let nav = '';
  if (ME) {
    nav = `
      <button data-go="home" class="${VIEW === 'home' ? 'active' : ''}">${T('home')}</button>
      ${ME.status === 'active' || ME.role === 'admin' ? `<button data-go="create" class="${VIEW === 'create' ? 'active' : ''}">${T('createVideo')}</button>
      <button data-go="videos" class="${VIEW === 'videos' ? 'active' : ''}">${T('myVideos')}</button>
      <button data-go="credits" class="${VIEW === 'credits' ? 'active' : ''}">${T('credits')}</button>` : ''}
      <button data-go="support" class="${VIEW === 'support' ? 'active' : ''}">${T('support')}${SUPPORT_UNREAD ? `<span class="badge">${SUPPORT_UNREAD}</span>` : ''}</button>
      ${ME.role === 'admin' ? `<button data-go="admin" class="${VIEW === 'admin' ? 'active' : ''}">${T('admin')}</button>` : ''}
      <span class="pill credits-pill">◆ ${ME.credits} ${T('credits')}</span>
      <button id="logoutBtn">${T('logout')}</button>`;
  } else {
    nav = `<button data-go="login" class="${VIEW === 'login' ? 'active' : ''}">${T('login')}</button>
           <button data-go="signup" class="${VIEW === 'signup' ? 'active' : ''}">${T('signup')}</button>
           <button data-go="adminlogin" class="${VIEW === 'adminlogin' ? 'active' : ''}">${T('admin')}</button>`;
  }
  $bar.innerHTML = `<div class="bar">
    <div class="logo"><span class="dot"></span>VYRX&nbsp;<b>STUDIO</b></div>
    <span class="globe">🌐</span><select class="lang" id="langSel">${langOpts}</select>
    <nav>${nav}</nav></div>`;
  document.getElementById('langSel').onchange = (e) => setLang(e.target.value);
  $bar.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  const lo = document.getElementById('logoutBtn');
  if (lo) lo.onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); ME = null; go('home'); };
}

function flash(kind, msg) { return msg ? `<div class="${kind}">${esc(msg)}</div>` : ''; }
let FLASH = { kind: '', msg: '' };

function viewHome() {
  return `<div class="hero"><h1>${esc(T('heroTitle')).replace('video', '<span>video</span>')}</h1><p>${T('heroSub')}</p>
  ${ME ? `<button class="btn" onclick="go('create')">${T('createVideo')}</button>` : `<button class="btn" onclick="go('signup')">${T('getStarted')}</button>`}
  ${SUPPORT_UNREAD && ME ? `<div class="notice">${T('unreadNotice')}</div>` : ''}</div>
  <div class="card"><h2>${T('howItWorks')}</h2><ol class="steps"><li>${T('how1')}</li><li>${T('how2')}</li><li>${T('how3')}</li><li>${T('how4')}</li></ol></div>
  <div class="card"><h2>${T('faq')}</h2>
  <details><summary>${T('faqQ1')}</summary><p class="small">${T('faqA1')}</p></details>
  <details><summary>${T('faqQ2')}</summary><p class="small">${T('faqA2')}</p></details>
  <details><summary>${T('faqQ3')}</summary><p class="small">${T('faqA3')}</p></details>
  <details><summary>${T('faqQ4')}</summary><p class="small">${T('faqA4')}</p></details></div>`;
}

function viewLogin(adminOnly) {
  return `<div class="card"><h2>${adminOnly ? T('adminLoginTitle') : T('login')}</h2>${flash(FLASH.kind, FLASH.msg)}
  <form id="loginForm"><label>${T('email')}</label><input name="email" type="email" required>
  <label>${T('password')}</label><input name="password" type="password" required>
  <p style="margin-top:16px"><button class="btn" type="submit">${T('login')}</button>
  <a href="#" id="forgotLink" style="margin-inline-start:14px">${T('forgot')}</a></p></form>
  ${adminOnly ? '' : `<p class="small">${T('noAccount')} <a href="#" onclick="go('signup');return false">${T('signup')}</a></p>`}
  <div id="resetBox"></div></div>`;
}
function bindLogin(adminOnly) {
  const f = document.getElementById('loginForm'); if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    try {
      const d = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }) });
      ME = d.user; FLASH = { kind: '', msg: '' };
      go(ME.role === 'admin' ? 'admin' : 'create');
    } catch (err) { FLASH = { kind: 'error', msg: err.message }; render(); }
  };
  document.getElementById('forgotLink').onclick = (e) => {
    e.preventDefault();
    document.getElementById('resetBox').innerHTML = `<h3>${T('resetTitle')}</h3>
    <form id="forgotForm"><label>${T('email')}</label><input name="email" type="email" required>
    <p><button class="btn ghost" type="submit">${T('resetSend')}</button></p></form>
    <form id="resetForm"><label>${T('resetCode')}</label><input name="code" required>
    <label>${T('newPassword')}</label><input name="newPassword" type="password" required>
    <p><button class="btn" type="submit">${T('resetApply')}</button></p></form>`;
    document.getElementById('forgotForm').onsubmit = async (ev) => { ev.preventDefault(); const fd = new FormData(ev.target); await api('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email: fd.get('email') }) }); alert('Code sent (if the account exists).'); };
    document.getElementById('resetForm').onsubmit = async (ev) => { ev.preventDefault(); const em = new FormData(document.getElementById('forgotForm')).get('email'); const fd = new FormData(ev.target); try { await api('/api/auth/reset', { method: 'POST', body: JSON.stringify({ email: em, code: fd.get('code'), newPassword: fd.get('newPassword') }) }); FLASH = { kind: 'success', msg: 'Password changed. Please log in.' }; render(); } catch (err) { alert(err.message); } };
  };
}

function viewSignup() {
  return `<div class="card"><h2>${T('signup')}</h2>${flash(FLASH.kind, FLASH.msg)}
  <form id="signupForm"><label>${T('name')}</label><input name="name" required>
  <label>${T('email')}</label><input name="email" type="email" required>
  <label>${T('password')}</label><input name="password" type="password" required minlength="6">
  <p style="margin-top:16px"><button class="btn" type="submit">${T('signup')}</button></p></form>
  <p class="small">${T('haveAccount')} <a href="#" onclick="go('login');return false">${T('login')}</a></p></div>`;
}
function bindSignup() {
  const f = document.getElementById('signupForm'); if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(f);
    try {
      await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ name: fd.get('name'), email: fd.get('email'), password: fd.get('password'), language: LANG }) });
      FLASH = { kind: 'success', msg: T('pendingMsg') }; go('login');
    } catch (err) { FLASH = { kind: 'error', msg: err.message }; render(); }
  };
}

let DUR = 30;
function viewCreate() {
  const cost = Math.max(1, Math.round(DUR * 50 / 60));
  return `<div class="card"><h2>${T('createVideo')}</h2>${flash(FLASH.kind, FLASH.msg)}
  <form id="jobForm">
  <label>${T('promptLabel')}</label><textarea name="prompt" required placeholder="${T('promptPh')}"></textarea>
  <label>${T('duration')}: <b id="durLabel">${Math.floor(DUR / 60)}:${String(DUR % 60).padStart(2, '0')}</b> — ${T('estCost')}: <b id="durCost">${cost} ${T('credits')}</b></label>
  <input type="range" id="durRange" min="1" max="1200" value="${DUR}">
  <div class="row"><div><label>${T('minutes')}</label><input type="number" id="durMin" min="0" max="20" value="${Math.floor(DUR / 60)}"></div>
  <div><label>${T('seconds')}</label><input type="number" id="durSec" min="0" max="59" value="${DUR % 60}"></div></div>
  <div class="row"><div><label>${T('refImage')}</label><input type="file" name="refImage" accept="image/*"></div>
  <div><label>${T('refVideo')}</label><input type="file" name="refVideo" accept="video/*"></div></div>
  <div id="refPreview"></div>
  <div class="row"><div><label>${T('voiceLang')}</label><select class="field" name="voiceLang"><option value="bn">${T('bengali')}</option><option value="en">${T('english')}</option></select></div>
  <div><label>${T('model')}</label><select class="field" name="model"><option value="wan">Wan 3.0</option><option value="kling">Kling 3.0</option></select></div></div>
  <p style="margin-top:18px"><button class="btn" type="submit">${T('generate')}</button>
  <span class="small" style="margin-inline-start:10px">${T('balance')}: ◆ ${ME.credits} · ${T('dailyNote')}</span></p></form></div>`;
}
function bindCreate() {
  const form = document.getElementById('jobForm'); if (!form) return;
  const sync = (sec) => { DUR = Math.max(1, Math.min(1200, sec || 1)); render(); };
  document.getElementById('durRange').oninput = (e) => { DUR = Number(e.target.value); document.getElementById('durLabel').textContent = `${Math.floor(DUR / 60)}:${String(DUR % 60).padStart(2, '0')}`; document.getElementById('durMin').value = Math.floor(DUR / 60); document.getElementById('durSec').value = DUR % 60; document.getElementById('durCost').textContent = `${Math.max(1, Math.round(DUR * 50 / 60))} ${T('credits')}`; };
  document.getElementById('durMin').onchange = (e) => sync(Number(e.target.value) * 60 + (DUR % 60));
  document.getElementById('durSec').onchange = (e) => sync(Math.floor(DUR / 60) * 60 + Number(e.target.value));
  form.refImage.onchange = form.refVideo.onchange = (e) => {
    const f = e.target.files[0]; const box = document.getElementById('refPreview');
    if (!f) { box.innerHTML = ''; return; }
    const url = URL.createObjectURL(f);
    box.innerHTML = f.type.startsWith('image') ? `<img src="${url}" style="max-width:220px;border-radius:10px;margin-top:8px">` : `<video src="${url}" controls style="max-width:300px"></video>`;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form); fd.append('durationSec', DUR);
    try {
      const r = await fetch('/api/jobs', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      ME.credits = d.balance;
      FLASH = { kind: 'success', msg: `${T('jobCreated')} #${d.jobId} — ${d.cost} ${T('creditsDeducted')}: ${d.balance}` };
      go('videos');
    } catch (err) { FLASH = { kind: 'error', msg: err.message }; render(); }
  };
}

let JOBS = [];
async function loadJobs() { const d = await api('/api/jobs'); JOBS = d.jobs; }
function jobStatusHtml(j) {
  if (j.status === 'done') return `<span class="tag done">${T('status_done')}</span>`;
  if (j.status === 'failed') return `<span class="tag failed">${T('status_failed')}</span>`;
  if (j.status === 'waiting_engine') return `<span class="tag">${T('status_waiting_engine')}</span>`;
  if (j.stage === 'waking') return `<span class="tag processing">${T('stage_waking')}</span>`;
  if (j.stage === 'stitching') return `<span class="tag processing">${T('stage_stitching')}</span>`;
  return `<span class="tag processing">${T('status_processing')}${j.progress_total ? ` — ${T('part')} ${j.progress_done} ${T('of')} ${j.progress_total}` : ''}</span>`;
}
function viewVideos() {
  const list = JOBS.map((j) => `<div class="job"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(j.prompt.slice(0, 90))}${j.prompt.length > 90 ? '…' : ''}</b>${jobStatusHtml(j)}</div>
  <div class="meta">${j.duration_sec} sec · ${j.model === 'kling' ? 'Kling 3.0' : 'Wan 3.0'} · Voice: ${j.voice_lang === 'bn' ? T('bengali') : T('english')} · ${j.cost} ${T('credits')} · ${esc(j.created_at)}</div>
  ${j.progress_total > 1 && j.status === 'processing' ? `<div class="progress"><i style="width:${Math.round(j.progress_done / j.progress_total * 100)}%"></i></div>` : ''}
  ${j.status === 'done' ? `<video controls src="/api/jobs/${j.id}/video"></video><p><a class="btn ghost" href="/api/jobs/${j.id}/video">${T('download')}</a></p>` : ''}
  ${j.status === 'failed' ? `<div class="refunded">${T('refundNote')}</div>${j.error ? `<div class="why"><b>${T('whyFailed')}:</b> ${esc(j.error)}</div>` : ''}` : ''}</div>`).join('');
  return `<div class="card wide"><h2>${T('myVideos')}</h2>${flash(FLASH.kind, FLASH.msg)}
  <p><button class="btn" onclick="go('create')">+ ${T('createVideo')}</button></p>
  ${JOBS.length ? list : `<p class="small">${T('noVideos')}</p>`}</div>`;
}

let LEDGER = [];
function viewCredits() {
  const rows = LEDGER.map((r) => `<tr><td>${r.delta >= 0 ? '+' : ''}${r.delta}</td><td>${esc(r.reason)}</td><td>${r.balance_after}</td><td>${esc(r.created_at)}</td></tr>`).join('');
  return `<div class="card wide"><h2>${T('credits')}</h2><p><b style="font-size:22px">◆ ${ME.credits}</b> <span class="small">${T('dailyNote')}</span></p>
  <h3>${T('ledger')}</h3><table><tr><th>+/−</th><th>${T('subject')}</th><th>${T('balance')}</th><th>${T('time')}</th></tr>${rows}</table></div>`;
}

let MY_TICKETS = [];
function viewSupport() {
  const list = MY_TICKETS.map((tk) => `<div class="job"><b>${esc(tk.subject)}</b> <span class="tag">${esc(tk.status)}</span>
    <div class="thread">${tk.messages.map((m) => `<div class="msg ${m.sender}"><div class="who">${m.sender === 'admin' ? 'VYRX Studio Support' : ME.name || 'You'} · ${esc(m.created_at)}</div>${esc(m.body)}</div>`).join('')}</div>
    <form class="replyForm" data-id="${tk.id}"><div class="row"><div><input name="message" placeholder="${T('message')}" required></div><div style="flex:0"><button class="btn ghost">${T('sendReply')}</button></div></div></form></div>`).join('');
  return `<div class="card wide"><h2>${T('support')}</h2>${flash(FLASH.kind, FLASH.msg)}
  <form id="ticketForm"><label>${T('subject')}</label><input name="subject" required>
  <label>${T('message')}</label><textarea name="message" required></textarea>
  <p><button class="btn">${T('send')}</button></p></form>
  <h3>${T('yourTickets')}</h3>${MY_TICKETS.length ? list : `<p class="small">${T('noTickets')}</p>`}</div>`;
}
function bindSupport() {
  const f = document.getElementById('ticketForm');
  if (f) f.onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(f); await api('/api/support', { method: 'POST', body: JSON.stringify({ subject: fd.get('subject'), message: fd.get('message') }) }); FLASH = { kind: 'success', msg: 'Sent.' }; render(); };
  document.querySelectorAll('.replyForm').forEach((rf) => (rf.onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(rf); await api(`/api/support/${rf.dataset.id}/reply`, { method: 'POST', body: JSON.stringify({ message: fd.get('message') }) }); render(); }));
  MY_TICKETS.filter((tk) => tk.user_unread = 0);
  MY_TICKETS.forEach((tk) => api(`/api/support/${tk.id}/seen`, { method: 'POST' }).catch(() => {}));
  SUPPORT_UNREAD = 0;
}

// ---------------- Admin ----------------
let ADMIN_TAB = 'users';
let ADMIN_DATA = null, ADMIN_EMAILS = [], ADMIN_TICKETS = [], ENGINE = null;
async function loadAdmin() {
  ADMIN_DATA = await api('/api/admin/data');
  ADMIN_EMAILS = (await api('/api/admin/emails')).emails;
  ADMIN_TICKETS = (await api('/api/admin/support')).tickets;
  ENGINE = (await api('/api/admin/engine')).engine;
}
function userRow(u) {
  const st = u.status === 'active' ? T('active') : u.status === 'pending' ? T('pending') : u.status === 'banned' ? T('banned') : T('rejected');
  return `<tr><td><b>${esc(u.name)}</b><br><span class="small">${esc(u.email)}</span></td>
  <td>${st}</td><td>◆ ${u.credits}</td><td>${u.videos} ${T('videos')}</td>
  <td>${u.status === 'pending' ? `<button class="btn ghost" data-act="active" data-id="${u.id}">${T('approve')}</button> <button class="btn ghost" data-act="rejected" data-id="${u.id}">${T('reject')}</button>` : ''}
  ${u.status === 'active' ? `<button class="btn ghost" data-act="banned" data-id="${u.id}">${T('ban')}</button>` : ''}
  ${u.status === 'banned' ? `<button class="btn ghost" data-act="active" data-id="${u.id}">${T('unban')}</button>` : ''}
  <button class="btn ghost" data-adjust="${u.id}">${T('adjustCredits')}</button></td></tr>`;
}
function viewAdmin() {
  if (!ADMIN_DATA) return `<div class="card"><p>Loading…</p></div>`;
  const s = ADMIN_DATA.stats;
  let body = '';
  if (ADMIN_TAB === 'users') {
    const pending = ADMIN_DATA.users.filter((u) => u.status === 'pending');
    body = `<div class="grid"><div class="stat"><b>${s.users}</b><span>${T('totalUsers')}</span></div>
    <div class="stat"><b>${s.pending}</b><span>${T('pendingApprovals')}</span></div>
    <div class="stat"><b>${s.videos}</b><span>${T('totalVideos')}</span></div>
    <div class="stat"><b>${s.creditsSpent}</b><span>${T('creditsSpent')}</span></div></div>
    ${pending.length ? `<h3>${T('pendingList')}</h3><table>${pending.map(userRow).join('')}</table>` : ''}
    <h3>${T('usersList')}</h3><table><tr><th>${T('name')}</th><th>${T('status')}</th><th>${T('credits')}</th><th></th><th>${T('actions')}</th></tr>${ADMIN_DATA.users.map(userRow).join('')}</table>
    <div id="adjustBox"></div>`;
  } else if (ADMIN_TAB === 'emails') {
    body = `<h3>${T('emailsLog')}</h3><p class="small">Approval, rejection, ban, credit and alert emails are recorded here. Status stays "Queued" until an SMTP server is configured.</p>
    <table><tr><th>${T('to')}</th><th>${T('subject')}</th><th>${T('kind')}</th><th>${T('status')}</th><th>${T('time')}</th></tr>
    ${ADMIN_EMAILS.map((e) => `<tr><td>${esc(e.to_addr)}</td><td>${esc(e.subject)}</td><td>${esc(e.kind)}</td><td>${esc(e.status)}</td><td>${esc(e.created_at)}</td></tr>`).join('')}</table>`;
  } else if (ADMIN_TAB === 'support') {
    body = `<h3>${T('supportInbox')}</h3>` + ADMIN_TICKETS.map((tk) => `<div class="job"><b>${esc(tk.subject)}</b> <span class="small">— ${esc(tk.user_name)}</span> <span class="tag">${esc(tk.status)}</span>
    <div class="thread">${tk.messages.map((m) => `<div class="msg ${m.sender}"><div class="who">${m.sender} · ${esc(m.created_at)}</div>${esc(m.body)}</div>`).join('')}</div>
    <form class="adminReply" data-id="${tk.id}"><div class="row"><div><input name="message" required placeholder="${T('message')}"></div><div style="flex:0"><button class="btn ghost">${T('sendReply')}</button></div></div></form></div>`).join('');
  } else if (ADMIN_TAB === 'engine') {
    const e = ENGINE;
    body = `<h3>${T('engineSettings')}</h3><p class="small">${T('engineNote')}</p>
    <p>${T('activeEngine')}: <b>${e.activeEngine === 'hf' ? T('freeEngine') : T('falEngine')}</b></p>
    <div class="job"><b>${T('freeEngine')}</b> — ${e.hf.connected ? `<span class="tag done">${T('connected')} ✓ (••••${esc(e.hf.last4)})</span>` : `<span class="tag">${T('notConnected')}</span>`}
    <form id="hfForm"><label>${T('hfToken')}</label><input name="hfToken" type="password" placeholder="Paste the token (starts with hf_…)">
    <label>${T('hfSpace')}</label><input name="hfSpace" value="${esc(e.hf.space)}">
    <p><button class="btn">${T('save')}</button>
    <button type="button" class="btn ghost" data-test="hf">${T('testConnection')}</button>
    <button type="button" class="btn ghost" data-use="hf">Use this engine</button>
    <button type="button" class="btn ghost" data-disc="hf">${T('disconnect')}</button></p></form><div class="testOut small"></div></div>
    <div class="job"><b>${T('falEngine')}</b> — ${e.fal.connected ? `<span class="tag done">${T('connected')} ✓ (••••${esc(e.fal.last4)})</span>` : `<span class="tag">${T('notConnected')}</span>`}
    <form id="falForm"><label>${T('falKey')}</label><input name="falKey" type="password" placeholder="Paste the fal.ai key">
    <p><button class="btn">${T('save')}</button>
    <button type="button" class="btn ghost" data-test="fal">${T('testConnection')}</button>
    <button type="button" class="btn ghost" data-use="fal">Use this engine</button>
    <button type="button" class="btn ghost" data-disc="fal">${T('disconnect')}</button></p></form><div class="testOut small"></div></div>`;
  }
  return `<div class="card wide"><h2>${T('adminTitle')}</h2>${flash(FLASH.kind, FLASH.msg)}
  <nav style="margin:0 0 16px"><button data-tab="users" class="${ADMIN_TAB === 'users' ? 'active' : ''}">${T('usersList')}</button>
  <button data-tab="support" class="${ADMIN_TAB === 'support' ? 'active' : ''}">${T('supportInbox')}</button>
  <button data-tab="emails" class="${ADMIN_TAB === 'emails' ? 'active' : ''}">${T('emailsLog')}</button>
  <button data-tab="engine" class="${ADMIN_TAB === 'engine' ? 'active' : ''}">${T('engineSettings')}</button></nav>${body}</div>`;
}
function bindAdmin() {
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { ADMIN_TAB = b.dataset.tab; render(); }));
  document.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
    await api('/api/admin/set-status', { method: 'POST', body: JSON.stringify({ userId: Number(b.dataset.id), status: b.dataset.act }) });
    await loadAdmin(); render();
  }));
  document.querySelectorAll('[data-adjust]').forEach((b) => (b.onclick = () => {
    const u = ADMIN_DATA.users.find((x) => x.id === Number(b.dataset.adjust));
    const box = document.getElementById('adjustBox');
    box.innerHTML = `<div class="job"><b>${T('adjustCredits')} — ${esc(u.name)} (${esc(u.email)})</b>
    <form id="adjForm"><label>${T('amount')}</label><input name="amount" type="number" required>
    <p class="small">${T('balance')}: ◆ ${u.credits} → <b id="adjNew"></b></p>
    <button class="btn">${T('confirmAdjust')}</button></form></div>`;
    const inp = box.querySelector('[name=amount]'); const out = box.querySelector('#adjNew');
    inp.oninput = () => { out.textContent = '◆ ' + Math.max(0, u.credits + (Number(inp.value) || 0)); };
    box.querySelector('#adjForm').onsubmit = async (e) => { e.preventDefault(); const d = await api('/api/admin/adjust-credits', { method: 'POST', body: JSON.stringify({ userId: u.id, amount: Number(inp.value) }) }); FLASH = { kind: 'success', msg: `${u.name}: ◆ ${d.balance}` }; await loadAdmin(); render(); };
  }));
  document.querySelectorAll('.adminReply').forEach((f) => (f.onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(f); await api(`/api/admin/support/${f.dataset.id}/reply`, { method: 'POST', body: JSON.stringify({ message: fd.get('message') }) }); await loadAdmin(); render(); }));
  const hfForm = document.getElementById('hfForm');
  if (hfForm) hfForm.onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(hfForm); await api('/api/admin/engine/save', { method: 'POST', body: JSON.stringify({ hfToken: fd.get('hfToken'), hfSpace: fd.get('hfSpace') }) }); await loadAdmin(); render(); };
  const falForm = document.getElementById('falForm');
  if (falForm) falForm.onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(falForm); await api('/api/admin/engine/save', { method: 'POST', body: JSON.stringify({ falKey: fd.get('falKey') }) }); await loadAdmin(); render(); };
  document.querySelectorAll('[data-test]').forEach((b) => (b.onclick = async () => { const out = b.closest('.job').querySelector('.testOut'); out.textContent = 'Testing…'; const d = await api('/api/admin/engine/test', { method: 'POST', body: JSON.stringify({ which: b.dataset.test }) }); out.textContent = (d.ok ? '✓ ' : '✗ ') + (d.detail || ''); }));
  document.querySelectorAll('[data-use]').forEach((b) => (b.onclick = async () => { await api('/api/admin/engine/save', { method: 'POST', body: JSON.stringify({ activeEngine: b.dataset.use }) }); await loadAdmin(); render(); }));
  document.querySelectorAll('[data-disc]').forEach((b) => (b.onclick = async () => { await api('/api/admin/engine/disconnect', { method: 'POST', body: JSON.stringify({ which: b.dataset.disc }) }); await loadAdmin(); render(); }));
}

let ADMIN_STATE = null;
function viewAdminSetup() {
  return `<div class="card"><h2>${T('adminSetupTitle')}</h2>${flash(FLASH.kind, FLASH.msg)}<p class="small">${T('adminSetupNote')}</p>
  <form id="setupForm"><label>${T('newPassword')}</label><input name="password" type="password" required minlength="6">
  <p style="margin-top:14px"><button class="btn">${T('setPassword')}</button></p></form></div>`;
}
function bindAdminSetup() {
  const f = document.getElementById('setupForm'); if (!f) return;
  f.onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(f); try { await api('/api/admin/setup', { method: 'POST', body: JSON.stringify({ password: fd.get('password') }) }); await loadMe(); go('admin'); } catch (err) { FLASH = { kind: 'error', msg: err.message }; render(); } };
}

let pollTimer = null;
async function render() {
  renderBar();
  clearInterval(pollTimer);
  if (VIEW === 'home') $app.innerHTML = viewHome();
  else if (VIEW === 'login') { $app.innerHTML = viewLogin(false); bindLogin(false); }
  else if (VIEW === 'adminlogin') {
    if (!ADMIN_STATE) ADMIN_STATE = await api('/api/admin/state').catch(() => ({ adminNeedsSetup: false }));
    if (ADMIN_STATE.adminNeedsSetup) { $app.innerHTML = viewAdminSetup(); bindAdminSetup(); }
    else { $app.innerHTML = viewLogin(true); bindLogin(true); }
  } else if (VIEW === 'signup') { $app.innerHTML = viewSignup(); bindSignup(); }
  else if (VIEW === 'create') { if (!ME) VIEW = 'login', render(); else { $app.innerHTML = viewCreate(); bindCreate(); } }
  else if (VIEW === 'videos') { await loadJobs(); $app.innerHTML = viewVideos(); FLASH = { kind: '', msg: '' }; pollTimer = setInterval(async () => { if (VIEW === 'videos') { await loadJobs(); $app.innerHTML = viewVideos(); } }, 15000); }
  else if (VIEW === 'credits') { LEDGER = (await api('/api/ledger')).ledger; $app.innerHTML = viewCredits(); }
  else if (VIEW === 'support') { MY_TICKETS = (await api('/api/support/mine')).tickets; $app.innerHTML = viewSupport(); bindSupport(); await loadMe(); renderBar(); }
  else if (VIEW === 'admin') { if (!ME || ME.role !== 'admin') { VIEW = 'adminlogin'; render(); } else { await loadAdmin(); $app.innerHTML = viewAdmin(); bindAdmin(); } }
  if (VIEW !== 'videos' && VIEW !== 'login' && VIEW !== 'signup' && VIEW !== 'adminlogin') FLASH = { kind: '', msg: '' };
}

(async () => { await loadMe(); render(); })();
