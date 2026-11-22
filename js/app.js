window.__boot = 1;
/* ===== "Connect with GitHub" setup (no-token login) =====
   1) GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
      Homepage URL + Authorization callback URL = the exact address of THIS page.
   2) Paste the Client ID below.
   3) GitHub needs a secret to turn the login code into a token, and a secret must never sit in a web page.
      So deploy the tiny proxy (Cloudflare Worker) from the notes and paste its URL as GH_AUTH_PROXY.
   While these two are empty, the Connect button explains what is missing and the token login still works. */

/* ===== Core: saare GitHub API calls gh() se jaate hain ===== */
const API = 'https://api.github.com';
let token = '', me = null, allRepos = [], repo = null, branch = '', path = '', cur = [], sel = new Set(), selMode = false, editSha = null, busy = false, cancel = false, pend = null, upMode = 'zip', fv = 'all', lang = '', tab = 'files', pins = new Set(), reading = false;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cp = p => p.split('/').map(encodeURIComponent).join('/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const enc = s => { let x = ''; new TextEncoder().encode(s).forEach(c => x += String.fromCharCode(c)); return btoa(x); };
const dec = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), c => c.charCodeAt(0)));
const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
const show = (id, on = true) => $(id).classList.toggle('hide', !on);
const hash = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const LC = { HTML: '#e34c26', JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572a5', CSS: '#a855f7', Java: '#b07219', PHP: '#4f5d95', Shell: '#89e051' };
const lcol = l => LC[l] || `hsl(${hash(l) % 360} 80% 60%)`;
const ago = d => { const s = (Date.now() - new Date(d)) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : s < 2592000 ? Math.floor(s / 86400) + 'd ago' : new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
/* file size always in MB (e.g. 12.34 MB) */
const mb = n => Math.max(0.01, n / 1048576).toFixed(2) + ' MB';
/* ZIP library loads only when needed, so a slow CDN can never freeze the page */
async function needZip() {
  if (window.JSZip) return;
  for (const u of ['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js']) {
    try {
      await new Promise((ok, no) => { const t = setTimeout(no, 12000), e = document.createElement('script'); e.src = u; e.onload = () => { clearTimeout(t); ok(); }; e.onerror = () => { clearTimeout(t); no(); }; document.head.appendChild(e); });
      if (window.JSZip) return;
    } catch (e) {}
  }
  throw new Error('Could not load the ZIP tool. Check your internet or VPN and try again.');
}

function recUndo(b, a, m) { store.set('gz_undo', JSON.stringify({ repo, branch, before: b, after: a, msg: m })); }
async function gh(url, opt = {}) {
  const r = await fetch(url.startsWith('http') ? url : API + url, { ...opt, cache: 'no-store', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' } });
  if (r.status === 401 && token) { store.set('gm_token', ''); say('Login ended (revoked or suspended). Please connect again.', true); setTimeout(() => location.reload(), 2200); }
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.message || 'Request failed (' + r.status + ')'); }
  return r.status === 204 ? null : r.json();
}
let st;
function say(m, bad) { const s = $('status'); s.textContent = m; s.className = bad ? 'err' : ''; clearTimeout(st); st = setTimeout(() => show('status', false), bad ? 7000 : 3000); }

/* ===== Animated text helpers ===== */
const wave = (el, t) => el.innerHTML = [...t].map((c, i) => `<span style="animation-delay:${i * .09}s;color:hsl(${195 + (i * 7) % 30} 100% 72%)">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
function typer(el, list) {
  let i = 0, j = 0, del = false;
  (function tick() {
    const w = list[i]; j += del ? -1 : 1; el.textContent = w.slice(0, j); let d = del ? 30 : 65;
    if (!del && j === w.length) { del = true; d = 1500; } else if (del && j === 0) { del = false; i = (i + 1) % list.length; d = 350; }
    setTimeout(tick, d);
  })();
}
function countUp(el) {
  const n = +el.dataset.n, t0 = performance.now();
  (function f(t) { const k = Math.min(1, (t - t0) / 900); el.textContent = Math.round(n * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f); })(t0);
}
/* 3D tilt on any .tilt element */
document.addEventListener('pointermove', e => {
  const t = e.target.closest && e.target.closest('.tilt'); if (!t) return;
  const r = t.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  t.style.transform = `perspective(700px) rotateY(${x * 12}deg) rotateX(${-y * 12}deg) translateZ(6px)`;
});
document.addEventListener('pointerout', e => { const t = e.target.closest && e.target.closest('.tilt'); if (t && !t.contains(e.relatedTarget)) t.style.transform = ''; });

/* ===== Background: original falling-code rain ===== */
var BG = { t: null };
function bgRun() {
  const c = $('rain'); clearInterval(BG.t); const x = c.getContext('2d');
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) { c.classList.add('hide'); return; }
  c.classList.remove('hide'); c.width = innerWidth; c.height = innerHeight; x.clearRect(0, 0, c.width, c.height);
  const W = c.width, H = c.height, col = () => getComputedStyle(document.documentElement).getPropertyValue('--ac').trim() || '#0f0';
  const fs = 16, ch = '01{}<>/;=$#()[]ｱｲｳｴｵ'.split(''), D = Array.from({ length: Math.ceil(W / fs) }, () => Math.random() * -50);
  BG.t = setInterval(() => {
    x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(0, 0, W, H); x.fillStyle = col(); x.font = fs + 'px monospace';
    D.forEach((y, i) => { x.fillText(ch[Math.random() * ch.length | 0], i * fs, y * fs); D[i] = y * fs > H && Math.random() > .975 ? 0 : y + 1; });
  }, 55);
}
addEventListener('resize', bgRun); try { bgRun(); } catch (e) {}
try { pins = new Set(JSON.parse(store.get('gz_pins') || '[]')); } catch (e) {}

/* ===== Animated logo ===== */
const LOGO = '<svg class="gl" viewBox="0 0 100 100"><circle class="ring" cx="50" cy="50" r="47" fill="none" stroke-width="2" stroke-dasharray="6 8" stroke-linecap="round" style="stroke:var(--ac2)"/><circle cx="50" cy="50" r="40" stroke-width="2.5" style="fill:#08122b;stroke:var(--ac)"/><path transform="translate(22 22) scale(3.5)" style="fill:var(--ac)" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
try { document.querySelectorAll('.scene').forEach(e => e.innerHTML = LOGO);
wave($('ltitle'), 'github-zip-up');
typer($('tw'), ['$ unzip repo.zip && git push', '> uploads that never give up_', '// your repos, your rules']);
typer($('tw2'), ['$ drop zip --push', '> interrupted? auto-resume()', '// same file twice? skipped']); } catch (e) {}

/* ===== Login: do tareeqe (Connect with GitHub | Token) ===== */
function setLM(m) {
  store.set('gz_lm', m);
  document.querySelectorAll('#lmode button').forEach(b => b.classList.toggle('on', b.dataset.lm === m));
  show('pGh', m === 'gh'); show('pTok', m === 'tok'); $('lerr').textContent = '';
}
$('lmode').onclick = e => { const b = e.target.closest('button'); if (b) setLM(b.dataset.lm); };
setLM(store.get('gz_lm') === 'tok' ? 'tok' : 'gh');

async function connect(t) {
  token = t.trim(); $('lerr').textContent = '';
  if (!token) { $('lerr').textContent = '🔑 Pehle token banayein, phir upar paste karein.'; return; }
  try {
    me = await gh('/user');
    store.set('gm_token', token);
    show('login', false); show('app'); $('avi').src = me.avatar_url; wave($('hello'), '@' + me.login);
    await loadRepos();
  } catch (e) { if (e instanceof TypeError && offlineView()) return; if (/Bad credentials/i.test(e.message)) store.set('gm_token', ''); token = ''; $('lerr').textContent = 'Could not sign in: ' + e.message; }
}
$('connect').onclick = () => connect($('tok').value);
$('tok').onkeydown = e => { if (e.key === 'Enter') connect($('tok').value); };
$('eye').onclick = () => { const t = $('tok'); t.type = t.type === 'password' ? 'text' : 'password'; };

/* Connect with GitHub: person ko GitHub par bhejo, phir GitHub wapas ?code= ke saath bhejta hai */
async function oauthReturn() {
  const q = new URLSearchParams(location.search), code = q.get('code'), s = q.get('state'), er = q.get('error');
  if (!code && !er) return false;
  history.replaceState(null, '', location.pathname);
  let want = null; try { want = sessionStorage.getItem('gz_state'); sessionStorage.removeItem('gz_state'); } catch (e) {}
  if (er) { $('lerr').textContent = 'GitHub login cancel ho gaya.'; return true; }
  if (!want || want !== s) { $('lerr').textContent = 'Login check fail ho gaya. Dobara koshish karein.'; return true; }
  $('lerr').textContent = '⏳ GitHub se connect ho rahe hain…';
  try {
    const r = await fetch(GH_AUTH_PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, redirect_uri: redirUri() }) });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw new Error(j.error_description || j.error || 'No token received');
    await connect(j.access_token);
  } catch (e) { $('lerr').textContent = 'Connect nahi ho saka: ' + e.message; }
  return true;
}

$('logout').onclick = () => { try { localStorage.removeItem('gm_token'); sessionStorage.removeItem('gm_token'); } catch (e) {} location.reload(); };
$('refresh').onclick = () => { show('menu', false); loadRepos(); };
$('av').onclick = e => { e.stopPropagation(); $('menu').classList.toggle('hide'); };
addEventListener('click', e => { if (!e.target.closest('#menu')) show('menu', false); });

/* ===== Dashboard ===== */
async function loadRepos() {
  allRepos = [];
  for (let p = 1; p <= 5; p++) { const r = await gh(`/user/repos?per_page=100&sort=updated&page=${p}`); allRepos.push(...r); if (r.length < 100) break; }
  cacheRepos(); renderStats();
}
function renderStats() {
  const R = allRepos, n = f => R.filter(f).length, sum = k => R.reduce((a, r) => a + r[k], 0), pub = n(r => !r.private), pri = R.length - pub;
  const C = 2 * Math.PI * 40, a = (R.length ? pub / R.length : 0) * C;
  $('donut').innerHTML = `<svg viewBox="0 0 100 100" class="dn"><circle cx="50" cy="50" r="40" fill="none" stroke="#0b2a5a" stroke-width="12" opacity=".85"/><circle class="arc" cx="50" cy="50" r="40" fill="none" stroke="var(--ac2)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${a} ${C}" transform="rotate(-90 50 50)"/></svg><b class="disp">${R.length}</b>`;
  $('stats').innerHTML = [[200, R.length, '📁 Repos'], [215, pri, '🔒 Private'], [190, pub, '🌐 Public'], [225, sum('stargazers_count'), '⭐ Stars'], [205, sum('forks_count'), '🍴 Forks']]
    .map((t, i) => `<div class="tile card tilt" style="--h:${t[0]};animation-delay:${i * 80}ms"><b data-n="${t[1]}">0</b><span>${t[2]}</span></div>`).join('');
  document.querySelectorAll('#stats b').forEach(countUp);
  drawRepos();
}
function drawLang() {
  const cnt = {}; allRepos.forEach(r => r.language && (cnt[r.language] = (cnt[r.language] || 0) + 1));
  const L = Object.entries(cnt).sort((a, b) => b[1] - a[1]); show('langc', L.length > 0);
  $('lbar').innerHTML = L.map(([l, c]) => `<button class="${lang === l ? 'on' : ''}" data-l="${esc(l)}" style="flex:${c};background:${lcol(l)}" title="${esc(l)} ${c}"></button>`).join('');
  $('llegend').innerHTML = L.map(([l, c]) => `<button class="${lang === l ? 'on' : ''}" data-l="${esc(l)}"><span class="dot" style="background:${lcol(l)}"></span>${esc(l)} ${c}</button>`).join('');
}
function drawRepos() {
  const q = $('rq').value.toLowerCase(), s = $('fs').value, t = r => new Date(r.pushed_at || r.updated_at);
  const ok = r => (fv === 'all' || (fv === 'pub' && !r.private) || (fv === 'pri' && r.private) || (fv === 'fork' && r.fork)) && (!lang || r.language === lang) && r.full_name.toLowerCase().includes(q);
  const L = allRepos.filter(ok).sort((a, b) => (pins.has(b.full_name) - pins.has(a.full_name)) || (s === 'name' ? a.name.localeCompare(b.name) : s === 'star' ? b.stargazers_count - a.stargazers_count : t(b) - t(a)));
  document.querySelectorAll('#seg button').forEach(b => b.classList.toggle('on', b.dataset.v === fv)); drawLang();
  $('cnt').textContent = L.length + ' shown';
  $('rlist').innerHTML = L.map((r, i) => `<div class="rc card tilt" data-r="${esc(r.full_name)}" style="--h:${190 + hash(r.name) % 50};animation-delay:${Math.min(i, 10) * 50}ms"><div class="ic">${r.private ? '🔒' : '📘'}</div><div class="rb">
    <b>${esc(r.name)}</b><span class="pill ${r.private ? 'pr' : 'pu'}">${r.private ? 'Private' : 'Public'}</span>${r.fork ? '<span class="pill fk">Fork</span>' : ''}
    <div class="meta">${r.language ? `<span><span class="dot" style="background:${lcol(r.language)}"></span>${esc(r.language)}</span>` : ''}<span>⎇ ${esc(r.default_branch)}</span><span>${ago(r.pushed_at || r.updated_at)}</span><span>⭐ ${r.stargazers_count}</span><span>🍴 ${r.forks_count}</span></div></div>
    <button class="pin" data-pin="${esc(r.full_name)}" title="Pin">${pins.has(r.full_name) ? '📌' : '📍'}</button></div>`).join('') || '<div class="empty card">Kuch match nahi mila</div>';
}
$('rq').oninput = drawRepos; $('fs').oninput = drawRepos;
$('seg').onclick = e => { const b = e.target.closest('button'); if (b) { fv = b.dataset.v; drawRepos(); } };
$('vt').onclick = () => $('rlist').classList.toggle('l1');
const pickLang = e => { const b = e.target.closest('[data-l]'); if (b) { lang = lang === b.dataset.l ? '' : b.dataset.l; drawRepos(); } };
$('lbar').onclick = pickLang; $('llegend').onclick = pickLang;
$('rlist').onclick = e => {
  const p = e.target.closest('[data-pin]');
  if (p) { const k = p.dataset.pin; pins.has(k) ? pins.delete(k) : pins.add(k); store.set('gz_pins', JSON.stringify([...pins])); return drawRepos(); }
  const c = e.target.closest('.rc'); if (c) openRepo(c.dataset.r);
};

/* ===== Naya repository (auto README taake khali na rahe) ===== */
$('nrb').onclick = () => { $('nre').textContent = ''; $('nrn').value = ''; show('mNr'); };
$('nrgo').onclick = async () => {
  const name = $('nrn').value.trim(); if (!name) return ($('nre').textContent = 'Naam likhein');
  try { await gh('/user/repos', { method: 'POST', body: JSON.stringify({ name, private: $('nrp').checked, auto_init: true }) }); show('mNr', false); say('Repo ban gaya 🎉'); loadRepos(); }
  catch (e) { $('nre').textContent = e.message; }
};

/* ===== Repo view: files / history / info / branch switch ===== */
async function openRepo(full) {
  if (!$('off').classList.contains('hide')) return say('Offline: reconnect karke repo kholein', true);
  const r = allRepos.find(x => x.full_name === full); repo = full; branch = r.default_branch; path = '';
  $('rname').textContent = r.name; $('br').innerHTML = `<option>${esc(branch)}</option>`; endSel(); $('fq').value = ''; show('fres', false); show('files'); setTab('files');
  show('vDash', false); show('vRepo'); scrollTo(0, 0); loadDir();
  try { const bs = await gh(`/repos/${repo}/branches?per_page=100`); $('br').innerHTML = bs.map(b => `<option ${b.name === branch ? 'selected' : ''}>${esc(b.name)}</option>`).join(''); } catch (e) {}
}
$('br').onchange = () => { branch = $('br').value; path = ''; endSel(); setTab(tab); };
$('back').onclick = () => { repo = null; show('vRepo', false); show('vDash'); };
function setTab(t) {
  tab = t; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  show('pFiles', t === 'files'); show('pIss', t === 'iss'); show('pHist', t === 'hist'); show('pInfo', t === 'info');
  if (t === 'files') loadDir(); else if (t === 'iss') loadIss(); else if (t === 'hist') loadHist(); else drawInfo();
}
$('tabs').onclick = e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); };
async function loadHist() {
  $('pHist').innerHTML = '<div class="empty">Load ho raha hai…</div>';
  try {
    const c = await gh(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=25`);
    $('pHist').innerHTML = '<div class="list">' + c.map(x => `<div class="row" data-sha="${x.sha}" style="cursor:pointer"><span class="dot"></span><div style="flex:1;min-width:0"><div style="word-break:break-word">${esc(x.commit.message.split('\n')[0])}</div><small>${esc(x.commit.author.name)} · ${ago(x.commit.author.date)}</small></div><code class="mono" style="color:var(--ac2)">${x.sha.slice(0, 7)}</code></div>`).join('') + '</div>';
  } catch (e) { $('pHist').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function drawInfo() {
  const r = allRepos.find(x => x.full_name === repo), f = (k, v) => `<div><small>${k}</small>${v}</div>`;
  $('pInfo').innerHTML = `<p style="color:var(--mut)">${esc(r.description || 'Koi description nahi')}</p><div class="facts">${f('Visibility', r.private ? '🔒 Private' : '🌐 Public')}${f('Language', esc(r.language || '—'))}${f('Stars', '⭐ ' + r.stargazers_count)}${f('Forks', '🍴 ' + r.forks_count)}${f('Size', (r.size / 1024).toFixed(1) + ' MB')}${f('Updated', ago(r.pushed_at || r.updated_at))}${f('Created', new Date(r.created_at).toLocaleDateString())}${f('Default branch', '⎇ ' + esc(r.default_branch))}</div>
  <div class="bar"><button class="pri" id="icl">📋 Clone URL copy</button><a href="${esc(r.html_url)}" target="_blank" rel="noopener" style="text-decoration:none"><button>↗ GitHub par kholein</button></a><button id="ivis">${r.private ? '🌐 Public karein' : '🔒 Private karein'}</button></div>`;
  $('pInfo').insertAdjacentHTML('beforeend', `<div class="card" style="padding:14px;margin-top:12px"><div id="pgbox"></div></div><div class="card" style="padding:14px;margin-top:12px"><button id="istar"></button> <button id="idz">⬇ Repo ZIP download</button></div><div class="card" style="padding:14px;margin-top:12px"><label class="l">Description</label><input id="idesc" type="text" value="${esc(r.description || '')}"><label class="l">Topics (comma se alag karein)</label><input id="itop" type="text"><button class="pri" id="isave" style="margin-top:10px">Tafseel save karein</button></div>`);
  pagesBox(); starBox(); $('idz').onclick = () => dlZip('', r.name);
  gh(`/repos/${repo}/topics`).then(x => $('itop').value = x.names.join(', '), () => {});
  $('isave').onclick = async () => { try { const u = await gh(`/repos/${repo}`, { method: 'PATCH', body: JSON.stringify({ description: $('idesc').value }) }); r.description = u.description; const names = $('itop').value.split(',').map(t => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean); await gh(`/repos/${repo}/topics`, { method: 'PUT', body: JSON.stringify({ names }) }); say('Save ho gaya ✅'); } catch (e) { say(e.message, true); } };
  $('icl').onclick = () => navigator.clipboard.writeText(r.clone_url).then(() => say('Copy ho gaya'), () => say(r.clone_url));
  $('ivis').onclick = async () => {
    if (!confirm(r.private ? 'Is repository ko PUBLIC karein? Sab dekh sakenge.' : 'Is repository ko private karein?')) return;
    try { const u = await gh(`/repos/${repo}`, { method: 'PATCH', body: JSON.stringify({ private: !r.private }) }); Object.assign(r, u); say('Visibility badal gayi'); drawInfo(); } catch (e) { say(e.message, true); }
  };
  $('pInfo').insertAdjacentHTML('beforeend', '<div class="card" style="padding:14px;margin-top:12px"><div class="bar"><button id="ird">📘 README edit</button><button id="icol">👥 Sath kaam karne wale</button></div></div><div class="card" style="padding:14px;margin-top:12px"><button id="ibig">📊 Sabse bade files</button><div id="bigbox" class="list hide" style="margin-top:10px"></div></div>');
  $('ird').onclick = editReadme; $('icol').onclick = () => { show('mCol'); loadCol(); }; $('ibig').onclick = bigFiles;
}

/* ===== File browser ===== */
async function loadDir() {
  drawCrumb(); $('files').innerHTML = '<div class="empty">Load ho raha hai…</div>';
  try {
    let items = await gh(`/repos/${repo}/contents/${cp(path)}?ref=${encodeURIComponent(branch)}`);
    if (!Array.isArray(items)) items = [items];
    items.sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name));
    cur = items; drawFiles();
  } catch (e) { cur = []; $('files').innerHTML = `<div class="empty">${/empty/i.test(e.message) ? 'Yeh repository khali hai. Pehle ek file banayein.' : esc(e.message)}</div>`; }
}
const icon = i => i.type === 'dir' ? '📁' : /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(i.name) ? '🖼️' : /\.(zip|rar|7z|gz)$/i.test(i.name) ? '🗜️' : '📄';
function drawFiles() {
  $('files').innerHTML = (path ? '<div class="row"><span class="nm" data-up="1">⬆ ..</span></div>' : '') + (cur.map((i, k) => `<div class="row" style="animation-delay:${Math.min(k, 12) * 30}ms">
    ${selMode ? `<input type="checkbox" data-s="${esc(i.path)}" ${sel.has(i.path) ? 'checked' : ''}>` : ''}
    <span class="nm" data-t="${i.type}" data-p="${esc(i.path)}">${icon(i)} ${esc(i.name)}</span>
    <small>${i.type === 'file' ? (i.size / 1024).toFixed(1) + ' KB' : ''}</small>
    ${selMode ? '' : `<button data-mv="${esc(i.path)}">✏️</button><button class="dng" data-del="${esc(i.path)}">🗑</button>`}</div>`).join('') || '<div class="empty">Folder khali hai. Actions se upload karein.</div>');
  selSync();
}
function selSync() { $('selc').textContent = sel.size + ' select kiye'; $('selall').checked = cur.length > 0 && sel.size === cur.length; }
function drawCrumb() {
  const parts = path ? path.split('/') : [];
  $('crumb').innerHTML = `<span data-c="">${esc(repo)}</span>` + parts.map((p, i) => ` / <span data-c="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</span>`).join('');
}
$('crumb').onclick = e => { const c = e.target.closest('[data-c]'); if (c) { path = c.dataset.c; loadDir(); } };
$('files').onclick = e => {
  const n = e.target.closest('.nm');
  if (n && n.dataset.up) { path = path.split('/').slice(0, -1).join('/'); return loadDir(); }
  const ck = e.target.closest('[data-s]');
  if (ck) { ck.checked ? sel.add(ck.dataset.s) : sel.delete(ck.dataset.s); return selSync(); }
  if (n) {
    if (selMode) { const cb = n.closest('.row').querySelector('[data-s]'); if (cb) { cb.checked = !cb.checked; cb.checked ? sel.add(cb.dataset.s) : sel.delete(cb.dataset.s); selSync(); } return; }
    if (n.dataset.t === 'dir') { path = n.dataset.p; return loadDir(); } return openFile(n.dataset.p);
  }
  const m = e.target.closest('[data-mv]'); if (m) return moveItem(m.dataset.mv);
  const d = e.target.closest('[data-del]'); if (d) removeMany([d.dataset.del]);
};

