import {
  sb, loadTeam, syncServerClock, serverNow, remainingMs, fmtClock, ordinal, fmtDate, esc, sides,
  unlockAudio, playSound, keepAwake, goFullscreen, toggleFullscreen, canFullscreen, toast, outcome,
} from './common.js';
import { showFinalEffect } from './effects.js';

const $ = (id) => document.getElementById(id);
let team = null;
let match = null;
let soundOn = false;
let lastClockText = '';

/* ---------- Inici ---------- */
$('startSound').addEventListener('click', () => enter(true));
$('startMute').addEventListener('click', () => enter(false));
$('soundBtn').addEventListener('click', () => {
  soundOn = !soundOn;
  if (soundOn) { unlockAudio(); playSound('whistle'); }
  updateSoundBtn();
  toast(soundOn ? 'So activat 🔊' : 'So desactivat 🔇');
});
if (!canFullscreen()) $('fsBtn').classList.add('hidden');
$('fsBtn').addEventListener('click', toggleFullscreen);

function enter(withSound) {
  soundOn = withSound;
  if (withSound) unlockAudio();
  updateSoundBtn();
  $('start').classList.add('hidden');
  keepAwake();
  if (matchMedia('(pointer: coarse)').matches) goFullscreen();
}
function updateSoundBtn() {
  $('soundBtn').textContent = soundOn ? '🔊' : '🔇';
  $('soundBtn').setAttribute('aria-label', soundOn ? 'Silenciar' : 'Activar el so');
}

/* ---------- Dades ---------- */
async function fetchLatest() {
  const { data, error } = await sb.from('matches').select('*')
    .eq('team_id', team.id).order('created_at', { ascending: false }).limit(1);
  if (error) { console.error(error); return; }
  setMatch(data[0] || null, { silent: true });
}

function setMatch(m, { silent = false } = {}) {
  const prev = match;
  match = m;
  if (!silent && prev && m && prev.id === m.id) {
    if (m.sound_seq > prev.sound_seq && m.sound_at && serverNow() - Date.parse(m.sound_at) < 8000) onSound(m.sound);
    if (prev.status === 'live' && m.status === 'finished') setTimeout(() => showFinalEffect(m, team.name), 300);
  }
  render(prev);
}

function onSound(kind) {
  if (soundOn) playSound(kind);
  const f = document.createElement('div');
  f.className = 'sound-flash';
  f.textContent = kind === 'horn' ? '📢 MEEEC!' : '😗 PIIIIT!';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1300);
}

/* ---------- Pintar ---------- */
const todayISO = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD local

function render(prev) {
  // Un partit acabat d'un altre dia ja no es mostra com a marcador
  if (!match || (match.status === 'finished' && match.match_date < todayISO())) {
    $('board').classList.add('hidden');
    $('empty').classList.remove('hidden');
    lastFinishedInfo();
    return;
  }
  $('empty').classList.add('hidden');
  $('board').classList.remove('hidden');

  const m = match;
  const [L, R] = sides(m, team);
  paintTeam($('teamL'), L, m.is_home ? 'Local' : 'Local', prev);
  paintTeam($('teamR'), R, 'Visitant', prev);

  $('period').textContent = ordinal(m.current_period);
  $('liveLabel').classList.toggle('hidden', m.status !== 'live');

  // Parcials per quart
  const ps = Array.isArray(m.period_scores) ? m.period_scores : [];
  $('quarters').innerHTML = ps.slice(0, m.num_periods).map((q, i) => {
    const played = i + 1 <= m.current_period || m.status === 'finished';
    const usFirst = m.is_home;
    const a = usFirst ? `<span class="u">${q.us}</span>` : q.them;
    const b = usFirst ? q.them : `<span class="u">${q.us}</span>`;
    return `<div class="q ${i + 1 === m.current_period && m.status === 'live' ? 'cur' : ''}"><b>${ordinal(i + 1)}</b>${played ? `${a}-${b}` : '–'}</div>`;
  }).join('');

  const where = [m.location, fmtDate(m.match_date, { day: 'numeric', month: 'short' })].filter(Boolean);
  $('meta').textContent = where.join(' · ');
  document.title = `${L.short} ${L.score}–${R.score} ${R.short} · Marcador`;
  lastClockText = '';
  tick();
}

function paintTeam(el, side, tag, prev) {
  el.classList.toggle('us', side.isUs);
  el.classList.toggle('them', !side.isUs);
  el.querySelector('[data-name]').textContent = side.isUs ? 'Balmes' : side.name;
  el.querySelector('[data-name]').title = side.name;
  el.querySelector('[data-tag]').textContent = tag;
  const sc = el.querySelector('[data-score]');
  if (sc.textContent !== String(side.score)) {
    sc.textContent = side.score;
    if (prev) { sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump'); }
  }
}

function tick() {
  if (!match || $('board').classList.contains('hidden')) return;
  const clock = $('clock'), label = $('clockLabel');
  if (match.status === 'finished') {
    if (lastClockText !== 'FINAL') {
      clock.textContent = 'FINAL'; clock.className = 'clock-box final';
      label.textContent = { win: 'Hem guanyat! 🏆', loss: 'Bon partit! 💙', tie: 'Empat' }[outcome(match)];
      label.className = 'clock-label';
      lastClockText = 'FINAL';
    }
    return;
  }
  const ms = remainingMs(match);
  const txt = fmtClock(ms);
  if (txt !== lastClockText) {
    clock.textContent = txt;
    lastClockText = txt;
  }
  clock.className = 'clock-box' + (ms <= 0 ? ' zero' : match.clock_running ? ' running' : '');
  const lbl = ms <= 0 ? 'Final del quart' : match.clock_running ? ' ' : 'Temps aturat';
  if (label.textContent !== lbl) label.textContent = lbl;
  label.className = 'clock-label' + (!match.clock_running && ms > 0 ? ' paused' : '');
}
(function loop() { tick(); requestAnimationFrame(loop); })();

/* ---------- Temps real ---------- */
function subscribe() {
  sb.channel(`matches-${team.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `team_id=eq.${team.id}` }, (p) => {
      if (p.eventType === 'DELETE') { if (match && p.old.id === match.id) fetchLatest(); return; }
      const n = p.new;
      if (!match || n.id === match.id || Date.parse(n.created_at) >= Date.parse(match.created_at)) setMatch(n);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') fetchLatest();
    });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && team) { syncServerClock(); fetchLatest(); }
});
setInterval(() => team && document.visibilityState === 'visible' && fetchLatest(), 30000);

async function lastFinishedInfo() {
  const { data } = await sb.from('matches').select('*').eq('team_id', team.id)
    .eq('status', 'finished').order('match_date', { ascending: false }).limit(1);
  const m = data?.[0];
  if (m) {
    $('lastMatch').innerHTML = `<div class="last"><div class="section-title" style="margin:0 0 6px">Últim partit</div>
      <b>Balmes ${m.score_us} – ${m.score_them} ${esc(m.opponent)}</b><div class="mc-sub">${fmtDate(m.match_date)}</div></div>`;
  }
}

(async function init() {
  try {
    team = await loadTeam();
    if (!team) { document.body.innerHTML = '<div class="empty"><h2>Equip no trobat</h2></div>'; return; }
    await syncServerClock();
    await fetchLatest();
    subscribe();
  } catch (e) {
    console.error(e);
    toast('Error de connexió. Torna-ho a provar.', 4000);
  }
})();
