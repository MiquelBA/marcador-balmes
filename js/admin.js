import {
  sb, teamSlug, loadTeam, syncServerClock, serverNow, remainingMs, fmtClock, ordinal, fmtDate, esc, sides,
  unlockAudio, playSound, keepAwake, goFullscreen, toggleFullscreen, canFullscreen, toast, outcome,
} from './common.js?v=5';
import { showFinalEffect } from './effects.js?v=5';

const $ = (id) => document.getElementById(id);
const PIN_KEY = `mb_pin_${teamSlug}`;
const store = {
  get() { try { return localStorage.getItem(PIN_KEY); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(PIN_KEY, v); } catch (e) {} },
  del() { try { localStorage.removeItem(PIN_KEY); } catch (e) {} },
};

let team = null;
let pin = null;
let match = null;      // partit que s'està controlant
let pending = 0;       // crides de puntuació en curs
let channel = null;
let autoEndKey = null;

const show = (id) => {
  ['pinView', 'homeView', 'ctrlView'].forEach((v) => $(v).classList.toggle('hidden', v !== id));
  $('rotateOverlay').classList.toggle('hidden', id !== 'ctrlView');
};
document.addEventListener('click', (e) => { if (e.target.closest('[data-portrait-ok]')) document.body.classList.add('portrait-ok'); });
const buzz = (p) => { try { navigator.vibrate?.(p); } catch (e) { /* no suportat */ } };

/* ---------------- RPC amb PIN ---------------- */
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, { p_pin: pin, ...args });
  if (error) {
    if (/PIN incorrecte/.test(error.message)) { logout(); toast('PIN incorrecte'); }
    else toast('Error: ' + error.message, 3500);
    throw error;
  }
  return data;
}

/* ---------------- PIN ---------------- */
let entered = '';
$('pinpad').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  unlockAudio();
  if (b.hasAttribute('data-del')) entered = entered.slice(0, -1);
  else if (entered.length < 4) entered += b.textContent;
  paintDots();
  if (entered.length === 4) {
    const ok = await checkPin(entered);
    if (ok) { pin = entered; store.set(pin); entered = ''; paintDots(); goHome(); }
    else {
      const d = $('pinDots'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
      buzz(200);
      setTimeout(() => { entered = ''; paintDots(); }, 400);
    }
  }
});
function paintDots() { [...$('pinDots').children].forEach((i, n) => i.classList.toggle('on', n < entered.length)); }
async function checkPin(p) {
  const { data, error } = await sb.rpc('admin_login', { p_team_slug: teamSlug, p_pin: p });
  if (error) { toast('Error de connexió'); return false; }
  return data === true;
}
function logout() { pin = null; store.del(); match = null; show('pinView'); }
$('logoutBtn').addEventListener('click', logout);

/* ---------------- Inici ---------------- */
async function goHome() {
  match = null;
  show('homeView');
  const { data } = await sb.from('matches').select('*').eq('team_id', team.id)
    .order('created_at', { ascending: false }).limit(15);
  const list = data || [];
  const live = list.find((m) => m.status === 'live');
  $('liveCard').innerHTML = live ? `
    <div class="card" style="border-color:var(--green)">
      <div class="live-dot">EN JOC</div>
      <div class="mc-teams" style="font-size:1.2rem;margin:.4em 0">Balmes <span style="color:var(--green-2)">${live.score_us}</span> – ${live.score_them} ${esc(live.opponent)}</div>
      <div class="mc-sub">${ordinal(live.current_period)} quart · ${fmtDate(live.match_date)}${live.location ? ' · ' + esc(live.location) : ''}</div>
      <button class="btn block" style="margin-top:12px" data-open="${live.id}">▶ Continuar el partit</button>
    </div>` : '';
  $('recentList').innerHTML = list.filter((m) => m !== live).map((m) => {
    const r = outcome(m);
    return `<div class="match-card"><div class="mc-head">
      <div class="badge ${r}">${{ win: 'V', loss: 'D', tie: 'E' }[r]}</div>
      <div class="mc-main"><div class="mc-teams">${esc(m.opponent)}</div>
        <div class="mc-sub">${fmtDate(m.match_date)} · ${m.is_home ? 'Casa' : 'Fora'}</div></div>
      <div class="mc-score"><span class="u">${m.score_us}</span>-${m.score_them}</div></div>
      <div class="mc-body"><div class="mc-actions">
        <button class="btn secondary" data-reopen="${m.id}">↺ Reobrir</button>
        <button class="btn danger" data-del="${m.id}" data-name="${esc(m.opponent)}">🗑 Esborrar</button>
      </div></div></div>`;
  }).join('') || '<p style="color:var(--muted)">Encara no hi ha partits.</p>';
}