/* ===== Select / delete many: EK commit, entries 300 ke chunks mein, conflict par retries ===== */
function startSel(all) { selMode = true; sel = new Set(all ? cur.map(i => i.path) : []); show('selbar'); drawFiles(); }
function endSel() { selMode = false; sel = new Set(); show('selbar', false); if (repo && tab === 'files') drawFiles(); }
$('selx').onclick = endSel;
$('selall').onchange = () => { sel = new Set($('selall').checked ? cur.map(i => i.path) : []); drawFiles(); };
$('selb').onclick = () => { setTab('files'); startSel(false); };
$('seld').onclick = () => sel.size ? removeMany([...sel]) : say('Pehle kuch select karein', true);
let delChain = Promise.resolve(), delN = 0;
async function removeMany(paths) {
  if (!confirm(`${paths.length} cheez delete karein? Folders ke andar ka sab bhi jayega.`)) return;
  const snap = cur, gone = new Set(paths);
  cur = cur.filter(i => !gone.has(i.path)); endSel(); drawFiles(); say(`${paths.length} cheez delete ho rahi hain…`);
  delN++;
  delChain = delChain.then(async () => {
    try {
      const ents = [];
      for (const p of paths) {
        const it = snap.find(i => i.path === p);
        if (it && it.type === 'dir') {
          const t = await retry(() => gh(`/repos/${repo}/git/trees/${it.sha}?recursive=1`));
          t.tree.forEach(x => x.type === 'blob' && ents.push({ path: p + '/' + x.path, mode: x.mode, type: 'blob', sha: null }));
        } else ents.push({ path: p, mode: '100644', type: 'blob', sha: null });
      }
      if (!ents.length) return;
      for (let k = 0; ; k++) {
        try {
          const ref = await retry(() => gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`));
          const cm = await retry(() => gh(`/repos/${repo}/git/commits/${ref.object.sha}`));
          let base = cm.tree.sha;
          for (let s = 0; s < ents.length; s += 300) {
            const t = await retry(() => gh(`/repos/${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: base, tree: ents.slice(s, s + 300) }) }));
            base = t.sha;
          }
          const c = await retry(() => gh(`/repos/${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `Delete ${paths.length} item(s)`, tree: base, parents: [ref.object.sha] }) }));
          await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) });
          recUndo(ref.object.sha, c.sha, 'Delete ' + paths.length + ' item(s)'); tc = null; say('Delete ho gaya ✅ · Undo upar menu mein hai'); return;
        } catch (e) { if (k < 4 && /fast.forward|Reference update failed|conflict/i.test(e.message)) { await sleep(700 * (k + 1)); continue; } throw e; }
      }
    } catch (e) { say(e.message, true); }
  }).then(() => { if (--delN === 0) loadDir(); });
}

/* ===== Actions sheet ===== */
$('actb').onclick = () => show('mAct');
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.add('hide'));
$('mAct').onclick = e => {
  const a = e.target.closest('[data-a]'); if (!a) return; show('mAct', false); setTab('files');
  const k = a.dataset.a, pre = path ? path + '/' : '';
  if (k === 'zip' || k === 'file') openUp(k); else if (k === 'fol') openUp('folder'); else if (k === 'dz') dlZip(path, path ? path.split('/').pop() : repo.split('/')[1]); else if (k === 'br') brList().then(() => show('mBr')); else if (k === 'new') showEditor(pre, '', null); else if (k === 'dir') showEditor(pre, '', null, true); else startSel(k === 'all');
};

/* ===== Editor, folder maker, image preview ===== */
const MIME = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', ico: 'image/x-icon' };
async function openFile(p) {
  try {
    const f = await gh(`/repos/${repo}/contents/${cp(p)}?ref=${encodeURIComponent(branch)}`), ext = p.split('.').pop().toLowerCase();
    if (/^(png|jpe?g|gif|webp|svg|ico|bmp)$/.test(ext)) {
      if (!f.content) return say('Image yahan preview ke liye bahut badi hai.', true);
      const src = `data:${MIME[ext] || 'image/' + ext};base64,${f.content.replace(/\n/g, '')}`;
      const ed = /^(png|jpe?g|webp)$/.test(ext);
      IM = { p, sha: f.sha, src, type: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', c: null, dirty: false };
      $('imgv').src = src; $('imgn').textContent = f.name; $('imgd').href = src; $('imgd').download = f.name; show('imgedit', ed); show('isv', ed); if (ed) imgLoad(src); return show('mImg');
    }
    const text = f.content ? dec(f.content) : '';
    if (text.includes('\u0000')) return say('Binary file: yahan edit nahi ho sakti.', true);
    showEditor(p, text, f.sha);
  } catch (e) { say(e.message, true); }
}
/* ===== Image editor: rotate, crop, GitHub par wapas save ===== */
let IM = null;
function imgLoad(src, cb) { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); IM.c = c; if (cb) cb(); }; im.src = src; }
function imgShow() { const u = IM.c.toDataURL(IM.type, .92); $('imgv').src = u; $('imgd').href = u; }
$('irot').onclick = () => { if (!IM || !IM.c) return; const o = IM.c, c = document.createElement('canvas'); c.width = o.height; c.height = o.width; const x = c.getContext('2d'); x.translate(c.width / 2, c.height / 2); x.rotate(Math.PI / 2); x.drawImage(o, -o.width / 2, -o.height / 2); IM.c = c; IM.dirty = true; imgShow(); };
function imgCrop(w, h) { if (!IM || !IM.c) return; const o = IM.c; let cw = o.width, ch = cw * h / w; if (ch > o.height) { ch = o.height; cw = ch * w / h; } const c = document.createElement('canvas'); c.width = Math.round(cw); c.height = Math.round(ch); c.getContext('2d').drawImage(o, (o.width - cw) / 2, (o.height - ch) / 2, cw, ch, 0, 0, c.width, c.height); IM.c = c; IM.dirty = true; imgShow(); }
$('ic11').onclick = () => imgCrop(1, 1); $('ic169').onclick = () => imgCrop(16, 9); $('ic43').onclick = () => imgCrop(4, 3);
$('irst').onclick = () => { if (IM) { IM.dirty = false; imgLoad(IM.src, imgShow); } };
$('isv').onclick = async () => {
  if (!IM || !IM.dirty) return say('Pehle image badlein', true);
  try {
    const bl = await new Promise(r => IM.c.toBlob(r, IM.type, .92)), u = new Uint8Array(await bl.arrayBuffer());
    const r = await gh(`/repos/${repo}/contents/${cp(IM.p)}`, { method: 'PUT', body: JSON.stringify({ message: 'Edit image ' + IM.p, content: b64(u), branch, sha: IM.sha }) });
    IM.sha = r.content.sha; IM.dirty = false; recUndo(r.commit.parents[0].sha, r.commit.sha, 'Edit image ' + IM.p); tc = null; say('Save ho gaya ✅'); loadDir();
  } catch (e) { say(e.message, true); }
};
let upDone = false;
let hlOn = false, mdOn = false;
const isMd = p => /\.(md|markdown)$/i.test(p);
function renderEd() {
  const t = $('etext').value, ext = $('epath').value.split('.').pop().toLowerCase();
  show('ehl', hlOn); show('emd', mdOn); show('etext', !(hlOn || (mdOn && innerWidth < 800)));
  if (hlOn) $('ehl').innerHTML = hl(t, ext); if (mdOn) $('emd').innerHTML = md(t);
}
function showEditor(p, text, sha, folder) {
  editSha = sha; $('epath').value = p; $('epath').disabled = !!sha; $('etext').value = text; $('emsg').textContent = '';
  $('epath').placeholder = folder ? 'folder-name' : 'folder/file.txt'; hlOn = false; mdOn = !folder && isMd(p) && innerWidth >= 800;
  show('esave', !folder); show('efold', !!folder); show('ecp', !folder); show('edl', !folder); show('ehb', !folder); show('emb', !folder && isMd(p));
  renderEd(); show('editor');
}
$('ehb').onclick = () => { hlOn = !hlOn; if (hlOn) mdOn = false; renderEd(); };
$('emb').onclick = () => { mdOn = !mdOn; if (mdOn) hlOn = false; renderEd(); };
$('etext').oninput = () => { if (mdOn) renderEd(); };
$('ecancel').onclick = () => show('editor', false);
$('ecp').onclick = () => navigator.clipboard.writeText($('etext').value).then(() => say('Copy ho gaya'), () => say('Copy fail ho gaya', true));
$('edl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([$('etext').value])); a.download = $('epath').value.split('/').pop() || 'file.txt'; a.click(); };
async function put(p, content, sha, msg) {
  const body = { message: msg, content: enc(content), branch }; if (sha) body.sha = sha;
  const r = await gh(`/repos/${repo}/contents/${cp(p)}`, { method: 'PUT', body: JSON.stringify(body) }); try { recUndo(r.commit.parents[0].sha, r.commit.sha, msg); } catch (e) {} tc = null;
}
$('esave').onclick = async () => {
  const p = $('epath').value.trim().replace(/^\/+/, ''); if (!p || p.endsWith('/')) return ($('emsg').textContent = 'File ka naam likhein.');
  try { await put(p, $('etext').value, editSha, (editSha ? 'Update ' : 'Create ') + p); show('editor', false); say('Save ' + p); loadDir(); } catch (e) { $('emsg').textContent = e.message; }
};
$('efold').onclick = async () => {
  const p = $('epath').value.trim().replace(/^\/+|\/+$/g, ''); if (!p) return ($('emsg').textContent = 'Folder ka naam likhein.');
  try { await put(p + '/.gitkeep', '', null, 'Create folder ' + p); show('editor', false); say('Folder ban gaya'); loadDir(); } catch (e) { $('emsg').textContent = e.message; }
};

/* ===== Ek commit mein kai files ===== */
async function commitTree(entries, message, rec = true) {
  for (let k = 0; ; k++) {
    try {
      const ref = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
      const base = await gh(`/repos/${repo}/git/commits/${ref.object.sha}`);
      const tree = await gh(`/repos/${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: base.tree.sha, tree: entries }) });
      const commit = await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }) });
      await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) }); if (rec) recUndo(ref.object.sha, commit.sha, message);
      tc = null; return;
    } catch (e) {
      if (k < 4 && /fast.forward|Reference update failed|conflict/i.test(e.message)) { await sleep(600 * (k + 1)); continue; }
      throw e;
    }
  }
}

