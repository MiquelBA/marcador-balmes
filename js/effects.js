import { esc, outcome } from './common.js?v=5';

const SCHOOL_COLORS = ['#83BB26', '#A6D84B', '#1F3685', '#5076BB', '#FFFFFF'];

/* Efecte final de partit: victòria, derrota (amable) o empat */
export function showFinalEffect(m, teamName = 'Escola Pia Balmes') {
  document.querySelector('.final-fx')?.remove();
  const res = outcome(m);
  const conf = {
    win:  { title: 'VICTÒRIA!', emoji: '🏆', sub: 'Quin partidàs, equip!', cls: 'fx-win' },
    loss: { title: 'Bon partit, equip!', emoji: '💙', sub: 'Hem lluitat fins al final. Al proper, més!', cls: 'fx-loss' },
    tie:  { title: 'EMPAT!', emoji: '🤝', sub: 'Igualtat màxima a la pista', cls: 'fx-tie' },
  }[res];

  const el = document.createElement('div');
  el.className = `final-fx ${conf.cls}`;
  el.innerHTML = `
    <div class="fx-bg"></div>
    <div class="fx-floaters" aria-hidden="true"></div>
    <div class="fx-card" role="dialog" aria-label="Resultat final">
      <div class="fx-emoji">${conf.emoji}</div>
      <div class="fx-title">${conf.title}</div>
      <div class="fx-score">
        <span class="fx-team us">${esc(teamName)}</span>
        <span class="fx-num">${m.score_us}</span><span class="fx-dash">–</span><span class="fx-num">${m.score_them}</span>
        <span class="fx-team">${esc(m.opponent)}</span>
      </div>
      <div class="fx-sub">${conf.sub}</div>
      <button class="fx-close">Tancar</button>
    </div>`;
  document.body.appendChild(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 400); stop = true; };
  el.querySelector('.fx-close').addEventListener('click', close);
  el.querySelector('.fx-bg').addEventListener('click', close);
  let stop = false;

  const floaters = el.querySelector('.fx-floaters');
  if (res === 'win') {
    burstConfetti(() => stop);
    for (let i = 0; i < 14; i++) addFloater(floaters, ['🏀', '⭐', '🎉'][i % 3], i);
  } else if (res === 'tie') {
    window.confetti?.({ particleCount: 90, spread: 100, origin: { y: 0.6 }, colors: SCHOOL_COLORS });
    for (let i = 0; i < 8; i++) addFloater(floaters, '🏀', i);
  } else {
    for (let i = 0; i < 18; i++) addFloater(floaters, ['💙', '🏀', '💚', '💪'][i % 4], i);
  }
}

function addFloater(root, ch, i) {
  const s = document.createElement('span');
  s.textContent = ch;
  s.style.left = `${(i * 37) % 100}%`;
  s.style.animationDelay = `${(i % 7) * 0.45}s`;
  s.style.fontSize = `${1.4 + (i % 4) * 0.5}rem`;
  root.appendChild(s);
}

function burstConfetti(stopped) {
  const c = window.confetti;
  if (!c) return;
  const end = Date.now() + 4500;
  c({ particleCount: 160, spread: 110, startVelocity: 55, origin: { y: 0.65 }, colors: SCHOOL_COLORS });
  (function frame() {
    if (stopped()) return;
    c({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0, y: 0.75 }, colors: SCHOOL_COLORS });
    c({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1, y: 0.75 }, colors: SCHOOL_COLORS });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  setTimeout(() => !stopped() && c({ particleCount: 120, spread: 160, startVelocity: 45, origin: { y: 0.35 }, colors: SCHOOL_COLORS, scalar: 1.2 }), 1600);
}