$('homeView').addEventListener('click', async (e) => {
  const open = e.target.closest('[data-open]');
  const reopen = e.target.closest('[data-reopen]');
  const del = e.target.closest('[data-del]');
  if (open) openMatch(open.dataset.open);
  if (reopen) {
    if (!await confirmModal('Reobrir el partit?', 'Tornarà a aparèixer com a partit en joc al marcador dels pares.', 'Reobrir')) return;
    await rpc('admin_finish', { p_match_id: reopen.dataset.reopen, p_finished: false });
    openMatch(reopen.dataset.reopen);
  }
  if (del) {
    if (!await confirmModal('Esborrar el partit?', `Contra ${del.dataset.name}. Aquesta acció no es pot desfer.`, 'Esborrar', true)) return;
    await rpc('admin_delete_match', { p_match_id: del.dataset.del });
    toast('Partit esborrat'); goHome();
  }
});
$('newMatchBtn').addEventListener('click', () => matchForm());

/* ---------------- Formulari de partit ---------------- */
function matchForm(existing = null) {
  const m = existing || { opponent: '', is_home: true, location: '', match_date: new Date().toLocaleDateString('sv-SE'), num_periods: 4, period_seconds: 600 };
  let home = m.is_home, periods = m.num_periods, minutes = Math.round(m.period_seconds / 60);
  openModal(`
    <h3>${existing ? 'Editar el partit' : 'Nou partit'}</h3>
    <label class="field"><span>Equip rival</span><input class="input" id="fOpp" maxlength="40" placeholder="Ex: Col·legi Sant Ignasi" value="${esc(m.opponent)}" autocomplete="off"></label>
    <div class="field"><span>On juguem?</span><div class="seg" id="fHome">
      <button type="button" data-v="1">🏠 A casa</button><button type="button" data-v="0">🚌 A fora</button></div></div>
    <label class="field"><span>Lloc (pavelló o pati)</span><input class="input" id="fLoc" maxlength="60" placeholder="Ex: Pati de l'escola" value="${esc(m.location)}"></label>
    <label class="field"><span>Data</span><input class="input" type="date" id="fDate" value="${m.match_date}"></label>
    <div class="row">
      <div class="field"><span>Quarts</span><div class="stepper"><button type="button" data-step="p-">−</button><output id="fPer"></output><button type="button" data-step="p+">+</button></div></div>
      <div class="field"><span>Minuts per quart</span><div class="stepper"><button type="button" data-step="m-">−</button><output id="fMin"></output><button type="button" data-step="m+">+</button></div></div>
    </div>
    <div class="modal-actions">
      <button class="btn secondary" data-close>Cancel·lar</button>
      <button class="btn" id="fSave">${existing ? 'Desar' : 'Començar ▶'}</button>
    </div>`);
  const paint = () => {
    [...$('fHome').children].forEach((b) => b.classList.toggle('on', (b.dataset.v === '1') === home));
    $('fPer').textContent = periods; $('fMin').textContent = minutes;
  };
  paint();
  $('fHome').onclick = (e) => { const b = e.target.closest('button'); if (b) { home = b.dataset.v === '1'; paint(); } };
  $('modalCard').querySelectorAll('[data-step]').forEach((b) => b.onclick = () => {
    const s = b.dataset.step;
    if (s === 'p-') periods = Math.max(1, periods - 1);
    if (s === 'p+') periods = Math.min(6, periods + 1);
    if (s === 'm-') minutes = Math.max(1, minutes - 1);
    if (s === 'm+') minutes = Math.min(30, minutes + 1);
    paint();
  });
  if (!existing) setTimeout(() => $('fOpp').focus(), 50);
  $('fSave').onclick = async () => {
    const opp = $('fOpp').value.trim();
    if (!opp) { $('fOpp').focus(); toast('Escriu el nom del rival'); return; }
    const args = { p_opponent: opp, p_is_home: home, p_location: $('fLoc').value.trim(), p_match_date: $('fDate').value || new Date().toLocaleDateString('sv-SE'), p_num_periods: periods, p_period_seconds: minutes * 60 };
    $('fSave').disabled = true;
    try {
      if (existing) {
        await rpc('admin_update_match', { p_match_id: existing.id, ...args });
        closeModal(); toast('Partit actualitzat'); refresh();
      } else {
        const id = await rpc('admin_create_match', { p_team_slug: teamSlug, ...args });
        closeModal(); openMatch(id);
      }
    } catch (e) { $('fSave').disabled = false; }
  };
}

