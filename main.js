'use strict';
(async function () {
  const $ = id => document.getElementById(id);
  const status = $('status');
  const load = async (u, type) => (await fetch(u))[type]();
  const img = u => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = u; });
  let data;
  try {
    const [meshes, counts, floorImg, logoImg] = await Promise.all([load('data/meshes.b64.txt', 'text').then(s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }), load('data/meshes.json', 'json'), img('data/floor.png'), img('data/berry_logo.png')]);
    data = { meshes, counts, floorImg, logoImg };
  } catch (e) { status.textContent = 'Erreur de chargement : ' + e.message + ' (ouvre le jeu via un serveur web, pas en file://)'; return; }
  const game = new Game();
  try { game.highScore = parseInt(localStorage.getItem('best') || '0', 10) || 0; } catch (e) {}
  const audio = new Audio2(); window.__audio = audio;
  let renderer;
  try { renderer = new Renderer($('gl'), game, data); } catch (e) { status.textContent = 'WebGL indisponible : ' + e.message; return; }
  renderer.onError = e => showErr(e.message + ' | ' + ((e.stack || '').split('\n')[1] || '').trim().slice(-70));
  const hud = new Hud($('hud'), game);
  game.listener = e => {
    try { audio.event(e); } catch (x) {}
    if (e === 'GAME_OVER') { try { localStorage.setItem('best', String(game.highScore)); } catch (x) {} setTimeout(() => openPanel(game.score), 1600); }
  };

  // ---- classement en ligne
  const panel = $('panel'), entry = $('entry'), nameIn = $('name');
  let pending = 0, sent = false;
  const refresh = async (mine) => {
    try { const j = await Board.get(); Board.render($('list'), j, mine); nameIn.maxLength = j.nameLen; } catch (e) { $('list').textContent = 'Classement indisponible pour le moment.'; }
  };
  async function openPanel(score, onlyList) {
    pending = onlyList ? 0 : score; sent = false;
    panel.classList.add('show'); entry.classList.toggle('show', pending > 0);
    $('ptitle').textContent = pending > 0 ? 'PARTIE TERMINÉE' : 'CLASSEMENT';
    $('eline').textContent = 'Ton score : ' + Board.fmt(score) + ' — tes initiales :';
    $('again').style.display = onlyList ? 'none' : '';
    try { nameIn.value = localStorage.getItem('pname') || ''; } catch (e) {}
    await refresh(null);
    if (pending > 0) nameIn.focus();
  }
  async function submit() {
    if (!pending || sent) return;
    const nm = nameIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!nm) { nameIn.focus(); return; }
    sent = true; try { localStorage.setItem('pname', nm); } catch (e) {}
    try { const j = await Board.post(nm, pending); Board.render($('list'), j, j.rank); entry.classList.remove('show'); $('ptitle').textContent = j.rank && j.rank <= 10 ? 'TU ES N°' + j.rank + ' !' : 'SCORE ENREGISTRÉ'; pending = 0; }
    catch (e) { sent = false; $('eline').textContent = 'Envoi impossible, réessaie.'; }
  }
  $('send').addEventListener('click', submit);
  nameIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') submit(); });
  nameIn.addEventListener('input', () => { nameIn.value = nameIn.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('close').addEventListener('click', () => panel.classList.remove('show'));
  $('again').addEventListener('click', () => { panel.classList.remove('show'); game.tap(); });
  $('rank').addEventListener('click', () => openPanel(0, true));
  window.__game = game;
  const showErr = msg => { status.style.cssText = 'top:8px;font-size:11px;background:rgba(0,0,0,.8);padding:6px;border-radius:6px'; status.textContent = 'Erreur : ' + msg; };
  addEventListener('error', e => showErr((e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
  addEventListener('unhandledrejection', e => showErr(String(e.reason && e.reason.message || e.reason)));
  status.textContent = ''; $('start').classList.remove('hidden');

  const musicBtn = $('music');
  const paintMusic = () => { musicBtn.textContent = audio.musicOn ? '♪' : '♪̸'; musicBtn.classList.toggle('off', !audio.musicOn); musicBtn.setAttribute('aria-pressed', audio.musicOn); };
  paintMusic();
  musicBtn.addEventListener('click', e => { e.stopPropagation(); audio.setMusic(!audio.musicOn); paintMusic(); });

  let started = false;
  const begin = async () => {
    if (started) return; started = true; $('start').classList.add('hidden');
    await audio.init(); audio.startMusic(); last = performance.now();
  };
  $('play').addEventListener('click', begin);

  // clavier
  const down = new Map(); let mouseL = false, mouseR = false;
  // identifiant de touche indépendant de la disposition du clavier (AZERTY / QWERTY)
  const kid = e => (e.key && e.key.length === 1) ? e.key.toLowerCase() : e.code;
  const sync = () => {
    const vals = new Set(down.values()); const any = (...k) => k.some(x => vals.has(x));
    game.setLeft(any('ArrowLeft', 'z', 'q', 'w', 'x', 'ShiftLeft', 'ControlLeft') || mouseL);
    game.setRight(any('ArrowRight', 'm', ',', ';', ':', '/', '!', 'ShiftRight', 'ControlRight') || mouseR);
    game.setCharging(any('Space', 'ArrowDown'));
  };
  addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (!started) { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); begin(); } return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Space') game.tap();
    if (e.key === 'n' || e.key === 'N') game.nudge(0, -1);
    if (e.key === 'p' || e.key === 'P') musicBtn.click();
    down.set(e.code, e.code === 'Space' || e.code === 'ArrowDown' ? e.code : kid(e)); sync();
  });
  addEventListener('keyup', e => { down.delete(e.code); sync(); });
  const releaseKeys = () => { down.clear(); mouseL = mouseR = false; sync(); };
  addEventListener('blur', releaseKeys);
  document.addEventListener('visibilitychange', releaseKeys);
  addEventListener('keyup', e => { if (e.key === 'Meta' || e.key === 'OS' || e.key === 'ContextMenu') releaseKeys(); });
  // sécurité : les touches maintenues sont vérifiées à chaque image (un keyup perdu ne bloque plus un flipper)
  addEventListener('keydown', e => { if (!e.metaKey && !e.ctrlKey && !e.altKey) return; releaseKeys(); });

  // tactile : état recalculé à chaque événement à partir de TOUS les doigts posés (aucun doigt "oublié")
  const wrap = $('wrap');
  const zoneOf = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (el && el.id === 'plunger') return 'P';
    if (el && el.id === 'nudge') return 'N';
    if (el && (el.closest('#panel') || el.closest('#start') || el.id === 'music')) return null;
    const r = wrap.getBoundingClientRect();
    if (y < r.top + r.height * 0.55) return 'T';      // haut de l'écran : sert à rejouer
    return x < r.left + r.width / 2 ? 'L' : 'R';
  };
  let nudged = new Set();
  const touchSync = e => {
    let L = false, R = false, P = false, tap = false;
    for (const t of e.touches) {
      const z = zoneOf(t.clientX, t.clientY);
      if (z === 'L') L = true; else if (z === 'R') R = true; else if (z === 'P') P = true; else if (z === 'T') tap = true;
    }
    for (const t of e.changedTouches) {
      if (e.type === 'touchstart') { const z = zoneOf(t.clientX, t.clientY); if (z === 'N') game.nudge(0, -1); if (z) game.tap(); }
    }
    game.setLeft(L); game.setRight(R); game.setCharging(P);
    wrap.querySelector('#zl').classList.toggle('on', L); wrap.querySelector('#zr').classList.toggle('on', R); $('plunger').classList.toggle('on', P);
  };
  for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) wrap.addEventListener(ev, e => {
    if (e.target.id === 'music' || e.target.closest('#panel') || e.target.closest('#start')) return;
    e.preventDefault(); touchSync(e);
  }, { passive: false });
  addEventListener('touchend', e => { if (!e.touches.length) { game.setLeft(false); game.setRight(false); game.setCharging(false); } });
  // souris : clic gauche = flipper gauche, clic droit = flipper droit (les deux peuvent être tenus ensemble)
  wrap.addEventListener('mousedown', e => {
    if (!started || e.target.closest('#panel') || e.target.closest('#start') || e.target.id === 'music') return;
    game.tap();
    if (e.button === 0) mouseL = true; else if (e.button === 2) mouseR = true; else return;
    sync();
  });
  addEventListener('mouseup', e => { if (e.button === 0) mouseL = false; else if (e.button === 2) mouseR = false; sync(); });
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000; last = now;
    dt = Math.min(Math.max(dt, 0), 1 / 30);
    if (started && !document.hasFocus() && (down.size || mouseL || mouseR)) releaseKeys();
    try { renderer.frame(started ? dt : 0); hud.draw(game.highScore); } catch (e) { showErr(e.message + ' | ' + ((e.stack || '').split('\n')[1] || '').trim().slice(-60)); }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
