import { sb, loadTeam, fmtDate, esc, outcome, ordinal, withTeam } from './common.js?v=7';

const $ = (id) => document.getElementById(id);
let team, all = [];

// Temporada escolar: de setembre a agost
const seasonOf = (iso) => { const [y, m] = iso.split('-').map(Number); const s = m >= 9 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; };

function render() {
  const season = $('season').value;
  const ms = all.filter((m) => seasonOf(m.match_date) === season);
  const fin = ms.filter((m) => m.status === 'finished');
  const live = ms.filter((m) => m.status === 'live');
  const w = fin.filter((m) => outcome(m) === 'win').length;
  const l = fin.filter((m) => outcome(m) === 'loss').length;
  const t = fin.length - w - l;
  $('stats').innerHTML = `
    <div class="stat"><b>${fin.length}</b><span>Partits</span></div>
    <div class="stat w"><b>${w}</b><span>Victòries</span></div>
    <div class="stat l"><b>${l}</b><span>Derrotes</span></div>
    <div class="stat"><b>${t}</b><span>Empats</span></div>`;

  $('live').innerHTML = live.map((m) => `
    <a href="${withTeam('index.html')}" style="text-decoration:none;color:inherit;display:block;margin-top:16px">
      <div class="match-card" style="border-color:var(--red)"><div class="mc-head">
        <div class="badge live">LIVE</div>
        <div class="mc-main"><div class="mc-teams">${esc(m.opponent)}</div><div class="mc-sub">En joc · ${ordinal(m.current_period)} quart · toca per veure-ho</div></div>
        <div class="mc-score"><span class="u">${m.score_us}</span>-${m.score_them}</div>
      </div></div></a>`).join('');

  $('list').innerHTML = fin.map(card).join('') || '<p style="color:var(--muted)">Encara no hi ha partits acabats aquesta temporada.</p>';
}

function card(m) {
  const r = outcome(m);
  const ps = (Array.isArray(m.period_scores) ? m.period_scores : []).slice(0, m.num_periods);
  const hasQ = ps.some((q) => q.us || q.them);
  const rows = [
    { name: team.name, cls: 'us', vals: ps.map((q) => q.us), tot: m.score_us },
    { name: m.opponent, cls: '', vals: ps.map((q) => q.them), tot: m.score_them },
  ];
  if (!m.is_home) rows.reverse();
  return `<details class="match-card">
    <summary>
      <div class="badge ${r}" title="${{ win: 'Victòria', loss: 'Derrota', tie: 'Empat' }[r]}">${{ win: 'V', loss: 'D', tie: 'E' }[r]}</div>
      <div class="mc-main">
        <div class="mc-teams">${m.is_home ? 'vs' : '@'} ${esc(m.opponent)}</div>
        <div class="mc-sub">${fmtDate(m.match_date)} · ${m.is_home ? '🏠 Casa' : '🚌 Fora'}${m.location ? ' · ' + esc(m.location) : ''}</div>
      </div>
      <div class="mc-score"><span class="u">${m.score_us}</span>-${m.score_them}</div>
    </summary>
    <div class="mc-body">
      ${hasQ ? `<table class="qtable"><thead><tr><th>Equip</th>${ps.map((_, i) => `<th>${ordinal(i + 1)}</th>`).join('')}<th>Total</th></tr></thead>
      <tbody>${rows.map((rw) => `<tr class="${rw.cls}"><td>${esc(rw.name)}</td>${rw.vals.map((v) => `<td>${v}</td>`).join('')}<td class="tot">${rw.tot}</td></tr>`).join('')}</tbody></table>`
      : '<p class="mc-sub">Sense parcials per quart.</p>'}
    </div>
  </details>`;
}

(async function init() {
  try {
    team = await loadTeam();
    if (!team) { $('list').innerHTML = '<p>Equip no trobat.</p>'; return; }
    const { data, error } = await sb.from('matches').select('*').eq('team_id', team.id)
      .order('match_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    all = data || [];
    const seasons = [...new Set([seasonOf(new Date().toLocaleDateString('sv-SE')), ...all.map((m) => seasonOf(m.match_date))])].sort().reverse();
    $('season').innerHTML = seasons.map((s) => `<option value="${s}">${s.replace('-', '/')}</option>`).join('');
    $('seasonWrap').classList.toggle('hidden', seasons.length < 2);
    $('season').addEventListener('change', render);
    render();
  } catch (e) {
    console.error(e);
    $('list').innerHTML = '<p style="color:var(--red)">No s\'han pogut carregar els partits. Comprova la connexió.</p>';
  }
})();
