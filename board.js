'use strict';
// Classement en ligne via Supabase. Si le service est absent, le jeu reste jouable.
const SB = 'https://pysybdanwlwksmzklghm.supabase.co/rest/v1/scores';
const KEY = 'sb_publishable_SY6riqPmjmdz4DeegcbDSQ_2DdxsZb-';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const Board = {
  nameLen: 3,
  async get() {
    const r = await fetch(SB + '?select=name,score&order=score.desc&limit=10', { headers: H, cache: 'no-store' });
    if (!r.ok) throw 0;
    return { scores: await r.json(), nameLen: 3 };
  },
  async post(name, score) {
    score = Math.round(score);
    const r = await fetch(SB, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ name, score })
    });
    if (!r.ok) throw 0;
    const c = await fetch(SB + '?select=id&score=gt.' + score, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
    const total = parseInt((c.headers.get('content-range') || '').split('/')[1], 10) || 0;
    const j = await this.get(); j.rank = total + 1; return j;
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
