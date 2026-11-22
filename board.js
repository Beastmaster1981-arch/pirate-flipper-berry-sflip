'use strict';
// Classement en ligne (scores.php). Si le serveur est absent, le jeu reste jouable.
const Board = {
  url: 'scores.php', nameLen: 3,
  async get() { const r = await fetch(this.url, { cache: 'no-store' }); if (!r.ok) throw 0; const j = await r.json(); this.nameLen = j.nameLen || 3; return j; },
  async post(name, score) {
    const b = new URLSearchParams({ name, score: String(Math.round(score)) });
    const r = await fetch(this.url, { method: 'POST', body: b }); if (!r.ok) throw 0; return r.json();
  },
  fmt: n => Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' '),
  render(el, j, mineRank) {
    el.textContent = '';
    if (!j.scores.length) { el.textContent = 'Aucun score pour l\'instant : sois le premier !'; return; }
    j.scores.forEach((s, i) => {
      const row = document.createElement('div'); row.className = 'row' + (mineRank === i + 1 ? ' me' : '');
      for (const t of [String(i + 1), s.name, this.fmt(s.score)]) { const c = document.createElement('span'); c.textContent = t; row.appendChild(c); }
      el.appendChild(row);
    });
  }
};
