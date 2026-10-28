import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, DEFAULT_TEAM, SCHOOL } from './config.js?v=8';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 20 } },
});

export const teamSlug = new URLSearchParams(location.search).get('equip') || DEFAULT_TEAM;
export const withTeam = (path) => teamSlug === DEFAULT_TEAM ? path : `${path}?equip=${encodeURIComponent(teamSlug)}`;

export async function loadTeam() {
  const { data, error } = await sb.from('teams').select('*').eq('slug', teamSlug).maybeSingle();
  if (error) throw error;
  if (data?.category) document.querySelectorAll('[data-team-cat]').forEach((el) => { el.textContent = data.category; });
  return data;
}

/* ---------- Rellotge sincronitzat amb el servidor ---------- */
let offset = 0; // serverTime - clientTime
export async function syncServerClock() {
  try {
    let best = null;
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      const { data } = await sb.rpc('server_now');
      const t1 = Date.now();
      const rtt = t1 - t0;
      const off = Date.parse(data) - (t0 + rtt / 2);
      if (!best || rtt < best.rtt) best = { rtt, off };
    }
    offset = best.off;
  } catch (e) { console.warn('No s\'ha pogut sincronitzar el rellotge', e); }
}
export const serverNow = () => Date.now() + offset;

export function remainingMs(m) {
  if (!m) return 0;
  if (!m.clock_running) return Math.max(0, m.clock_remaining_ms);
  return Math.max(0, m.clock_remaining_ms - (serverNow() - Date.parse(m.clock_updated_at)));
}

export function fmtClock(ms) {
  const totalTenths = Math.ceil(ms / 100);
  if (ms > 0 && ms < 60000) { // últim minut: segons i dècimes
    const s = Math.floor(totalTenths / 10), d = totalTenths % 10;
    return `${s}.${d}`;
  }
  const total = Math.ceil(ms / 1000);
  const mm = Math.floor(total / 60), ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export const ordinal = (n) => ({ 1: '1r', 2: '2n', 3: '3r', 4: '4t' }[n] || `${n}è`);

export function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString('ca-ES', opts);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function outcome(m) {
  if (m.score_us > m.score_them) return 'win';
  if (m.score_us < m.score_them) return 'loss';
  return 'tie';
}

/* Ordre dels equips: el local sempre a l'esquerra */
export function sides(m, team) {
  const us = { key: 'us', name: team?.name || SCHOOL.name, short: SCHOOL.short, score: m.score_us, isUs: true };
  const them = { key: 'them', name: m.opponent, short: m.opponent, score: m.score_them, isUs: false };
  return m.is_home ? [us, them] : [them, us];
}

/* ---------- Sons (sintetitzats, sense fitxers) ---------- */
let ctx = null;
export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    // so buit per desbloquejar iOS
    const b = ctx.createBuffer(1, 1, 22050); const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
  } catch (e) { /* sense àudio */ }
  return !!ctx;
}
export const audioReady = () => !!ctx && ctx.state === 'running';

export function playSound(kind) {
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  if (kind === 'whistle') whistle(); else horn();
  try { navigator.vibrate?.(kind === 'horn' ? [300, 80, 300] : [120, 60, 120]); } catch (e) { /* no suportat */ }
}

function whistle() {
  const t = ctx.currentTime;
  const master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination);
  // dos xiulets curts i un de llarg
  const blasts = [[0, 0.22], [0.3, 0.75]];
  for (const [start, dur] of blasts) {
    const o = ctx.createOscillator(); o.type = 'sine';
    const o2 = ctx.createOscillator(); o2.type = 'sine';
    o.frequency.value = 2850; o2.frequency.value = 3010;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 38;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 140;
    lfo.connect(lfoGain); lfoGain.connect(o.frequency); lfoGain.connect(o2.frequency);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + start);
    g.gain.exponentialRampToValueAtTime(0.35, t + start + 0.02);
    g.gain.setValueAtTime(0.35, t + start + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
    o.connect(g); o2.connect(g); g.connect(ctx.destination);
    [o, o2, lfo].forEach((n) => { n.start(t + start); n.stop(t + start + dur + 0.02); });
  }
}

function horn() {
  const t = ctx.currentTime, dur = 1.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.03);
  g.gain.setValueAtTime(0.32, t + dur - 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curve[i] = Math.tanh(3.2 * x); }
  shaper.curve = curve;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  shaper.connect(lp); lp.connect(g); g.connect(ctx.destination);
  for (const f of [233, 277, 349, 466]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const og = ctx.createGain(); og.gain.value = 0.28;
    o.connect(og); og.connect(shaper); o.start(t); o.stop(t + dur + 0.02);
  }
}

/* ---------- Pantalla ---------- */
let wakeLock = null;
export async function keepAwake() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }
      }, { once: false });
    }
  } catch (e) { /* no suportat */ }
}

export async function goFullscreen() {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch (e) { /* iPhone no ho permet: s'aconsegueix afegint a la pantalla d'inici */ }
  try { await screen.orientation.lock('landscape'); } catch (e) { /* no suportat */ }
}
export async function toggleFullscreen() {
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) {} }
  else await goFullscreen();
}
export const canFullscreen = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;

/* Botó de pantalla completa: on el navegador ho permet, pantalla completa;
   a l'iPhone (Apple no ho permet a les webs), instruccions per afegir-la a la pantalla d'inici. */
export function setupFullscreenButton(btn) {
  if (!btn) return;
  if (isStandalone()) { btn.classList.add('hidden'); return; }
  btn.classList.remove('hidden');
  btn.addEventListener('click', () => {
    if (canFullscreen()) toggleFullscreen();
    else showInstallHelp();
  });
}

export function showInstallHelp() {
  document.querySelector('.a2hs-modal')?.remove();
  const share = '<span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg></span>';
  const plus = '<span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg></span>';
  const el = document.createElement('div');
  el.className = 'modal a2hs-modal';
  el.innerHTML = `<div class="modal-card a2hs">
    <h3>📱 Veure-ho a pantalla completa</h3>
    <p style="color:var(--muted);margin-top:0">A l'iPhone, Apple no deixa posar una web a pantalla completa. La solució és afegir el marcador a la pantalla d'inici (només s'ha de fer un cop):</p>
    <ol>
      <li>Toca el botó <b>Compartir</b> ${share} del navegador (a dalt o a baix, al costat de l'adreça).</li>
      <li>Tria <b>Afegeix a la pantalla d'inici</b> ${plus} (si no hi és, baixa una mica la llista).</li>
      <li>Toca <b>Afegeix</b>.</li>
      <li>A partir d'ara, obre el marcador des de la nova icona 🏀: es veurà a pantalla completa, sense barres.</li>
    </ol>
    <p class="note">Si fas servir Chrome a l'iPhone i no hi veus l'opció, obre piabalmes.com amb Safari i fes-ho des d'allà.</p>
    <div class="modal-actions"><button class="btn" data-close>Entesos</button></div>
  </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) el.remove(); });
}

export function toast(msg, ms = 2200) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), ms);
}

export function emblemImg(cls = 'emblem') {
  return `<img class="${cls}" src="${SCHOOL.emblem}" alt="" onerror="this.style.display='none'">`;
}