/* ===== Tez resumable upload ===== */
async function retry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (/Bad credentials|Not Found|Validation|too large|fast.forward/i.test(e.message) || i >= 5 || cancel) throw e;
      if (!navigator.onLine) await new Promise(r => addEventListener('online', r, { once: true }));
      await sleep(1000 * 2 ** i);
    }
  }
}
async function gitSha(u) {
  const h = new TextEncoder().encode('blob ' + u.length + '\0'), m = new Uint8Array(h.length + u.length); m.set(h); m.set(u, h.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', m))].map(x => x.toString(16).padStart(2, '0')).join('');
}
function prog(p, t) { $('bar').style.width = p + '%'; $('ptxt').textContent = t; }

/* Live per-file list: </> = chal raha hai, ✓ = ho gaya, ＝ = same (skip), ✕ = fail */
const TD = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const asText = u => { try { const s = TD.decode(u); return s.includes('\u0000') ? null : s; } catch (e) { return null; } };
const bname = p => p.slice(p.lastIndexOf('/') + 1);
function addRow(p, tag) {
  const f = $('flist'), d = document.createElement('div'); d.className = 'wip';
  d.innerHTML = `<i>&lt;/&gt;</i><span>${esc(p)}</span><small>${esc(tag)}</small>`;
  f.appendChild(d); while (f.children.length > 250) f.removeChild(f.firstChild); f.scrollTop = f.scrollHeight; return d;
}
function mark(d, c) { d.className = c; d.firstChild.textContent = { ok: '✓', sk: '＝', er: '✕' }[c]; }

/* Replace mode: ZIP files repo mein maujood same naam ki files ko overwrite karti hain (case-insensitive), top ZIP folder auto-strip, naye files add */
function plan(items, have, o, pre) {
  const low = Object.create(null); Object.keys(have).forEach(p => low[p.toLowerCase()] = p);
  const real = p => low[p.toLowerCase()];
  const roots = new Set(items.map(x => x.name.split('/')[0])), inRepo = p => real(pre + p) !== undefined, rest = x => x.name.split('/').slice(1).join('/');
  let strip = false;
  if (roots.size === 1 && items.every(x => x.name.includes('/'))) strip = items.filter(x => inRepo(rest(x))).length > items.filter(x => inRepo(x.name)).length;
  const nm = x => strip ? rest(x) : x.name, bn = Object.create(null), zc = Object.create(null);
  if (o.smart) {
    Object.keys(have).filter(p => p.startsWith(pre)).forEach(p => (bn[bname(p)] = bn[bname(p)] || []).push(p));
    items.forEach(x => { const b = bname(nm(x)); zc[b] = (zc[b] || 0) + 1; });
  }
  items.forEach(x => {
    const n = nm(x), ex = real(pre + n);
    x.dest = ex !== undefined ? ex : pre + n; x.kind = ex !== undefined ? 'update' : 'new'; x.moved = false;
    if (x.kind === 'new' && o.smart) { const b = bname(n), c = bn[b]; if (c && c.length === 1 && zc[b] === 1) { x.dest = c[0]; x.kind = 'update'; x.moved = true; } }
  });
}

async function upload(items, o) {
  busy = true; cancel = false; show('prog'); $('upGo').disabled = true; $('upGo').textContent = '⏳ Upload ho raha hai…'; $('upCancel').textContent = 'Stop'; $('flist').innerHTML = '';
  const pre = o.tp ? o.tp + '/' : ''; let hold = false;
  try {
    prog(0, 'Check kar rahe hain kya pehle se hai…');
    const ref = await retry(() => gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`)), head = ref.object.sha;
    const bc = await retry(() => gh(`/repos/${repo}/git/commits/${head}`)), have = Object.create(null);
    try { (await retry(() => gh(`/repos/${repo}/git/trees/${bc.tree.sha}?recursive=1`))).tree.forEach(t => { if (t.type === 'blob') have[t.path] = t.sha; }); } catch (e) {}
    plan(items, have, o, pre);
    /* do ZIP files ek hi path par: aakhri rakho, baaki count */
    const last = Object.create(null); items.forEach(x => last[x.dest] = x);
    const dupN = items.length - Object.keys(last).length; items = items.filter(x => last[x.dest] === x);
    const n = items.length; let i = 0, skip = 0, add = 0, upd = 0, okc = 0, bad = [], q = 0, pb = 0, fail = null, tsha = bc.tree.sha, queue = [], chain = Promise.resolve();
    const tick = () => { const d = okc + skip; prog(d / n * 100, `${d} / ${n} files (${Math.round(d / n * 100)}%)` + (skip ? ` · ${skip} skipped` : '')); };
    /* text files tree request ke andar jaati hain (alag blob call nahi), isliye hazaaron files bhi kuch requests mein */
    const flush = () => {
      if (!queue.length) return;
      const b = queue; queue = []; pb = 0; q++;
      chain = chain.then(async () => {
        if (cancel || fail) return;
        const t = await retry(() => gh(`/repos/${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: tsha, tree: b.map(x => x.e) }) }));
        tsha = t.sha; b.forEach(x => mark(x.row, 'ok')); okc += b.length; tick();
      }).catch(e => { fail = fail || e; }).then(() => { q--; });
    };
    const work = async () => {
      while (i < n && !cancel && !fail) {
        const it = items[i++], p = it.dest, row = addRow(p, it.moved ? 'update ↪' : it.kind);
        try {
          let u = await it.get(); if (o.img) u = await shrink(u, it.name);
          const sh = await gitSha(u); it.exp = sh;
          if (u.length > 1e8) { it.exp = null; bad.push(p + ' (100 MB se zyada, skip)'); say(p + ' 100 MB se zyada hai: skip', true); mark(row, 'er'); }
          else if (have[p] !== undefined && (!o.over || have[p] === sh)) { if (have[p] !== sh) it.exp = null; skip++; mark(row, 'sk'); tick(); }
          else {
            const txt = u.length && u.length < 7e5 ? asText(u) : null;
            if (txt !== null) { queue.push({ e: { path: p, mode: '100644', type: 'blob', content: txt }, row }); pb += txt.length; }
            else { const b = await retry(() => gh(`/repos/${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: b64(u), encoding: 'base64' }) })); queue.push({ e: { path: p, mode: '100644', type: 'blob', sha: b.sha }, row }); }
            it.kind === 'new' ? add++ : upd++;
            if (pb > 1e6 || queue.length >= 60) { flush(); if (q >= 3) await chain; }
          }
        } catch (e) { mark(row, 'er'); fail = fail || e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, n) }, work));
    flush(); await chain; if (fail) throw fail;
    if (cancel) say('Rok diya. Kuch commit nahi hua.', true);
    else if (!add && !upd) say('Kuch naya nahi: sab pehle se maujood hai');
    else {
      prog(100, 'Commit save ho raha hai…');
      const c = await retry(() => gh(`/repos/${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message: o.msg, tree: tsha, parents: [head] }) }));
      await retry(() => gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) })); tc = null;
      recUndo(head, c.sha, o.msg); logUp(o.msg, add + upd, skip); say(`✅ ${add} naye · ${upd} update` + (skip ? ` · ${skip} skip` : ''));
    }
    /* ===== Zero-miss check: har file real branch se compare, jo missing ho dobara bhejo ===== */
    if (!cancel) {
      prog(100, 'Har file verify ho rahi hai…');
      const need = items.filter(x => x.exp); let missing = [], vtrunc = false;
      for (let k = 0; k < 3; k++) {
        const r = await retry(() => gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`));
        const cm = await retry(() => gh(`/repos/${repo}/git/commits/${r.object.sha}`));
        const t = await retry(() => gh(`/repos/${repo}/git/trees/${cm.tree.sha}?recursive=1`));
        if (t.truncated) { vtrunc = true; break; }
        const live = Object.create(null); t.tree.forEach(x => { if (x.type === 'blob') live[x.path] = x.sha; });
        missing = need.filter(x => live[x.dest] !== x.exp);
        if (!missing.length || k === 2) break;
        prog(100, `${missing.length} missing file(s) dobara bheji ja rahi hain…`);
        const ents = [];
        for (const x of missing) {
          let u = await x.get(); if (o.img) u = await shrink(u, x.name);
          const b = await retry(() => gh(`/repos/${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: b64(u), encoding: 'base64' }) }));
          ents.push({ path: x.dest, mode: '100644', type: 'blob', sha: b.sha });
        }
        await retry(() => commitTree(ents, o.msg + ' (repair)', false));
      }
      const probs = [...missing.map(x => x.dest + ' (upload ke baad nahi mili)'), ...bad];
      if (probs.length) {
        hold = true;
        $('flist').insertAdjacentHTML('beforeend', probs.map(p => `<div class="er"><i>✕</i><span>${esc(p)}</span></div>`).join('')); $('flist').scrollTop = 1e9;
        prog(100, `⚠️ ${probs.length} file(s) mein masla hai`); say(`⚠️ ${probs.length} file(s) mein masla hai. List dekhein.`, true);
      } else say(vtrunc ? '✅ Push ho gaya (repo bahut bada, poora check nahi hua)' : `✅ Verified: saari ${need.length} files repo mein hain` + (dupN ? ` · ${dupN} duplicate naam merge` : ''));
    }
  } catch (e) { say(/empty/i.test(e.message) ? 'Repository khali hai: pehle ek file banayein.' : e.message, true); }
  busy = false; pend = null; upDone = true;
  if (!hold) prog(100, '✅ Ho gaya! Reload dabayein');
  /* footer ab hamesha visible hai, isliye upload khatam hote hi Reload dikhta hai */
  $('upGo').disabled = false; $('upGo').textContent = '🔄 Reload'; $('upCancel').textContent = 'Band';
}