/* ---------------- Modals ---------------- */
function openModal(html) { $('modalCard').innerHTML = html; $('modal').classList.remove('hidden'); $('modalCard').querySelectorAll('[data-close]').forEach((b) => b.onclick = closeModal); }
function closeModal() { $('modal').classList.add('hidden'); $('modalCard').innerHTML = ''; }
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
function confirmModal(title, text, okText = 'D\'acord', danger = false) {
  return new Promise((resolve) => {
    openModal(`<h3>${title}</h3><p style="color:var(--muted)">${text}</p>
      <div class="modal-actions"><button class="btn secondary" id="cNo">Cancel·lar</button><button class="btn ${danger ? 'danger' : ''}" id="cYes">${okText}</button></div>`);
    $('cNo').onclick = () => { closeModal(); resolve(false); };
    $('cYes').onclick = () => { closeModal(); resolve(true); };
  });
}

/* ---------------- Control del partit ---------------- */
async function openMatch(id) {
  const { data, error } = await sb.from('matches').select('*').eq('id', id).single();
  if (error) { toast('No s\'ha pogut obrir el partit'); return; }
  match = data;
  show('ctrlView');
  unlockAudio(); keepAwake();
  if (matchMedia('(pointer: coarse)').matches) goFullscreen();
  buildPts();
  render(true);
}

function buildPts() {
  for (const el of [$('teamL'), $('teamR')]) {
    el.querySelector('[data-pts]').innerHTML =
      '<button class="plus" data-d="1">+1</button><button class="plus" data-d="2">+2</button><button class="plus" data-d="3">+3</button><button class="minus" data-d="-1">−1</button>';
  }
}

for (const el of [$('teamL'), $('teamR')]) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]'); if (!b || !match) return;
    score(el.dataset.side, Number(b.dataset.d));
  });
}

async function score(side, d) {
  const key = side === 'us' ? 'score_us' : 'score_them';
  if (match[key] + d < 0) return;
  match = { ...match, [key]: match[key] + d };
  buzz(25);
  render();
  pending++;
  try { await rpc('admin_score', { p_match_id: match.id, p_side: side, p_delta: d }); }
  catch (e) { /* es corregeix en refrescar */ }
  finally { pending--; if (pending === 0) refresh(); }
}

async function refresh() {
  if (!match) return;
  const { data } = await sb.from('matches').select('*').eq('id', match.id).single();
  if (data && pending === 0) { match = data; render(); }
}

$('playBtn').addEventListener('click', async () => {
  if (!match || match.status !== 'live') return;
  const running = match.clock_running;
  const ms = remainingMs(match);
  if (!running && ms <= 0) { toast('El quart s\'ha acabat. Passa al següent quart ▶'); return; }
  // optimista
  match = { ...match, clock_running: !running, clock_remaining_ms: ms, clock_updated_at: new Date(serverNow()).toISOString() };
  render();
  await rpc('admin_clock', { p_match_id: match.id, p_action: running ? 'pause' : 'start' }).catch(() => {});
  refresh();
});

$('clock').addEventListener('click', () => clockModal());
function clockModal() {
  if (!match) return;
  const ms = remainingMs(match);
  const tot = Math.ceil(ms / 1000);
  openModal(`<h3>Canviar el temps</h3>
    <div class="row">
      <label class="field"><span>Minuts</span><input class="input" type="number" inputmode="numeric" min="0" max="60" id="tMin" value="${Math.floor(tot / 60)}"></label>
      <label class="field"><span>Segons</span><input class="input" type="number" inputmode="numeric" min="0" max="59" id="tSec" value="${tot % 60}"></label>
    </div>
    <button class="btn secondary block" id="tReset">↺ Reiniciar el quart (${fmtClock(match.period_seconds * 1000)})</button>
    <div class="modal-actions"><button class="btn secondary" data-close>Cancel·lar</button><button class="btn" id="tSave">Desar</button></div>`);
  $('tReset').onclick = () => { $('tMin').value = Math.floor(match.period_seconds / 60); $('tSec').value = match.period_seconds % 60; };
  $('tSave').onclick = async () => {
    const v = (Math.max(0, +$('tMin').value || 0) * 60 + Math.min(59, Math.max(0, +$('tSec').value || 0))) * 1000;
    closeModal();
    match = { ...match, clock_running: false, clock_remaining_ms: v };
    render();
    await rpc('admin_clock', { p_match_id: match.id, p_action: 'set', p_ms: v }).catch(() => {});
    refresh();
  };
}

async function changePeriod(dir) {
  if (!match) return;
  const p = match.current_period + dir;
  if (p < 1) return;
  if (p > match.num_periods) { finishFlow(); return; }
  if (match.clock_running && !await confirmModal('El rellotge està en marxa', `Vols passar al ${ordinal(p)} quart igualment?`, 'Sí, canviar')) return;
  match = { ...match, current_period: p, clock_running: false, clock_remaining_ms: match.period_seconds * 1000 };
  render();
  await rpc('admin_period', { p_match_id: match.id, p_period: p }).catch(() => {});
  refresh();
}
$('prevPeriod').addEventListener('click', () => changePeriod(-1));
$('nextPeriod').addEventListener('click', () => changePeriod(1));

