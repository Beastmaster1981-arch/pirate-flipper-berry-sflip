'use strict';
// Audio WebAudio : effets (mp3), musique en boucle, cri pirate (speechSynthesis)
const SFX = {
  BUMPER: [['sfx_bumper1', 'sfx_bumper2', 'sfx_bumper3'], 0.8, 40], SLING: [['sfx_sling1', 'sfx_sling2', 'sfx_sling3'], 0.8, 60],
  TARGET: [['sfx_target'], 0.9, 80], DROP: [['sfx_drop'], 1, 100], KICKER: [['sfx_cannon_in'], 1, 100], CANNON_FIRE: [['sfx_cannon_fire'], 1, 100],
  LAUNCH: [['sfx_launch'], 0.9, 100], DRAIN: [['sfx_drain'], 1, 200], BONUS: [['sfx_bonus'], 1, 200], RAMP_ENTER: [['sfx_ramp_enter'], 0.8, 150],
  RAMP: [['sfx_ramp_done'], 1, 150], BOARD: [['sfx_board'], 0.9, 150], GHOST: [['sfx_ghost'], 1, 200], MULTIBALL: [['sfx_multiball'], 1, 200],
  NUDGE: [['sfx_nudge'], 0.7, 100], TILT: [['sfx_tilt'], 1, 300], GAME_OVER: [['sfx_gameover'], 1, 300], LOCK: [['sfx_cannon_in'], 1, 100], STORM: [['sfx_storm'], 1, 300],
  KRAKEN_SPAWN: [['sfx_kraken_spawn'], 1, 300], KRAKEN_HIT: [['sfx_kraken_hit'], 0.9, 120], KRAKEN_DEATH: [['sfx_kraken_death'], 1, 300]
};
class Audio2 {
  constructor() { this.ctx = null; this.buf = {}; this.last = {}; this.musicOn = true; try { this.musicOn = localStorage.getItem('music_on') !== '0'; } catch (e) {} this.musicStarted = false; }
  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = this.musicOn ? 0.5 : 0; this.musicGain.connect(this.ctx.destination);
    const names = new Set(['sfx_yoho', 'sfx_aboard', 'sfx_wizard']); for (const k in SFX) SFX[k][0].forEach(n => names.add(n));
    await Promise.all([...names].map(n => this.load(n)));
    if (this.wantMusic) this.startMusic();
  }
  async load(name) {
    try { const r = await fetch('audio/' + name + '.mp3'); const a = await r.arrayBuffer();
      const b = await new Promise((ok, ko) => this.ctx.decodeAudioData(a, ok, ko)); this.buf[name] = b; return b; } catch (e) { return null; }
  }
  play(name, vol) {
    const b = this.buf[name]; if (!this.ctx || !b) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = b; g.gain.value = vol; s.connect(g); g.connect(this.sfxGain); s.start();
  }
  // trois musiques lues en flux (<audio>), tirées au hasard : à chaque nouvelle partie et à la fin de chaque morceau
  startMusic() {
    this.wantMusic = true; if (this.musicEl) { if (this.musicOn && this.musicEl.paused) this.musicEl.play().catch(() => {}); return; }
    this.nextTrack();
  }
  nextTrack() {
    const T = ['music', 'music_voiles_1', 'music_voiles_2']; let i;
    do { i = Math.floor(Math.random() * T.length); } while (T.length > 1 && i === this.trackIdx);
    this.trackIdx = i;
    if (this.musicEl) { this.musicEl.onended = null; this.musicEl.pause(); }
    const el = new window.Audio('audio/' + T[i] + '.mp3'); el.volume = 0.5; el.muted = !this.musicOn; el.onended = () => this.nextTrack();
    this.musicEl = el; if (this.musicOn) el.play().catch(() => {});
  }
  setMusic(on) {
    this.musicOn = on; try { localStorage.setItem('music_on', on ? '1' : '0'); } catch (e) {}
    if (this.musicEl) { this.musicEl.muted = !on; if (on && this.musicEl.paused) this.musicEl.play().catch(() => {}); }
  }
  flipperTone() {
    if (!this.ctx) return; const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.type = 'square'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.05);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06); o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + 0.07);
  }
  speak() {
    try { const u = new SpeechSynthesisUtterance("À l'abordage ! À l'abordage !"); u.lang = 'fr-FR'; u.pitch = 0.45; u.rate = 0.85; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) {}
  }
  event(e) {
    if (e === 'NEW_GAME') { if (this.wantMusic) this.nextTrack(); return; }
    if (!this.ctx) return;
    if (e === 'FLIPPER') return this.flipperTone();
    const now = performance.now();
    if (e === 'WIZARD') { this.play('sfx_yoho', 1); this.play('sfx_wizard', 0.55); return; }
    if (e === 'ABORDAGE') { this.play('sfx_aboard', 1); this.play('sfx_multiball', 0.5); return; }
    const d = SFX[e]; if (!d) return;
    if (now - (this.last[e] || 0) < d[2]) return; this.last[e] = now;
    const v = d[0]; this.play(v[Math.floor(Math.random() * v.length)], d[1]);
  }
}