/* ===== Upload modal (preview step nahi: Upload dabao seedha push hota hai) ===== */
function openUp(mode) {
  upDone = false; $('upGo').textContent = mode === 'zip' ? '⬆ ZIP upload karein' : '⬆ Abhi upload karein'; $('upCancel').textContent = 'Cancel';
  upMode = mode; pend = null; $('upT').textContent = { zip: 'ZIP upload', file: 'Files upload', folder: 'Folder upload' }[mode];
  $('dropT').textContent = { zip: 'Apni ZIP chunein', file: 'Apni files chunein', folder: 'Apna folder chunein' }[mode]; show('zsize', false);
  document.querySelectorAll('.zo').forEach(e => e.classList.toggle('hide', mode === 'file'));
  $('upPath').value = path; show('prog', false); show('mUp');
}
$('drop').onclick = () => $({ zip: 'fz', file: 'ff', folder: 'fd' }[upMode]).click();
$('drop').ondragover = e => { e.preventDefault(); $('drop').classList.add('drag'); };
$('drop').ondragleave = () => $('drop').classList.remove('drag');
$('drop').ondrop = e => { e.preventDefault(); $('drop').classList.remove('drag'); pick([...e.dataTransfer.files]); };
$('fz').onchange = e => { const f = [...e.target.files]; e.target.value = ''; pick(f); };
$('ff').onchange = e => { const f = [...e.target.files]; e.target.value = ''; pick(f); };
$('fd').onchange = e => { const f = [...e.target.files]; e.target.value = ''; pick(f); };
/* FIX: ZIP select karte waqt memory mein nahi khulta (isse "unable to allocate memory" aata tha).
   Sirf file yaad rakhta hai; ZIP tab khulti hai jab aap Upload dabate hain, saaf error ke saath. */