async function sound(kind) {
  if (!match) return;
  playSound(kind);
  rpc('admin_sound', { p_match_id: match.id, p_sound: kind }).catch(() => {});
}
$('whistleBtn').addEventListener('click', () => sound('whistle'));
$('hornBtn').addEventListener('click', () => sound('horn'));

$('editBtn').addEventListener('click', () => match && matchForm(match));
$('finishBtn').addEventListener('click', () => finishFlow());
$('menuBtn').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); goHome(); });
if (!canFullscreen()) $('fsBtn').classList.add('hidden');
$('fsBtn').addEventListener('click', toggleFullscreen);

async function finishFlow() {
  if (!match) return;
  const ok = await confirmModal('Finalitzar el partit?', `Resultat final: <b>Balmes ${match.score_us} – ${match.score_them} ${esc(match.opponent)}</b>. Es guardarà a l'historial.`, '🏁 Finalitzar');
  if (!ok) return;
  await rpc('admin_finish', { p_match_id: match.id, p_finished: true });
  playSound('horn');
  const final = { ...match, status: 'finished' };
  showFinalEffect(final, team.name);
  await refresh();
  setTimeout(() => goHome(), 600);
}

/* ---------------- Pintar ---------------- */
let lastClock = '';
function render(force = false) {
  if (!match) return;
  const m = match;
  const [L, R] = sides(m, team);
  paint($('teamL'), L); paint($('teamR'), R);
  $('period').textContent = ordinal(m.current_period);
  $('prevPeriod').disabled = m.current_period <= 1;
  $('nextPeriod').textContent = m.current_period >= m.num_periods ? '🏁' : '▶';
  $('playBtn').classList.toggle('running', m.clock_running);
  $('playBtn').innerHTML = m.clock_running
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z"/></svg>';
  $('playBtn').setAttribute('aria-label', m.clock_running ? 'Aturar el rellotge (temps mort)' : 'Engegar el rellotge');
  lastClock = '';
  tick();
}
function paint(el, side) {
  el.dataset.side = side.key;
  el.classList.toggle('us', side.isUs); el.classList.toggle('them', !side.isUs);
  el.querySelector('[data-name]').textContent = side.isUs ? 'Balmes' : side.name;
  const sc = el.querySelector('[data-score]');
  if (sc.textContent !== String(side.score)) { sc.textContent = side.score; sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump'); }
}
function tick() {
  if (!match || $('ctrlView').classList.contains('hidden')) return;
  const ms = remainingMs(match);
  const t = fmtClock(ms);
  if (t !== lastClock) { $('clock').textContent = t; lastClock = t; }
  $('clock').className = 'clock-box' + (ms <= 0 ? ' zero' : match.clock_running ? ' running' : '');
  const lbl = ms <= 0 ? 'final del quart' : match.clock_running ? 'en marxa' : 'aturat · toca per editar';
  if ($('clockLabel').textContent !== lbl) $('clockLabel').textContent = lbl;
  // Final automàtic del quart: atura el rellotge i fa sonar la botzina a tothom
  if (match.clock_running && ms <= 0) {
    const key = `${match.id}-${match.current_period}-${match.clock_updated_at}`;
    if (autoEndKey !== key) {
      autoEndKey = key;
      match = { ...match, clock_running: false, clock_remaining_ms: 0 };
      render();
      rpc('admin_clock', { p_match_id: match.id, p_action: 'pause' }).then(refresh).catch(() => {});
      sound('horn');
    }
  }
}
(function loop() { tick(); requestAnimationFrame(loop); })();

/* ---------------- Temps real (per si hi ha dos administradors) ---------------- */
function subscribe() {
  channel = sb.channel(`admin-${team.id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `team_id=eq.${team.id}` }, (p) => {
      if (!match || p.new.id !== match.id || pending > 0) return;
      match = p.new; render();
    }).subscribe();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { syncServerClock(); refresh(); }
});

/* ---------------- Inici ---------------- */
(async function init() {
  try {
    team = await loadTeam();
    if (!team) { document.body.innerHTML = '<div class="empty"><h2>Equip no trobat</h2></div>'; return; }
    syncServerClock();
    subscribe();
    const saved = store.get();
    if (saved && await checkPin(saved)) { pin = saved; goHome(); }
    else show('pinView');
  } catch (e) {
    console.error(e); toast('Error de connexió', 4000); show('pinView');
  }
})();
