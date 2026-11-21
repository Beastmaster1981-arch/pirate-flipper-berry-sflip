'use strict';
// Surimpression 2D (port de HudView.kt)
class Hud {
  constructor(canvas, game) { this.c = canvas; this.g = game; }
  draw(best0) {
    const best = Math.max(this.g.score, best0);
    const c = this.c, g = this.g, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(c.clientWidth * dpr)), h = Math.max(1, Math.floor(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d'); x.clearRect(0, 0, w, h);
    const s = w / 400 * (h / w > 1.9 ? 1 : 1);
    const font = (sz, bold) => { x.font = (bold ? 'bold ' : '') + (sz * s) + 'px system-ui, sans-serif'; };
    const text = (t, px, py, sz, col, al, bold, alpha) => { font(sz, bold); x.textAlign = al || 'center'; x.fillStyle = col; x.globalAlpha = alpha === undefined ? 1 : alpha; x.fillText(t, px, py); x.globalAlpha = 1; };
    const fmt = n => Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ');
    x.textBaseline = 'alphabetic';
    text('SCORE', w / 2, 24 * s, 11, '#9FB3D1', 'center', true);
    text(fmt(g.score), w / 2, 52 * s, 27, '#FFD166', 'center', true);
    for (let i = 0; i < g.ballsLeft; i++) { x.beginPath(); x.arc((24 + 20 * i) * s, 30 * s, 6 * s, 0, 7); x.fillStyle = '#E8EEF8'; x.fill(); }
    text('x' + g.factor(), w - 34 * s, 36 * s, 16, '#7FE0A8', 'right', true);
    if (g.phase !== 'GAME_OVER' && best > 0) text('MEILLEUR ' + fmt(best), 78 * s, 54 * s, 10.5, '#9FB3D1', 'center', false, 0.85);
    // verrou
    if (g.lockedBalls > 0 || g.lockLit) {
      const blink = g.lockLit ? 0.6 + 0.4 * Math.sin(g.time * 7) : 1;
      text(g.lockedBalls > 0 ? 'VERROU ' + g.lockedBalls + '/3' : 'VERROU PRÊT', w / 2, 74 * s, 12.5, '#FFB347', 'center', true, blink);
    }
    // barre de vie du Kraken
    const kr = g.kraken;
    if (kr.state === 'RISE' || kr.state === 'ALIVE') {
      const bw = 150 * s, bx = w / 2 - bw / 2, by = 82 * s, f = clamp(kr.hp / KRAKEN_HP, 0, 1);
      text('KRAKEN', w / 2, by - 4 * s, 10.5, '#E6A8FF', 'center', true);
      x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(bx - 1, by, bw + 2, 8 * s);
      x.fillStyle = f > 0.34 ? '#B04CFF' : '#FF4D6D'; x.fillRect(bx, by + 1, bw * f, 6 * s);
    }
    // bas
    if (g.wizardActive) text('MODE WIZARD · ' + Math.max(0, Math.floor(g.wizardTime) + 1) + ' s', w / 2, h - 64 * s, 15, '#C58BFF', 'center', true);
    else if (g.missionIndex < g.missions.length) {
      const m = g.missions[g.missionIndex];
      text('MISSION ' + (g.missionIndex + 1) + '/6 · ' + m.title, w / 2, h - 66 * s, 12, '#E8EEF8', 'center', true);
      const p = clamp(m.progress / m.goal, 0, 1);
      x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(60 * s, h - 62 * s, w - 120 * s, 4 * s);
      x.fillStyle = '#FFD166'; x.fillRect(60 * s, h - 62 * s, (w - 120 * s) * p, 4 * s);
    }
    let label = '', lc = '#FFD166';
    if (g.tilted) { label = 'TILT'; lc = '#FF5A5A'; }
    else if (g.balls.length > 1) label = 'MULTIBILLE ' + g.multiballKind + ' · ' + g.balls.length + ' BILLES';
    if (label) text(label, w / 2, h - 44 * s, 11.5, lc, 'center', true);
    for (let i = 0; i < 6; i++) {
      const gx = 75 * s + (w - 150 * s) * i / 5, gy = h - 22 * s, r = 9 * s;
      const cap = g.missionIndex > i || g.wizardActive;
      x.fillStyle = cap ? '#FFFFFF' : 'rgba(255,255,255,.18)';
      x.beginPath(); x.arc(gx, gy - r * 0.2, r, Math.PI, 0); x.lineTo(gx + r, gy + r * 0.8); x.lineTo(gx, gy + r * 0.45); x.lineTo(gx - r, gy + r * 0.8); x.closePath(); x.fill();
    }
    if (g.messageTime > 0 && g.message) {
      const parts = g.message.split('|'), a = Math.min(1, g.messageTime / 0.5);
      text(parts[0], w / 2, h * 0.46, 21, '#FFFFFF', 'center', true, a);
      if (parts[1]) text(parts[1], w / 2, h * 0.46 + 24 * s, 15, '#FFD166', 'center', false, a);
    }
    if (g.phase === 'READY') {
      const pulse = 0.6 + 0.4 * Math.sin(g.time * 4);
      const touch = matchMedia('(pointer:coarse)').matches;
      text(touch ? "Maintiens le bouton ↑ pour armer le ressort," : 'Maintiens ESPACE pour armer le ressort,', w / 2, h * 0.62, 13, '#FFFFFF', 'center', false, pulse);
      text(touch ? 'relâche pour lancer' : 'relâche pour lancer · ←/→ ou Z/M : flippers', w / 2, h * 0.62 + 18 * s, 13, '#FFFFFF', 'center', false, pulse);
    }
    if (g.phase === 'GAME_OVER') {
      x.fillStyle = 'rgba(0,0,0,.67)'; x.fillRect(0, 0, w, h);
      text('PARTIE TERMINÉE', w / 2, h * 0.38, 28, '#FF5A5A', 'center', true);
      text('Score : ' + fmt(g.score), w / 2, h * 0.38 + 50 * s, 22, '#FFD166', 'center', true);
      text('Meilleur : ' + fmt(best), w / 2, h * 0.38 + 85 * s, 17, '#E8EEF8', 'center');
      text('Sons : Jeff Dodson (Dirty Pool Homebrew SFX Kit)', w / 2, h - 100 * s, 9, '#9FB3D1', 'center');
      if (g.gameOverTime > 1) text('Touche l\'écran ou ESPACE pour rejouer', w / 2, h * 0.38 + 140 * s, 15, '#FFFFFF', 'center', false);
    }
  }
}