function pick(fs) {
  if (!fs.length || busy || reading) return;
  upDone = false; $('upGo').textContent = upMode === 'zip' ? '⬆ ZIP upload karein' : '⬆ Abhi upload karein'; $('upCancel').textContent = 'Cancel';
  if (upMode === 'zip') {
    pend = { file: fs[0] };
    $('dropT').textContent = fs[0].name;
    $('zsize').textContent = '📦 ' + mb(fs[0].size); show('zsize');
  } else {
    pend = { files: fs }; $('dropT').textContent = fs.length + ' file(s) tayyar';
    $('zsize').textContent = '📦 ' + mb(fs.reduce((a, f) => a + f.size, 0)); show('zsize');
  }
}
$('upCancel').onclick = () => busy ? (cancel = true) : reading ? null : show('mUp', false);
$('upGo').onclick = async () => {
  if (upDone) { upDone = false; show('prog', false); show('mUp', false); tc = null; loadDir(); loadRepos().catch(() => {}); return; }
  if (!pend) return say('Pehle ek file chunein', true);
  if (busy || reading) return;
  /* ZIP ab kholo (sirf jab Upload dabaya) */
  if (pend.file && !pend.zip) {
    reading = true; show('prog'); $('flist').innerHTML = ''; $('upGo').disabled = true; $('upGo').textContent = '⏳ ZIP padhi ja rahi hai…'; prog(0, 'ZIP padhi ja rahi hai…');
    try { await needZip(); pend.zip = await JSZip.loadAsync(pend.file); }
    catch (e) {
      reading = false; $('upGo').disabled = false; $('upGo').textContent = '⬆ ZIP upload karein'; show('prog', false);
      return say('Yeh ZIP khul nahi saki: ' + (e && e.message ? e.message : 'memory kam hai') + '. Chhoti ZIP try karein ya baaki apps band karein.', true);
    }
    reading = false; $('upGo').disabled = false;
  }
  const o = { smart: $('oSmart').checked, over: $('oOver').checked, img: $('oImg').checked, msg: $('upMsg').value || 'Upload', tp: $('upPath').value.trim().replace(/^\/+|\/+$/g, '') };
  let list = pend.zip ? Object.keys(pend.zip.files).filter(n => !pend.zip.files[n].dir).map(n => ({ n, get: () => pend.zip.files[n].async('uint8array') }))
    : pend.files.map(f => ({ n: f.webkitRelativePath || f.name, get: async () => new Uint8Array(await f.arrayBuffer()) }));
  if (upMode !== 'file') {
    if ($('oSys').checked) list = list.filter(x => !/(^|\/)(node_modules|__MACOSX|\.git)\//.test(x.n) && !/\.DS_Store$/.test(x.n));
    const roots = new Set(list.map(x => x.n.split('/')[0]));
    if ($('oStrip').checked && roots.size === 1 && list.every(x => x.n.includes('/'))) list.forEach(x => x.n = x.n.split('/').slice(1).join('/'));
  }
  const items = list.map(x => ({ name: x.n, get: x.get }));
  if (!items.length) { show('prog', false); $('upGo').textContent = upMode === 'zip' ? '⬆ ZIP upload karein' : '⬆ Abhi upload karein'; return say('Upload ke liye koi file nahi', true); }
  upload(items, o);
};
const fl = $('files');
fl.ondragover = e => { e.preventDefault(); fl.classList.add('drag'); };
fl.ondragleave = () => fl.classList.remove('drag');
fl.ondrop = e => { e.preventDefault(); fl.classList.remove('drag'); const fs = [...e.dataTransfer.files]; if (!fs.length) return; openUp(fs.length === 1 && /\.zip$/i.test(fs[0].name) ? 'zip' : 'file'); pick(fs); };
addEventListener('beforeunload', e => { if (busy || reading) { e.preventDefault(); e.returnValue = ''; } });

/* ===== Naya: tree cache, search, move/rename, ZIP download ===== */
let tc = null;
async function getTree() {
  const k = repo + '@' + branch; if (tc && tc.k === k) return tc.t;
  const r = await gh(`/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`); tc = { k, t: r.tree }; return r.tree;
}
$('fq').oninput = async () => {
  const q = $('fq').value.trim().toLowerCase(); show('fres', q.length > 1); show('files', q.length < 2); if (q.length < 2) return;
  try {
    const r = (await getTree()).filter(x => x.path.toLowerCase().includes(q)).slice(0, 40);
    $('fres').innerHTML = r.map(x => `<div class="row"><span class="nm" data-sp="${esc(x.path)}" data-st="${x.type}">${x.type === 'tree' ? '📁' : '📄'} ${esc(x.path)}</span></div>`).join('') || '<div class="empty">Kuch match nahi</div>';
  } catch (e) { $('fres').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
};
$('fres').onclick = e => {
  const n = e.target.closest('[data-sp]'); if (!n) return; $('fq').value = ''; show('fres', false); show('files');
  if (n.dataset.st === 'tree') path = n.dataset.sp; else path = n.dataset.sp.split('/').slice(0, -1).join('/');
  loadDir(); if (n.dataset.st !== 'tree') openFile(n.dataset.sp);
};
async function moveItem(p) {
  let np = (prompt('Naya naam ya poora path:', p) || '').trim().replace(/^\/+|\/+$/g, ''); if (!np || np === p) return;
  if (!np.includes('/') && p.includes('/')) np = p.slice(0, p.lastIndexOf('/') + 1) + np;
  try {
    const ents = []; (await getTree()).filter(x => x.type === 'blob' && (x.path === p || x.path.startsWith(p + '/'))).forEach(x => {
      ents.push({ path: np + x.path.slice(p.length), mode: x.mode, type: 'blob', sha: x.sha }, { path: x.path, mode: x.mode, type: 'blob', sha: null });
    });
    if (!ents.length) return say('Nahi mila', true);
    await commitTree(ents, `Move ${p} to ${np}`); say('Move ho gaya ✅'); loadDir();
  } catch (e) { say(e.message, true); }
}
async function dlZip(prefix, name) {
  try {
    const fs = (await getTree()).filter(x => x.type === 'blob' && (!prefix || x.path.startsWith(prefix + '/')));
    if (!fs.length) return say('Download ke liye kuch nahi', true);
    const total = fs.reduce((a, x) => a + (x.size || 0), 0);
    if (total > 80e6 && !confirm('Yeh takreeban ' + (total / 1e6).toFixed(0) + ' MB hai. Phone ki memory kam pad sakti hai. Jari rakhein?')) return;
    await needZip(); const z = new JSZip(); let i = 0, d = 0;
    await Promise.all(Array.from({ length: 5 }, async () => {
      while (i < fs.length) { const f = fs[i++], b = await retry(() => gh(`/repos/${repo}/git/blobs/${f.sha}`)); z.file(prefix ? f.path.slice(prefix.length + 1) : f.path, b.content.replace(/\n/g, ''), { base64: true }); say(`Pack ho raha hai ${++d} / ${fs.length}…`); }
    }));
    const a = document.createElement('a'); a.href = URL.createObjectURL(await z.generateAsync({ type: 'blob' })); a.download = name + '.zip'; a.click(); say('ZIP tayyar ⬇');
  } catch (e) { say(e.message, true); }
}

/* ===== Naya: photo shrinker, upload log ===== */
async function shrink(u, name) {
  if (u.length < 8e5 || !/\.(jpe?g|png|webp)$/i.test(name)) return u;
  try {
    const type = /png$/i.test(name) ? 'image/png' : /webp$/i.test(name) ? 'image/webp' : 'image/jpeg', bm = await createImageBitmap(new Blob([u]));
    const k = Math.min(1, 2048 / Math.max(bm.width, bm.height)), c = document.createElement('canvas'); c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
    const o = new Uint8Array(await (await new Promise(r => c.toBlob(r, type, .82))).arrayBuffer()); return o.length < u.length ? o : u;
  } catch (e) { return u; }
}
function logUp(m, n, s) { let L = []; try { L = JSON.parse(store.get('gz_log') || '[]'); } catch (e) {} L.unshift({ t: Date.now(), repo, m, n, s }); store.set('gz_log', JSON.stringify(L.slice(0, 30))); }
$('mhb').onclick = () => {
  show('menu', false); let L = []; try { L = JSON.parse(store.get('gz_log') || '[]'); } catch (e) {}
  $('hlist').innerHTML = L.length ? L.map(x => `<div class="row"><div style="flex:1;min-width:0"><b style="word-break:break-all">${esc(x.repo)}</b><br><small>${esc(x.m)} · ${x.n} files${x.s ? ', ' + x.s + ' skipped' : ''} · ${ago(x.t)}</small></div></div>`).join('') : '<div class="empty">Abhi koi upload nahi</div>'; show('mHist');
};

$('mub').onclick = async () => {
  show('menu', false); let o; try { o = JSON.parse(store.get('gz_undo')); } catch (e) {}
  if (!o) return say('Undo ke liye kuch nahi', true);
  if (!confirm(`${o.repo} mein "${o.msg}" undo karein?`)) return;
  try {
    const hd = await gh(`/repos/${o.repo}/git/ref/heads/${encodeURIComponent(o.branch)}`);
    if (hd.object.sha !== o.after && !confirm('Iske baad naye commits hain. Phir bhi undo karein aur woh bhi hata dein?')) return;
    await gh(`/repos/${o.repo}/git/refs/heads/${encodeURIComponent(o.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: o.before, force: true }) });
    store.set('gz_undo', ''); tc = null; say('Undo ho gaya ↩'); if (repo === o.repo && branch === o.branch) loadDir(); loadRepos().catch(() => {});
  } catch (e) { say(e.message, true); }
};
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1024).toFixed(1) + ' KB';
async function bigFiles() {
  const b = $('bigbox'); show('bigbox'); b.innerHTML = '<div class="empty">Load ho raha hai…</div>';
  try {
    const t = (await getTree()).filter(x => x.type === 'blob').sort((a, c) => (c.size || 0) - (a.size || 0)), tot = t.reduce((a, x) => a + (x.size || 0), 0);
    b.innerHTML = `<div class="row"><small>${t.length} files · ${fmt(tot)} total</small></div>` + t.slice(0, 20).map(x => `<div class="row"><span class="nm" data-bp="${esc(x.path)}">📄 ${esc(x.path)}</span><small>${fmt(x.size || 0)}</small><button class="dng" data-bd="${esc(x.path)}">🗑</button></div>`).join('');
  } catch (e) { b.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
$('pInfo').onclick = e => {
  const o = e.target.closest('[data-bp]'); if (o) { const p = o.dataset.bp; path = p.split('/').slice(0, -1).join('/'); setTab('files'); return openFile(p); }
  const d = e.target.closest('[data-bd]'); if (d) { removeMany([d.dataset.bd]); delChain.then(() => { tc = null; bigFiles(); }); }
};

/* ===== Naya: commit diff, branches, Pages, star, fork ===== */
$('pHist').onclick = e => { const r = e.target.closest('[data-sha]'); if (r) openDiff(r.dataset.sha); };
async function openDiff(sha) {
  show('mDiff'); $('dft').textContent = 'Load ho raha hai…'; $('dfb').innerHTML = '';
  try {
    const c = await gh(`/repos/${repo}/commits/${sha}`); $('dft').textContent = c.commit.message.split('\n')[0];
    $('dfb').innerHTML = c.files.map(f => `<div class="df"><b style="word-break:break-all">${esc(f.filename)}</b> <small>${f.status} +${f.additions} −${f.deletions}</small><pre>${f.patch ? f.patch.split('\n').map(l => `<span class="${l[0] === '+' ? 'ad' : l[0] === '-' ? 'rm' : ''}">${esc(l) || ' '}</span>`).join('') : '(binary ya dikhane ke liye bahut badi)'}</pre></div>`).join('');
  } catch (e) { $('dfb').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function brList() {
  const bs = await gh(`/repos/${repo}/branches?per_page=100`);
  $('br').innerHTML = bs.map(b => `<option ${b.name === branch ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  $('msrc').innerHTML = bs.filter(b => b.name !== branch).map(b => `<option>${esc(b.name)}</option>`).join('');
}
$('bcreate').onclick = async () => {
  const n = $('bname').value.trim(); if (!n) return say('Branch ka naam likhein', true);
  try {
    const r = await gh(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    await gh(`/repos/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + n, sha: r.object.sha }) });
    branch = n; path = ''; await brList(); show('mBr', false); say('Branch ban gaya 🌿'); setTab(tab);
  } catch (e) { say(e.message, true); }
};
$('bmerge').onclick = async () => {
  const s2 = $('msrc').value; if (!s2) return say('Merge ke liye koi doosra branch nahi', true);
  if (!confirm(`"${s2}" ko "${branch}" mein merge karein?`)) return;
  try { const r = await gh(`/repos/${repo}/merges`, { method: 'POST', body: JSON.stringify({ base: branch, head: s2 }) }); tc = null; show('mBr', false); say(r ? 'Merge ho gaya ✅' : 'Pehle se up to date'); setTab(tab); }
  catch (e) { say(e.message, true); }
};
async function pagesBox() {
  const box = $('pgbox');
  try {
    const p = await gh(`/repos/${repo}/pages`);
    box.innerHTML = `🌐 GitHub Pages <b>ON</b> hai<br><a class="lnk" target="_blank" rel="noopener" href="${esc(p.html_url)}" style="word-break:break-all">${esc(p.html_url)}</a><br><button id="pgoff" class="dng" style="margin-top:8px">Band karein</button>`;
    $('pgoff').onclick = async () => { if (!confirm('Is repo ke liye GitHub Pages band karein?')) return; try { await gh(`/repos/${repo}/pages`, { method: 'DELETE' }); pagesBox(); } catch (e) { say(e.message, true); } };
  } catch (e) {
    box.innerHTML = `🌐 GitHub Pages <b>off</b> hai<br><button id="pgon" class="pri" style="margin-top:8px">On karein (${esc(branch)})</button>`;
    $('pgon').onclick = async () => { try { await gh(`/repos/${repo}/pages`, { method: 'POST', body: JSON.stringify({ source: { branch, path: '/' } }) }); say('Pages on ho gaya. Ek minute lag sakta hai.'); pagesBox(); } catch (e2) { say(e2.message, true); } };
  }
}
async function starBox() {
  const b = $('istar'); let on = true;
  try { await gh(`/user/starred/${repo}`); } catch (e) { on = false; }
  b.textContent = on ? '⭐ Starred (unstar ke liye dabayein)' : '☆ Is repo ko star karein';
  b.onclick = async () => { try { await gh(`/user/starred/${repo}`, { method: on ? 'DELETE' : 'PUT' }); say(on ? 'Unstar ho gaya' : 'Star ho gaya ⭐'); starBox(); } catch (e) { say(e.message, true); } };
}
$('mfb').onclick = () => { show('menu', false); show('mFork'); };
const fkParse = () => { const v = $('fkn').value.trim(), m = v.match(/github\.com\/([^\/\s]+)\/([^\/\s#?]+)/) || v.match(/^([^\/\s]+)\/([^\/\s]+)$/); return m ? [m[1], m[2].replace(/\.git$/, '')] : null; };
$('fkgo').onclick = async () => { const p = fkParse(); if (!p) return say('owner/name form mein likhein', true); try { await gh(`/repos/${p[0]}/${p[1]}/forks`, { method: 'POST', body: '{}' }); say('Fork shuru 🍴 Kuch second lagenge.'); show('mFork', false); setTimeout(loadRepos, 4000); } catch (e) { say(e.message, true); } };
$('fkst').onclick = async () => { const p = fkParse(); if (!p) return say('owner/name form mein likhein', true); try { await gh(`/user/starred/${p[0]}/${p[1]}`, { method: 'PUT' }); say('Star ho gaya ⭐'); show('mFork', false); } catch (e) { say(e.message, true); } };

/* ===== More: colors, README, issues, collaborators, offline, install, language ===== */
$('zipb').onclick = () => openUp('zip');
function hl(src, ext) {
  const hs = /^(py|sh|bash|yml|yaml|rb|toml|ini)$/.test(ext), kw = 'const|let|var|function|return|if|else|for|while|class|new|import|export|from|async|await|try|catch|throw|def|in|is|not|and|or|None|True|False|null|true|false|undefined|this|switch|case|break|default|typeof|print|elif|lambda|self';
  const re = new RegExp('(\\/\\*[\\s\\S]*?\\*\\/|<!--[\\s\\S]*?-->|\\/\\/[^\\n]*' + (hs ? '|#[^\\n]*' : '') + ')|("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)|(<\\/?[a-zA-Z][\\w-]*)|\\b(' + kw + ')\\b|\\b(\\d+\\.?\\d*)\\b', 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(src))) { out += esc(src.slice(last, m.index)) + `<span class="h${m[1] ? 'c' : m[2] ? 's' : m[3] ? 't' : m[4] ? 'k' : 'n'}">${esc(m[0])}</span>`; last = re.lastIndex; }
  return out + esc(src.slice(last));
}
function md(s) {
  const blocks = [];
  s = esc(s).replace(/```[\w-]*\n([\s\S]*?)```/g, (_, c) => { blocks.push(c); return '\u0001' + (blocks.length - 1) + '\u0001'; });
  return s.replace(/^(#{1,6}) (.*)$/gm, (_, h, t) => `<h${h.length}>${t}</h${h.length}>`).replace(/^(?:-{3,}|\*{3,})$/gm, '<hr>')
    .replace(/^[-*] (.*)$/gm, '<li>$1</li>').replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*\n]+)\*/g, '<i>$1</i>').replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/((?:<li>.*<\/li>\n?)+)/g, m => '<ul>' + m.replace(/\n/g, '') + '</ul>').replace(/\n/g, '<br>').replace(/\u0001(\d+)\u0001/g, (_, i) => `<pre>${blocks[i]}</pre>`);
}
async function editReadme() {
  try { const f = await gh(`/repos/${repo}/readme?ref=${encodeURIComponent(branch)}`); openFile(f.path); }
  catch (e) { showEditor('README.md', '# ' + repo.split('/')[1] + '\n', null); }
}
async function loadIss() {
  const p = $('pIss'); p.innerHTML = '<div class="empty">Load ho raha hai…</div>';
  try {
    const L = (await gh(`/repos/${repo}/issues?state=all&per_page=40`)).filter(x => !x.pull_request);
    p.innerHTML = '<div class="bar" style="margin-bottom:10px"><button class="pri" id="isnew">＋ Naya issue</button></div><div class="list">' + (L.map(x => `<div class="row"><span>${x.state === 'open' ? '🟢' : '🟣'}</span><div style="flex:1;min-width:0"><div style="word-break:break-word">#${x.number} ${esc(x.title)}</div><small>${esc(x.user.login)} · ${ago(x.created_at)}</small></div><button data-iss="${x.number}" data-st="${x.state}">${x.state === 'open' ? 'Band karein' : 'Dobara kholein'}</button></div>`).join('') || '<div class="empty">Koi issue nahi</div>') + '</div>';
    $('isnew').onclick = () => { $('isT').value = ''; $('isB').value = ''; show('mIss'); };
  } catch (e) { p.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
$('pIss').onclick = async e => { const b = e.target.closest('[data-iss]'); if (!b) return; try { await gh(`/repos/${repo}/issues/${b.dataset.iss}`, { method: 'PATCH', body: JSON.stringify({ state: b.dataset.st === 'open' ? 'closed' : 'open' }) }); loadIss(); } catch (er) { say(er.message, true); } };
$('isgo').onclick = async () => { const t = $('isT').value.trim(); if (!t) return say('Title likhein', true); try { await gh(`/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title: t, body: $('isB').value }) }); show('mIss', false); say('Issue ban gaya'); loadIss(); } catch (e) { say(e.message, true); } };
async function loadCol() {
  const L = $('colL'); L.innerHTML = '<div class="empty">Load ho raha hai…</div>';
  try { const c = await gh(`/repos/${repo}/collaborators?per_page=50`); L.innerHTML = c.map(x => `<div class="row"><img src="${esc(x.avatar_url)}" width="28" height="28" style="border-radius:50%" alt=""><span style="flex:1">${esc(x.login)}</span>${x.login === me.login ? '<small>aap</small>' : `<button class="dng" data-rc="${esc(x.login)}">Remove</button>`}</div>`).join(''); }
  catch (e) { L.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
$('colL').onclick = async e => { const b = e.target.closest('[data-rc]'); if (!b || !confirm(b.dataset.rc + ' ko remove karein?')) return; try { await gh(`/repos/${repo}/collaborators/${encodeURIComponent(b.dataset.rc)}`, { method: 'DELETE' }); loadCol(); } catch (er) { say(er.message, true); } };
$('colgo').onclick = async () => { const u = $('colN').value.trim(); if (!u) return; try { await gh(`/repos/${repo}/collaborators/${encodeURIComponent(u)}`, { method: 'PUT', body: JSON.stringify({ permission: 'push' }) }); $('colN').value = ''; say('Invite bhej diya ' + u + ' ko'); loadCol(); } catch (e) { say(e.message, true); } };
const SL = ['full_name', 'name', 'private', 'fork', 'language', 'default_branch', 'pushed_at', 'updated_at', 'stargazers_count', 'forks_count', 'description', 'topics', 'html_url', 'clone_url', 'size', 'created_at'];
function cacheRepos() { store.set('gz_cache', JSON.stringify({ login: me.login, avatar: me.avatar_url, repos: allRepos.map(r => Object.fromEntries(SL.map(k => [k, r[k]]))) })); }
function offlineView() {
  let c; try { c = JSON.parse(store.get('gz_cache')); } catch (e) {} if (!c) return false;
  me = { login: c.login, avatar_url: c.avatar }; allRepos = c.repos; show('login', false); show('app'); show('off'); $('avi').src = c.avatar; wave($('hello'), '@' + c.login); renderStats(); return true;
}
addEventListener('online', () => { if (token && !$('off').classList.contains('hide')) { show('off', false); connect(token); } });
let dip = null; addEventListener('beforeinstallprompt', e => { e.preventDefault(); dip = e; show('inst'); });
$('inst').onclick = () => { if (dip) { dip.prompt(); dip = null; show('inst', false); } };
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
const BN = { 'Need help? WhatsApp': 'Madad chahiye? WhatsApp', 'What is this?': 'Yeh kya hai?', 'github-zip-up is a simple web tool to upload ZIP files to GitHub and manage your repositories from your phone or browser. No git commands, no installs.': 'github-zip-up ek aasan web tool hai. Phone ya browser se hi GitHub par ZIP files upload kar sakte hain aur repos manage kar sakte hain. Koi git command ya install ki zaroorat nahi.', '📦 Upload a ZIP and it unpacks straight into your repo': '📦 ZIP do toh seedha aapke repo mein khul jata hai', '⚡ Fast uploads that resume by themselves if your internet drops': '⚡ Tez upload, net jaye toh khud se dobara shuru hota hai', '🖼️ Edit, rename, delete files, upload images and whole folders': '🖼️ Files edit, rename, delete karein, images aur poore folders upload karein', '🔐 Your token never leaves your browser': '🔐 Aapka token browser se bahar nahi jata', 'Access token': 'Access token', '🔑 Create Token ↗': '🔑 Token banayein ↗', '🚀 Log in now': '🚀 Abhi login karein', '🔄 Reload': '🔄 Reload', '⏳ Uploading…': '⏳ Upload ho raha hai…', '⏳ Reading ZIP…': '⏳ ZIP padhi ja rahi hai…', 'Create token': 'Token banayein', '🔑 Please create a token first, then paste it above.': '🔑 Pehle token banayein, phir upar paste karein.', 'Paste it above': 'Upar paste karein', 'Push files': 'Files push karein', '🔐 Your login is saved only in this browser, so you log in once. Log out to remove it.': '🔐 Login sirf isi browser mein save hota hai, isliye ek hi baar login karna hota hai. Log out karne se mit jata hai.', '🐙 Connect with GitHub': '🐙 GitHub se connect karein', '🔑 Use a token': '🔑 Token se karein', 'Continue with GitHub': 'GitHub ke saath continue karein', '✅ No token needed. You will go to GitHub, press Authorize once, and come straight back here, logged in.': '✅ Token ki zaroorat nahi. Aap GitHub jayenge, ek baar Authorize dabayenge, aur seedha yahan wapas aakar login ho jayenge.', 'Tap Continue': 'Continue dabayein', 'Authorize on GitHub': 'GitHub par Authorize', '↻ Refresh': '↻ Refresh', '⎋ Log out': '⎋ Log out', '📲 Install app': '📲 App install karein', '📴 Offline — showing your saved repo list': '📴 Offline — save ki hui repo list dikha rahe hain', 'Hey': 'Hello', '＋ Create repo': '＋ Naya repo', '🍴 Fork / ⭐ Star': '🍴 Fork / ⭐ Star', '🕘 Upload log': '🕘 Upload log', 'Languages': 'Zubanein', 'tap to filter': 'filter ke liye dabayein', 'Your repos': 'Aapke repo', 'All': 'Sab', '🌐 Public': '🌐 Public', '🔒 Private': '🔒 Private', '🍴 Forks': '🍴 Forks', 'Latest': 'Naya', 'Stars': 'Stars', '📁 Repos': '📁 repos', '⭐ Stars': '⭐ Stars', '🗜️ Upload ZIP': '🗜️ ZIP upload', 'Files': 'Files', 'Issues': 'Issues', 'History': 'Tareekh', 'Info': 'Tafseel', 'Tip: drop files or a ZIP onto the list.': 'Tip: files ya ZIP yahan drop karein.', 'What do you want to do?': 'Kya karna chahte hain?', 'Upload ZIP': 'ZIP upload', 'Upload files': 'Files upload', 'Upload folder': 'Folder upload', 'New file': 'Naya file', 'New folder': 'Naya folder', 'Download ZIP': 'ZIP download', 'Select': 'Select', 'Select all': 'Sab select', 'Cancel': 'Cancel', 'Create': 'Banayein', 'Save': 'Save', 'Close': 'Band', 'Copy': 'Copy', 'Save to GitHub': 'GitHub par save karein', '🎨 Colors': '🎨 Rang badlein', '👁 Preview': '👁 Preview', 'Loading…': 'Load ho raha hai…', 'No issues': 'Koi issue nahi', '＋ New issue': '＋ Naya issue', 'Reopen': 'Dobara kholein', '📋 Copy clone URL': '📋 Clone link copy', '↗ Open on GitHub': '↗ GitHub par kholein', '📘 Edit README': '📘 README edit', '👥 Collaborators': '👥 Sath kaam karne wale', 'Collaborators': 'Sath kaam karne wale', 'New issue': 'Naya issue', '＋ Invite': '＋ Dawat', 'Delete': 'Delete', 'Done': 'Ho gaya', 'Create repo': 'Naya repo', 'crafted by': 'banaya gaya', '⬇ Download repo ZIP': '⬇ Repo ZIP download', 'Save details': 'Tafseel save karein', '🌿 Branches': '🌿 Branches', 'Smart match: update files with the same name': 'Smart match: ek hi naam ki files update karein', 'Select your ZIP': 'Apni ZIP chunein', 'Select your files': 'Apni files chunein', 'Select your folder': 'Apna folder chunein', '⬆ Upload ZIP now': '⬆ ZIP upload karein', '⬆ Upload now': '⬆ Abhi upload karein', '↩ Undo last change': '↩ Aakhri tabdeeli wapas', '📊 Biggest files': '📊 Sabse bade files', '↻ Rotate': '↻ Ghoomao', '↺ Reset': '↺ Reset', '💾 Save': '💾 Save', 'Back': 'Wapas' };
const BNP = { '🔎 Search every file in this repo…': '🔎 Is repo ki har file mein khojein…' };
const orig = new WeakMap(); let lg = store.get('gz_lg') === 'bn' ? 'bn' : 'en', trBusy = false;
const tx = o => { const t = o.trim(); return lg === 'bn' && BN[t] ? o.replace(t, BN[t]) : o; };
function tr(root) {
  if (trBusy) return; trBusy = true;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) {
    if (/^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentNode.nodeName)) continue;
    let o = orig.get(n); if (o === undefined || (n.nodeValue !== o && n.nodeValue !== tx(o))) { o = n.nodeValue; orig.set(n, o); }
    const v = tx(o); if (n.nodeValue !== v) n.nodeValue = v;
  }
  document.querySelectorAll('[placeholder]').forEach(el => { if (el.dataset.ph === undefined) el.dataset.ph = el.placeholder; el.placeholder = (lg === 'bn' && BNP[el.dataset.ph]) || el.dataset.ph; });
  trBusy = false;
}
new MutationObserver(m => { if (lg === 'bn' && !trBusy && m.some(x => { const el = x.target.nodeType === 3 ? x.target.parentNode : x.target; return el && el.closest && !el.closest('.tagl') && !el.closest('#flist'); })) requestAnimationFrame(() => tr(document.body)); }).observe(document.body, { childList: true, subtree: true, characterData: true });
function setLang(l) { lg = l; store.set('gz_lg', l); document.documentElement.lang = l; document.querySelectorAll('[data-lg]').forEach(b => b.classList.toggle('on', b.dataset.lg === l)); tr(document.body); }
document.addEventListener('click', e => { const b = e.target.closest('[data-lg]'); if (b) setLang(b.dataset.lg); });
setLang(lg);

/* ===== Start: agar GitHub se wapas aaye hain toh login finish karo, warna saved token use karo ===== */
(async () => {
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  if (await oauthReturn()) return;
  const t = store.get('gm_token'); if (t) connect(t); else if (!navigator.onLine) offlineView();
})();
/* Naya feature: gh('/repos/...') call likh kar ek button se jod dein. */
