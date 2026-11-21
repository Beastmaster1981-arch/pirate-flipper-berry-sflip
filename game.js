'use strict';
// Moteur de jeu (port fidèle de Game.kt) — coordonnées 2D : table 400 x 800, y vers le bas.
const TABLE_W = 400, TABLE_H = 800, BALL_R = 8, GRAVITY = 1000, MAX_SPEED = 1800, RAMP_G = 3000;
const LANE_X = 352, LANE_FLOOR = 775, PLUNGER_REST_Y = 738, PLUNGER_TRAVEL = 22;
const FLIPPER_R = 7, FLIPPER_SPEED = 20;
const STRIP_Y = 215, STRIP_X0 = 170, STRIP_X1 = 306, BOAT_HALF = 28, BOAT_WELL_DX = -14;
const LAND_X = 224, LAND_TOL = 13.6; // point de chute fixe ; tolérance = 10 % de la bande de mer (136)
const KRAKEN_X = 232, KRAKEN_Y = 180, KRAKEN_R = 24, KRAKEN_HP = 15;
const DECK_H = 46.8, DECK_X0 = 118, DECK_X1 = 296, DECK_Y0 = 62, DECK_Y1 = 132;   // plateau supérieur (au-dessus des fantômes)
const MAX_BALLS = 5, WIZARD_SECONDS = 60, ABORDAGE_TOTAL = 2.4;
const rad = d => d * Math.PI / 180;
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

class Wall {
  constructor(x1, y1, x2, y2, o = {}) {
    this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
    this.bounce = o.bounce ?? 0.4; this.kick = o.kick ?? 0; this.oneWay = !!o.oneWay; this.hidden = !!o.hidden;
    this.flash = 0;
  }
}

function rampHeights(id, count) {
  const h = new Float32Array(count);
  if (id === 0 && count === 52) {
    for (let i = 0; i < count; i++) {
      if (i < 8) h[i] = 2 + 16 * i / 8;
      else if (i <= 44) h[i] = 18 + 16 * (i - 8) / 36;
      else if (i < 50) h[i] = 34 - 8 * (i - 44) / 6;
      else h[i] = 26;
    }
  } else if (id === 2 && count === 5) {
    [2, 16, 26, 26, 9].forEach((v, i) => h[i] = v);
  } else {
    for (let i = 0; i < count; i++) { const u = count > 1 ? i / (count - 1) : 0; h[i] = 2 + 24 * u; }
  }
  for (let i = 0; i < count; i++) h[i] *= 1.8;
  return h;
}

class Ramp {
  constructor(id, name, pts, entryR, speed, exitVx, exitVy, markIndex = -1) {
    this.id = id; this.name = name; this.pts = pts; this.entryR = entryR; this.speed = speed;
    this.exitVx = exitVx; this.exitVy = exitVy;
    this.count = pts.length / 2;
    this.cum = new Float32Array(this.count);
    let acc = 0;
    for (let i = 1; i < this.count; i++) {
      const dx = pts[i * 2] - pts[(i - 1) * 2], dy = pts[i * 2 + 1] - pts[(i - 1) * 2 + 1];
      acc += Math.sqrt(dx * dx + dy * dy); this.cum[i] = acc;
    }
    this.length = acc;
    this.markDist = markIndex >= 0 ? this.cum[markIndex] : 0;
    this.hs = rampHeights(id, this.count);
  }
  seg(d) {
    const dd = clamp(d, 0, this.length);
    let i = 1;
    while (i < this.count - 1 && this.cum[i] < dd) i++;
    const s = this.cum[i] - this.cum[i - 1];
    return [i, s > 1e-6 ? (dd - this.cum[i - 1]) / s : 0];
  }
  heightAt(d) { const [i, t] = this.seg(d); return this.hs[i - 1] + (this.hs[i] - this.hs[i - 1]) * t; }
  pointAt(d, out) {
    const [i, t] = this.seg(d);
    out[0] = this.pts[(i - 1) * 2] + (this.pts[i * 2] - this.pts[(i - 1) * 2]) * t;
    out[1] = this.pts[(i - 1) * 2 + 1] + (this.pts[i * 2 + 1] - this.pts[(i - 1) * 2 + 1]) * t;
  }
}

class Ball {
  constructor(x, y, vx = 0, vy = 0) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.state = 'FREE'; this.ramp = null; this.rampDist = 0; this.rampCooldown = 0; this.rampV0 = 0;
    this.rampBack = false; this.rampBackV = 0; this.boardState = 0; this.boardTimer = 0;
    this.flightT = 0; this.flightX0 = 0; this.flightY0 = 0;
    this.laneTimer = 0; this.stuckTimer = 0; this.visualH = BALL_R; this.deckT = 0; this.deckHold = 0;
  }
}

class Flipper {
  constructor(px, py, length, restAngle, upAngle) {
    this.px = px; this.py = py; this.length = length; this.restAngle = restAngle; this.upAngle = upAngle;
    this.angle = restAngle; this.omega = 0; this.pressed = false;
  }
  get tipX() { return this.px + Math.cos(this.angle) * this.length; }
  get tipY() { return this.py + Math.sin(this.angle) * this.length; }
}

class Game {
  constructor() {
    this.listener = null;
    this.walls = []; this.ramps = []; this.balls = [];
    this.bumpers = [{ x: 112, y: 410, r: 22, flash: 0, ret: 0 }, { x: 260, y: 410, r: 22, flash: 0, ret: 0 }, { x: 150, y: 490, r: 22, flash: 0, ret: 0 }];
    this.ghosts = [{ x: 110, y: 150, r: 13, unmasked: false, flash: 0 }, { x: 186, y: 135, r: 13, unmasked: false, flash: 0 }, { x: 262, y: 150, r: 13, unmasked: false, flash: 0 }];
    this.kicker = { x: 186, y: 300, holdTime: 0, cooldown: 0, aim: 0, fireFlash: 0 };
    this.dropTarget = { x: 186, y: 556, halfW: 22, up: true, drop: 0, flash: 0, resetTimer: 0 };
    this.kraken = { x: KRAKEN_X, y: KRAKEN_Y, r: KRAKEN_R, hp: 0, state: 'NONE', t: 0, flash: 0, cool: 0, show: 0, killPending: false };
    this.krakenBonusT = 0;
    this.deck = {
      flipper: new Flipper(252, 115, 38, rad(158), rad(205)),
      targets: [{ x: 168, y: 86, halfW: 12, up: true, drop: 0, flash: 0 }, { x: 204, y: 74, halfW: 12, up: true, drop: 0, flash: 0 }],
      hole: { x: 130, y: 72, r: 10, flash: 0 },
      armed: false, armedT: 0, holdT: 0, slingFlash: 0, visits: 0,
      // murs : x1, y1, x2, y2 (l'entrée de la rampe laisse une ouverture dans le mur de droite, entre y = 84 et 104)
      walls: [[DECK_X0, DECK_Y0, DECK_X1, DECK_Y0], [DECK_X0, DECK_Y0, DECK_X0, DECK_Y1],
        [DECK_X1, DECK_Y0, DECK_X1, 84], [DECK_X1, 104, DECK_X1, DECK_Y1], [DECK_X1, 96, 254, 105]],
      sling: [120, 98, 146, 122]
    };
    this.vuk = { x: 82, y: 480, hold: 0, cooldown: 0, locking: false, fireFlash: 0 };
    this.leftFlipper = new Flipper(108, 690, 66, rad(30), rad(-30));
    this.rightFlipper = new Flipper(264, 690, 66, rad(150), rad(210));
    this.missions = [
      { title: 'DÉMASQUE LES 3 FANTÔMES', goal: 3, ghostName: 'Le Fantôme du Grenier', progress: 0 },
      { title: 'FRAPPE 12 CRÂNES', goal: 12, ghostName: 'Barbe-Brume', progress: 0 },
      { title: 'CANON : 2 TIRS', goal: 2, ghostName: 'Le Spectre Boulet', progress: 0 },
      { title: 'BOUCLE DU BATEAU x2', goal: 2, ghostName: 'Le Capitaine Maudit', progress: 0 },
      { title: 'RAMPE DES VAGUES x2', goal: 2, ghostName: 'La Sirène Fantôme', progress: 0 },
      { title: 'LES 3 RAMPES', goal: 3, ghostName: 'Le Roi des Spectres', progress: 0 }];
    this.phase = 'READY'; this.score = 0; this.highScore = 0; this.ballsLeft = 3; this.multiplier = 1;
    this.plunge = 0; this.time = 0; this.gameOverTime = 0; this.message = ''; this.messageTime = 0;
    this.missionIndex = 0; this.wizardTime = 0; this.multiballKind = ''; this.tilted = false; this.tiltMeter = 0;
    this.charging = false; this.armed = true; this.ghostResetTimer = 0; this.nudgeCooldown = 0;
    this.hitNx = 0; this.hitNy = 0; this.kickerBall = null; this.vukBall = null; this.vukShots = 0;
    this.releaseQueue = 0; this.releaseTimer = 0; this.lockedBalls = 0; this.lockLit = false; this.abordageT = -1; this.departT = -1;
    this.rampMask = 0; this.canonShots = 0; this.boardings = 0; this.waveRides = 0; this.inGame = false;
    this.boatPos = 238; this.boatSink = 0; this.tmp = [0, 0];
    this.buildWalls();
    this.ramps.push(this.buildLoopRamp(), this.buildWaveRamp(), new Ramp(2, 'Rampe du Trésor', [186, 525, 186, 470, 186, 400, 186, 330, 186, 300], 16, 480, 0, -250));
    this.restart();
  }

  get wizardActive() { return this.wizardTime > 0; }
  get stormActive() { return this.multiballKind === 'TEMPÊTE' && this.balls.length > 1 && this.phase === 'PLAYING'; }
  get abordageEnv() {
    const t = this.abordageT; if (t < 0) return 0;
    return t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / (ABORDAGE_TOTAL - 0.15));
  }

  buildWalls() {
    const W = this.walls, cx = 200, cy = 200, radius = 180;
    let px = cx - radius, py = cy;
    const n = 28;
    for (let i = 1; i <= n; i++) {
      const a = Math.PI + Math.PI * i / n;
      const x = cx + radius * Math.cos(a), y = cy + radius * Math.sin(a);
      W.push(new Wall(px, py, x, y)); px = x; py = y;
    }
    W.push(new Wall(20, 200, 20, 610));
    W.push(new Wall(380, 200, 380, LANE_FLOOR));
    W.push(new Wall(LANE_X, 150, LANE_X, LANE_FLOOR));
    W.push(new Wall(LANE_X, LANE_FLOOR, 380, LANE_FLOOR));
    W.push(new Wall(LANE_X, PLUNGER_REST_Y, 380, PLUNGER_REST_Y, { bounce: 0.15, hidden: true }));   // pointe du lanceur : la bille qui revient s'y pose au lieu de le traverser
    W.push(new Wall(LANE_X, 104, LANE_X, 150, { oneWay: true }));
    W.push(new Wall(20, 598, 117, 672));
    W.push(new Wall(352, 598, 255, 672));
    for (let side = 0; side < 2; side++) {
      const ax = side === 0 ? 60 : 372 - 60, bx = side === 0 ? 102 : 372 - 102;
      const bulge = side === 0 ? 10 : -10, ay = 578, by = 620;
      const sdx = bx - ax, sdy = by - ay, slen = Math.sqrt(sdx * sdx + sdy * sdy);
      const snx = sdy / slen, sny = -sdx / slen;
      let qx = ax, qy = ay;
      for (let i = 1; i <= 6; i++) {
        const t = i / 6, k = bulge * Math.sin(Math.PI * t);
        const x = ax + sdx * t + snx * k, y = ay + sdy * t + sny * k;
        W.push(new Wall(qx, qy, x, y, { bounce: 0.3, kick: 520 })); qx = x; qy = y;
      }
    }
    const v = this.vuk;
    W.push(new Wall(v.x - 15, v.y - 20, v.x - 15, v.y + 14, { bounce: 0.3, hidden: true }));
    W.push(new Wall(v.x + 15, v.y - 20, v.x + 15, v.y + 14, { bounce: 0.3, hidden: true }));
    W.push(new Wall(v.x - 15, v.y - 20, v.x + 15, v.y - 20, { bounce: 0.3, hidden: true }));
  }

  buildLoopRamp() {
    const p = [];
    const add = (x, y) => p.push(x, y);
    add(44, 468); add(42, 448); add(40, 428); add(40, 400); add(40, 360); add(43, 330); add(52, 310); add(66, 299);
    const steps = 36;
    for (let k = 0; k <= steps; k++) {
      const th = (90 - 10 * k) * Math.PI / 180, cxd = 82 + 10 * k / steps;
      add(cxd + 30 * Math.cos(th), 266 + 30 * Math.sin(th));
    }
    add(112, 296); add(135, 291); add(150, 272); add(158, 244); add(164, 226);
    const mark = p.length / 2;
    add(STRIP_X0, STRIP_Y); add(STRIP_X1, STRIP_Y);
    return new Ramp(0, 'Boucle du Bateau', p, 20, 430, -120, 120, mark);
  }

  buildWaveRamp() {
    const p = [], n = 60;
    for (let i = 0; i <= n; i++) {
      const u = i / n, y = 475 - 300 * u;
      const x = 326 + 11 * Math.sin(2 * Math.PI * 5 * u) * Math.sqrt(Math.max(0, Math.sin(Math.PI * u)));
      p.push(x, y);
    }
    p.push(322, 158, 314, 138, 306, 116, 298, 94);   // la rampe monte jusqu'au plateau supérieur
    return new Ramp(1, 'Rampe des Vagues', p, 16, 380, -200, -30);
  }

  // ------------------------------------------------------------------ API
  boatX() { return this.boatPos; }
  boatY() { return STRIP_Y + 2.5 * Math.sin(this.time * 2.3); }
  boatTilt() { return 6 * Math.sin(this.time * 1.7); }
  updateBoat(dt) {
    const sailing = this.balls.some(b => b.state === 'RAMP' && b.boardState === 1);
    if (sailing) {
      const steer = (this.rightFlipper.pressed ? 1 : 0) - (this.leftFlipper.pressed ? 1 : 0);
      this.boatPos = clamp(this.boatPos + steer * 95 * dt, STRIP_X0 + BOAT_HALF, STRIP_X1 - BOAT_HALF);
    } else {
      const target = 238 + 55 * Math.sin(this.time * 0.55), d = target - this.boatPos;
      this.boatPos += clamp(d, -45 * dt, 45 * dt);
    }
  }
  factor() { return this.multiplier * (this.wizardActive ? 3 : (this.balls.length > 1 ? 2 : 1)) * (this.krakenBonusT > 0 ? 2 : 1); }

  setLeft(pressed) {
    const p = pressed && !this.tilted;
    if (p && !this.leftFlipper.pressed) this.fire('FLIPPER');
    this.leftFlipper.pressed = p;
  }
  setRight(pressed) {
    const p = pressed && !this.tilted;
    if (p && !this.rightFlipper.pressed) this.fire('FLIPPER');
    this.rightFlipper.pressed = p;
  }
  setCharging(on) { this.charging = on; if (!on) this.armed = true; }
  tap() { if (this.phase === 'GAME_OVER' && this.gameOverTime > 1) this.restart(); }

  nudge(ax, ay) {
    if (this.phase !== 'PLAYING' || this.tilted || this.nudgeCooldown > 0) return;
    this.nudgeCooldown = 0.45;
    const ix = clamp(ax * 22, -260, 260), iy = clamp(ay * 22, -260, 260);
    for (const b of this.balls) if (b.state === 'FREE') { b.vx += ix; b.vy += iy; }
    this.fire('NUDGE');
    if (this.stormActive) { this.tiltMeter = 0; return; } // pas de tilt pendant la TEMPÊTE
    this.tiltMeter += 1;
    if (this.tiltMeter >= 5.5) {
      this.tilted = true; this.leftFlipper.pressed = false; this.rightFlipper.pressed = false;
      this.showMessage('TILT !', 3); this.fire('TILT');
    } else if (this.tiltMeter >= 4) this.showMessage('ATTENTION !', 1.2);
  }

  restart() {
    this.fire('NEW_GAME');
    this.deck.flipper.angle = this.deck.flipper.restAngle; this.deck.flipper.omega = 0; this.deck.hole.flash = 0; this.deckResetTargets(); this.deck.holdT = 0;
    this.kraken.state = 'NONE'; this.kraken.show = 0; this.kraken.hp = 0; this.kraken.killPending = false; this.krakenBonusT = 0;
    this.boatSink = 0; for (const bp of this.bumpers) bp.ret = 0;
    this.inGame = false; this.lockedBalls = 0; this.lockLit = false; this.vukShots = 0; this.vukBall = null;
    this.releaseQueue = 0; this.abordageT = -1; this.departT = -1; this.vuk.hold = 0; this.vuk.cooldown = 0; this.vuk.locking = false;
    this.dropTarget.up = true; this.dropTarget.drop = 0;
    this.score = 0; this.ballsLeft = 3; this.multiplier = 1; this.wizardTime = 0; this.missionIndex = 0;
    for (const m of this.missions) m.progress = 0;
    this.rampMask = 0; this.canonShots = 0; this.boardings = 0; this.waveRides = 0; this.multiballKind = '';
    this.ghostResetTimer = 0;
    for (const g of this.ghosts) g.unmasked = false;
    this.resetBall();
    this.showMessage('MANOIR DES FLIBUSTIERS', 3);
  }

  update(dt) {
    if (dt <= 0) return;
    this.time += dt;
    this.updateBoat(dt);
    this.decay(dt);
    if (this.phase === 'READY') {
      this.stepFlipper(this.leftFlipper, dt); this.stepFlipper(this.rightFlipper, dt); this.updateReady(dt);
    } else if (this.phase === 'PLAYING') this.updatePlaying(dt);
    else {
      this.gameOverTime += dt;
      this.stepFlipper(this.leftFlipper, dt); this.stepFlipper(this.rightFlipper, dt);
    }
  }

  fire(e) { if (this.listener) this.listener(e); }
  showMessage(m, t) { this.message = m; this.messageTime = t; }
  addScore(base) {
    if (this.tilted) return 0;
    const g = base * this.factor(); this.score += g; return g;
  }

  decay(dt) {
    for (const w of this.walls) if (w.flash > 0) w.flash = Math.max(0, w.flash - dt);
    for (const b of this.bumpers) if (b.flash > 0) b.flash = Math.max(0, b.flash - dt);
    for (const g of this.ghosts) if (g.flash > 0) g.flash = Math.max(0, g.flash - dt);
    const k = this.kicker, v = this.vuk;
    if (k.cooldown > 0) k.cooldown = Math.max(0, k.cooldown - dt);
    if (k.fireFlash > 0) k.fireFlash = Math.max(0, k.fireFlash - dt);
    if (v.fireFlash > 0) v.fireFlash = Math.max(0, v.fireFlash - dt);
    if (v.cooldown > 0) v.cooldown = Math.max(0, v.cooldown - dt);
    this.krakenUpdate(dt);
    if (this.departT >= 0) { this.departT += dt; if (this.departT > 9) this.departT = -1; }
    const D = this.deck;
    if (D.hole.flash > 0) D.hole.flash = Math.max(0, D.hole.flash - dt);
    if (D.slingFlash > 0) D.slingFlash = Math.max(0, D.slingFlash - dt);
    for (const t of D.targets) { if (t.flash > 0) t.flash = Math.max(0, t.flash - dt); t.drop = t.up ? Math.max(0, t.drop - 5 * dt) : Math.min(1, t.drop + 7 * dt); }
    if (D.armed) { D.armedT -= dt; if (D.armedT <= 0) this.deckResetTargets(); }
    if (this.abordageT >= 0) { this.abordageT += dt; if (this.abordageT > ABORDAGE_TOTAL) this.abordageT = -1; }
    const d = this.dropTarget;
    if (d.flash > 0) d.flash = Math.max(0, d.flash - dt);
    if (!d.up) { d.resetTimer -= dt; if (d.resetTimer <= 0) d.up = true; }
    d.drop = d.up ? Math.max(0, d.drop - 5 * dt) : Math.min(1, d.drop + 7 * dt);
    if (this.messageTime > 0) this.messageTime = Math.max(0, this.messageTime - dt);
    if (this.nudgeCooldown > 0) this.nudgeCooldown = Math.max(0, this.nudgeCooldown - dt);
    if (!this.tilted && this.tiltMeter > 0) this.tiltMeter = Math.max(0, this.tiltMeter - 0.7 * dt);
    if (this.ghostResetTimer > 0) {
      this.ghostResetTimer -= dt;
      if (this.ghostResetTimer <= 0) for (const g of this.ghosts) g.unmasked = false;
    }
  }

  resetBall() {
    this.phase = 'READY'; this.plunge = 0;
    this.balls.length = 0;
    this.balls.push(new Ball(366, PLUNGER_REST_Y - BALL_R));
    this.kickerBall = null; this.vukBall = null; this.vuk.hold = 0; this.releaseQueue = 0;
    this.kicker.holdTime = 0; this.armed = !this.charging; this.tilted = false; this.tiltMeter = 0; this.multiballKind = '';
  }

  stepFlipper(f, h) {
    const target = f.pressed ? f.upAngle : f.restAngle;
    const maxStep = FLIPPER_SPEED * h;
    const step = clamp(target - f.angle, -maxStep, maxStep);
    f.angle += step; f.omega = step / h;
  }

  updateReady(dt) {
    if (this.armed && this.charging) this.plunge = Math.min(1, this.plunge + dt / 0.9);
    else if (this.plunge > 0) { if (this.plunge >= 0.08) this.launch(); else this.plunge = 0; }
    if (this.phase === 'READY' && this.balls.length) {
      const b = this.balls[0];
      b.x = 366; b.y = PLUNGER_REST_Y - BALL_R + this.plunge * PLUNGER_TRAVEL;
    }
  }

  launch() {
    const b = this.balls[0];
    b.vx = 0; b.vy = -(900 + 750 * this.plunge); b.x = 366; b.y = PLUNGER_REST_Y - BALL_R; b.state = 'FREE';
    this.plunge = 0; this.phase = 'PLAYING'; this.inGame = true; this.fire('LAUNCH');
  }

  updatePlaying(dt) {
    if (this.tilted && !this.stormActive) { this.leftFlipper.pressed = false; this.rightFlipper.pressed = false; } else if (this.tilted) { this.tilted = false; this.tiltMeter = 0; }
    if (this.wizardActive) { this.wizardTime -= dt; if (this.wizardTime <= 0) this.endWizard(true); }
    const steps = 8, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.stepFlipper(this.leftFlipper, h); this.stepFlipper(this.rightFlipper, h);
      this.stepDeckFlipper(h);
      if (this.kicker.holdTime > 0) { this.kicker.holdTime -= h; if (this.kicker.holdTime <= 0) this.ejectFromKicker(); }
      if (this.vuk.hold > 0) { this.vuk.hold -= h; if (this.vuk.hold <= 0) this.resolveVuk(); }
      this.physicsStep(h);
      if (this.phase !== 'PLAYING') return;
    }
    if (this.releaseQueue > 0) {
      this.releaseTimer -= dt;
      if (this.releaseTimer <= 0) { this.releaseQueue--; this.releaseTimer = 0.4; this.ejectFromVuk(null); }
    }
  }

  // filet de sécurité : une bille aux coordonnées invalides (NaN) est traitée comme perdue au lieu de bloquer le jeu
  sanitizeBalls() {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (!Number.isFinite(b.x + b.y + b.vx + b.vy)) {
        b.x = 186; b.y = 330; b.vx = 0; b.vy = 100; b.state = 'FREE'; b.ramp = null; b.rampDist = 0; b.boardState = 0;
        if (this.vukBall === b) { this.vukBall = null; this.vuk.hold = 0; this.vuk.locking = false; }
        if (this.kickerBall === b) { this.kickerBall = null; this.kicker.holdTime = 0; }
      }
    }
  }

  // reprise après une erreur : on garde une bille libre et on annule les effets en cours
  recover() {
    this.vukBall = null; this.kickerBall = null; this.vuk.hold = 0; this.vuk.locking = false; this.kicker.holdTime = 0;
    this.releaseQueue = 0; this.abordageT = -1; this.multiballKind = '';
    this.balls = this.balls.filter(b => Number.isFinite(b.x + b.y)).slice(0, 1);
    if (!this.balls.length) { if (this.phase === 'PLAYING') this.lostBall(); }
    else { const b = this.balls[0]; b.deckHold = 0; b.state = 'FREE'; b.ramp = null; b.boardState = 0; b.vx = 0; b.vy = 100; }
  }

  physicsStep(h) {
    this.sanitizeBalls();
    let i = this.balls.length - 1;
    while (i >= 0) {
      if (i < this.balls.length) {
        const b = this.balls[i];
        if (b.state === 'RAMP') this.updateRampBall(b, h);
        else if (b.state === 'DECK') this.deckStep(b, h);
        else if (b.state === 'FREE') {
          const code = this.freeStep(b, h);
          if (code === 1) this.onDrain(i);
          else if (code === 2) { this.resetBall(); return; }
        }
        if (this.phase !== 'PLAYING') return;
      }
      i--;
    }
    this.collideBalls();
  }

  freeStep(b, h) {
    b.vy += GRAVITY * h;
    const damp = 1 - 0.03 * h;
    b.vx *= damp; b.vy *= damp;
    const sp0 = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (sp0 > MAX_SPEED) { const k = MAX_SPEED / sp0; b.vx *= k; b.vy *= k; }
    b.x += b.vx * h; b.y += b.vy * h;
    if (b.rampCooldown > 0) b.rampCooldown -= h;

    for (const w of this.walls) {
      if (w.oneWay && b.x > w.x1) continue;
      const impact = this.collideSegment(b, w.x1, w.y1, w.x2, w.y2, 0, w.bounce, 0, 0, 0);
      if (impact >= 0 && w.kick > 0 && impact > 120) {
        let kx = this.hitNx, ky = this.hitNy < -0.1 ? -0.1 : this.hitNy;
        const kl = Math.sqrt(kx * kx + ky * ky); kx /= kl; ky /= kl;
        const outN = b.vx * kx + b.vy * ky;
        if (outN < w.kick) { b.vx += kx * (w.kick - outN); b.vy += ky * (w.kick - outN); }
        w.flash = 0.12; this.addScore(10); this.fire('SLING');
      }
    }
    const lf = this.leftFlipper, rf = this.rightFlipper;
    this.collideSegment(b, lf.px, lf.py, lf.tipX, lf.tipY, FLIPPER_R, 0.2, lf.px, lf.py, lf.omega);
    this.collideSegment(b, rf.px, rf.py, rf.tipX, rf.tipY, FLIPPER_R, 0.2, rf.px, rf.py, rf.omega);

    for (const bp of this.bumpers) {
      if (bp.ret > 0.35) continue;   // bumper replié (Kraken)
      const dx = b.x - bp.x, dy = b.y - bp.y, minD = BALL_R + bp.r, d2 = dx * dx + dy * dy;
      if (d2 < minD * minD) {
        const d = Math.max(Math.sqrt(d2), 0.001), nx = dx / d, ny = dy / d;
        b.x = bp.x + nx * minD; b.y = bp.y + ny * minD;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 1.5 * vn * nx; b.vy -= 1.5 * vn * ny; }
        const outN = b.vx * nx + b.vy * ny;
        if (outN < 480) { b.vx += nx * (480 - outN); b.vy += ny * (480 - outN); }
        bp.flash = 0.15; this.addScore(100); this.fire('BUMPER'); this.advance(1, 1);
      }
    }
    for (const g of this.ghosts) {
      const dx = b.x - g.x, dy = b.y - g.y, minD = BALL_R + g.r, d2 = dx * dx + dy * dy;
      if (d2 < minD * minD) {
        const d = Math.max(Math.sqrt(d2), 0.001), nx = dx / d, ny = dy / d;
        b.x = g.x + nx * minD; b.y = g.y + ny * minD;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 1.5 * vn * nx; b.vy -= 1.5 * vn * ny; }
        this.onTargetHit(g);
      }
    }
    this.hitKraken(b);
    const dt0 = this.dropTarget;
    if (dt0.up) {
      const r1 = this.collideSegment(b, dt0.x - dt0.halfW, dt0.y + 2, dt0.x, dt0.y - 2, 3, 0.25, 0, 0, 0);
      const r2 = this.collideSegment(b, dt0.x, dt0.y - 2, dt0.x + dt0.halfW, dt0.y + 2, 3, 0.25, 0, 0, 0);
      if (Math.max(r1, r2) > 60 && this.phase === 'PLAYING') {
        dt0.up = false; dt0.resetTimer = 14; dt0.flash = 0.3;
        const gd = this.addScore(500);
        this.showMessage('CIBLE TOMBÉE !|RAMPE DU TRÉSOR OUVERTE +' + gd, 1.6); this.fire('DROP');
      }
    }
    if (this.phase !== 'PLAYING') return 0;

    const k = this.kicker;
    if (!this.kickerBall && k.cooldown <= 0) {
      const kx = b.x - k.x, ky = b.y - k.y;
      if (kx * kx + ky * ky < 144) { this.captureInKicker(b); return 0; }
    }
    const v = this.vuk;
    if (!this.vukBall && v.cooldown <= 0 && this.releaseQueue === 0) {
      const vx = b.x - v.x, vy = b.y - v.y;
      if (vx * vx + vy * vy < 169) { this.captureInVuk(b); return 0; }
    }
    if (b.rampCooldown <= 0 && b.vy < -350) {
      for (const r of this.ramps) {
        const dx = b.x - r.pts[0], dy = b.y - r.pts[1];
        if (dx * dx + dy * dy < r.entryR * r.entryR) { this.enterRamp(b, r); return 0; }
      }
    }
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (b.x > LANE_X && b.y > PLUNGER_REST_Y - 30 && speed < 20) {
      b.laneTimer += h;
      if (b.laneTimer > 0.6) {
        if (this.balls.length === 1) return 2;
        b.vy = -1500; b.laneTimer = 0;
      }
    } else b.laneTimer = 0;
    if (speed < 6 && b.x < LANE_X) {
      b.stuckTimer += h;
      if (b.stuckTimer > 2.5) { b.vy = -450; b.vx = Math.random() * 300 - 150; b.stuckTimer = 0; }
    } else b.stuckTimer = 0;
    return b.y > TABLE_H + 30 ? 1 : 0;
  }

  collideBalls() {
    const n = this.balls.length;
    for (let i = 0; i < n; i++) {
      const a = this.balls[i]; if (a.state !== 'FREE') continue;
      for (let j = i + 1; j < n; j++) {
        const c = this.balls[j]; if (c.state !== 'FREE') continue;
        const dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy, minD = BALL_R * 2;
        if (d2 < minD * minD && d2 > 1e-6) {
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, overlap = (minD - d) / 2;
          a.x -= nx * overlap; a.y -= ny * overlap; c.x += nx * overlap; c.y += ny * overlap;
          const rel = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
          if (rel > 0) { const imp = rel * 0.95; a.vx -= imp * nx; a.vy -= imp * ny; c.vx += imp * nx; c.vy += imp * ny; }
        }
      }
    }
  }

  // --------------------------------------------------------------- rampes
  enterRamp(b, r) {
    b.state = 'RAMP'; b.ramp = r; b.rampDist = 0;
    b.rampV0 = 0.8 * Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    b.rampBack = false; b.rampBackV = 0; b.vx = 0; b.vy = 0; b.boardState = 0; b.boardTimer = 0;
    b.x = r.pts[0]; b.y = r.pts[1];
    this.fire('RAMP_ENTER');
  }

  updateRampBall(b, h) {
    const r = b.ramp;
    if (!r) { b.state = 'FREE'; return; }
    const tmp = this.tmp;
    if (r.id === 0 && b.boardState === 3) {
      const dx = LAND_X - b.flightX0;
      const dur = Math.max(0.35, Math.abs(dx) / 260);
      b.flightT = Math.min(1, b.flightT + h / dur);
      b.x = b.flightX0 + dx * b.flightT;
      b.y = b.flightY0 + (STRIP_Y - b.flightY0) * b.flightT;
      if (b.flightT >= 1) {
        const wellX = this.boatX() + BOAT_WELL_DX;
        if (this.boatSink > 0.3 || Math.abs(wellX - LAND_X) > LAND_TOL) {
          // raté : la bille tombe à l'eau et glisse jusqu'au bout de la bande de mer
          b.boardState = 2; b.rampV0 = Math.max(b.rampV0, 500); b.x = LAND_X; b.y = STRIP_Y;
          b.rampDist = r.markDist + Math.max(0, LAND_X - STRIP_X0);
          this.showMessage(this.boatSink > 0.3 ? "À L'EAU !|Le bateau a coulé" : "À L'EAU !|Le bateau n'était pas là", 1.6);
          return;
        }
        b.boardState = 1; b.boardTimer = 5;
        b.x = wellX; b.y = this.boatY();
        this.boardings++; this.departT = 0;
        const g = this.addScore(1000);
        this.showMessage('TEMPÊTE !!|Flippers = gouvernail  +' + g, 2.8);
        this.fire('BOARD');
        if (!this.wizardActive && this.balls.length === 1) {
          this.startMultiball('TEMPÊTE', 4, this.boatX(), STRIP_Y + 16, 0, 120);
          if (this.multiballKind === 'TEMPÊTE') this.fire('STORM');
        }
      }
      return;
    }
    if (r.id === 0 && b.boardState === 1) {
      b.boardTimer -= h;
      b.x = this.boatX() + BOAT_WELL_DX; b.y = this.boatY();
      if (b.boardTimer <= 0) {
        b.boardState = 2; b.rampV0 = Math.max(b.rampV0, 500);
        b.rampDist = r.markDist + Math.max(0, b.x - STRIP_X0);
      }
      return;
    }
    if (b.rampBack) {
      b.rampBackV += RAMP_G * h * 0.12 * 100;
      b.rampDist -= (80 + b.rampBackV) * h;
      if (b.rampDist <= 0) {
        r.pointAt(0, tmp); b.x = tmp[0]; b.y = tmp[1]; b.ramp = null; b.state = 'FREE'; b.rampBack = false;
        b.vx = 0; b.vy = 220; b.rampCooldown = 0.8;
        this.showMessage('PAS ASSEZ FORT !|Tire plus fort', 1.2);
        return;
      }
      r.pointAt(b.rampDist, tmp); b.x = tmp[0]; b.y = tmp[1];
      return;
    }
    const v2 = b.rampV0 * b.rampV0 - RAMP_G * (r.heightAt(b.rampDist) - r.heightAt(0));
    const rising = r.heightAt(b.rampDist + 6) > r.heightAt(b.rampDist);
    if (v2 < 8100 && rising && b.rampDist < r.length * 0.97 && !(r.id === 0 && b.boardState !== 0)) {
      b.rampBack = true; b.rampBackV = 0; return;
    }
    b.rampDist += Math.sqrt(Math.max(v2, 8100)) * h;
    if (r.id === 0 && b.boardState === 0 && b.rampDist >= r.markDist) {
      r.pointAt(r.markDist, tmp);
      b.flightX0 = tmp[0]; b.flightY0 = tmp[1]; b.flightT = 0; b.boardState = 3;
      return;
    }
    if (b.rampDist >= r.length) { this.finishRamp(b, r); return; }
    r.pointAt(b.rampDist, tmp); b.x = tmp[0]; b.y = tmp[1];
  }

  finishRamp(b, r) {
    const tmp = this.tmp;
    r.pointAt(r.length, tmp); b.x = tmp[0]; b.y = tmp[1]; b.ramp = null; b.rampCooldown = 0.8;
    const base = r.id === 0 ? 1500 : (r.id === 1 ? 1200 : 800);
    let gained, label;
    if (this.wizardActive) { gained = this.addScore(20000); label = 'SUPER JACKPOT !'; }
    else if (this.balls.length > 1) { gained = this.addScore(base * 3); label = 'JACKPOT ' + r.name.toUpperCase() + ' !'; }
    else { gained = this.addScore(base); label = r.name.toUpperCase() + ' !'; }
    this.showMessage(label + '|+' + gained, 1.8);
    this.fire('RAMP');
    if (r.id === 0) this.advance(3, 1); else if (r.id === 1) this.advance(4, 1);
    this.rampMask |= (1 << r.id);
    if (this.missionIndex === 5 && !this.wizardActive) {
      const m = this.missions[5];
      m.progress = [0, 1, 2].filter(i => this.rampMask & (1 << i)).length;
      if (m.progress >= m.goal) this.captureGhost();
    }
    if (r.id === 1) { this.waveRides++; if (this.waveRides % 3 === 0) this.startMultiball('VAGUES', 3, 326, 190, -220, -20); }
    if (r.id === 2) this.dropTarget.up = true;
    if (r.id === 2 && !this.kickerBall && this.kicker.cooldown <= 0) { this.captureInKicker(b); return; }
    if (r.id === 1) { this.enterDeck(b); return; }
    b.state = 'FREE'; b.vx = r.exitVx + (Math.random() - 0.5) * 60; b.vy = r.exitVy;
  }

  // ------------------------------------------------------- plateau supérieur
  enterDeck(b) {
    b.state = 'DECK'; b.deckSlow = 0; b.ramp = null; b.x = 290; b.y = 94; b.vx = -230; b.vy = 20; b.deckT = 0; b.deckHold = 0;
    this.deck.visits++;
    const g = this.addScore(1500);
    this.showMessage('PLATEAU SUPÉRIEUR !|Abats les 2 cibles, puis vise le trou  +' + g, 2.4); this.fire('BOARD');
  }

  // le flipper du haut fonctionne comme les deux autres : il reste levé tant qu'on appuie
  stepDeckFlipper(h) {
    const D = this.deck, want = this.leftFlipper.pressed || this.rightFlipper.pressed;
    if (want) D.holdT += h; else D.holdT = 0;
    D.flipper.pressed = want;
    this.stepFlipper(D.flipper, h);
  }

  deckResetTargets() { const D = this.deck; for (const t of D.targets) t.up = true; D.armed = false; D.armedT = 0; }

  deckStep(b, h) {
    const D = this.deck, hole = D.hole;
    if (b.deckHold > 0) {                                   // bille dans le trou : retenue puis renvoyée
      b.deckHold -= h; b.x = hole.x; b.y = hole.y; b.vx = b.vy = 0;
      if (b.deckHold <= 0) { b.state = 'FREE'; b.x = hole.x + 10; b.y = DECK_Y1 + 2; b.vx = 30; b.vy = 140; b.rampCooldown = 0.6; this.fire('CANNON_FIRE'); }
      return;
    }
    b.vy += GRAVITY * 0.8 * h;
    const damp = 1 - 0.02 * h; b.vx *= damp; b.vy *= damp;
    const sp0 = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (sp0 > MAX_SPEED) { const k = MAX_SPEED / sp0; b.vx *= k; b.vy *= k; }
    b.x += b.vx * h; b.y += b.vy * h; b.deckT += h;
    for (const w of D.walls) this.collideSegment(b, w[0], w[1], w[2], w[3], 0, 0.4, 0, 0, 0);
    const f = D.flipper;
    this.collideSegment(b, f.px, f.py, f.tipX, f.tipY, FLIPPER_R * 0.8, 0.2, f.px, f.py, f.omega);
    // mini slingshot
    const sl = D.sling, imp = this.collideSegment(b, sl[0], sl[1], sl[2], sl[3], 2, 0.3, 0, 0, 0);
    if (imp > 40) {
      let kx = this.hitNx, ky = this.hitNy; const outN = b.vx * kx + b.vy * ky;
      if (outN < 430) { b.vx += kx * (430 - outN); b.vy += ky * (430 - outN); }
      D.slingFlash = 0.12; this.addScore(50); this.fire('SLING');
    }
    // cibles tombantes
    for (const t of D.targets) {
      if (!t.up) continue;
      const r1 = this.collideSegment(b, t.x - t.halfW, t.y + 2, t.x, t.y - 2, 3, 0.25, 0, 0, 0);
      const r2 = this.collideSegment(b, t.x, t.y - 2, t.x + t.halfW, t.y + 2, 3, 0.25, 0, 0, 0);
      if (Math.max(r1, r2) > 40) {
        t.up = false; t.flash = 0.3; this.addScore(1000); this.fire('DROP');
        if (D.targets.every(x => !x.up)) {
          D.armed = true; D.armedT = 25; const g = this.addScore(2000);
          this.showMessage('CIBLES ABATTUES !|Vise le trou  +' + g, 2);
        }
      }
    }
    // anti-blocage : bille quasi immobile > 0,7 s → petit coup vers le bord avant
    if (!D.flipper.pressed && b.vx * b.vx + b.vy * b.vy < 1600) b.deckSlow = (b.deckSlow || 0) + h; else b.deckSlow = 0;
    if (b.deckSlow > 0.7) { b.deckSlow = 0; b.vx = -40 - Math.random() * 40; b.vy = 150; b.y -= 0; }
    const hx = b.x - hole.x, hy = b.y - hole.y;
    if (hx * hx + hy * hy < 100) {
      b.deckHold = 1.2; hole.flash = 1.2;
      const g = this.addScore(D.armed ? 8000 : 1500);
      this.showMessage(D.armed ? 'JACKPOT DU PLATEAU !|+' + g : 'TROU !|+' + g, 2); this.fire('GHOST');
      this.deckResetTargets();
    }
    if (b.y > DECK_Y1 + 4) {                                // la bille tombe du bord avant, sur la table du bas
      b.state = 'FREE'; b.vy = Math.max(b.vy, 90); b.rampCooldown = 0.6;
    } else if (b.deckT > 40) { b.state = 'FREE'; b.x = 190; b.y = DECK_Y1 + 2; b.vx = 0; b.vy = 120; }   // sécurité
  }

  // ------------------------------------------------------- canon (kicker)
  captureInKicker(b) {
    const k = this.kicker;
    b.state = 'HELD'; b.ramp = null; b.x = k.x; b.y = k.y; b.vx = 0; b.vy = 0;
    this.kickerBall = b; k.holdTime = 0.9; k.aim = Math.random() * 80 - 40; this.canonShots++;
    const g = this.addScore(1000);
    this.showMessage('CANON !|+' + g, 1.5); this.fire('KICKER'); this.advance(2, 1);
    if (this.canonShots % 3 === 0) this.startMultiball('CANON', 1, k.x, k.y - 20, 0, -450);
  }

  captureInVuk(b) {
    const v = this.vuk;
    b.state = 'HELD'; b.ramp = null; b.x = v.x; b.y = v.y; b.vx = 0; b.vy = 0;
    this.vukBall = b; v.hold = 1.0; this.vukShots++;
    this.addScore(750); this.fire('LOCK');
    const canLock = this.lockLit && this.lockedBalls < 3 && this.balls.length === 1 && !this.wizardActive;
    v.locking = canLock;
    if (canLock) {
      this.lockedBalls++;
      if (this.lockedBalls < 3) this.showMessage('BILLE VERROUILLÉE ' + this.lockedBalls + '/3|Nouvelle bille au lanceur', 2.2);
    } else {
      this.showMessage('VUK !|+750', 1);
      if (!this.lockLit && this.vukShots >= 3 && !this.wizardActive) this.lightLock('3 TIRS DANS LE VUK');
    }
  }

  lightLock(why) {
    if (this.lockLit || this.lockedBalls >= 3) return;
    this.lockLit = true;
    this.showMessage('VERROU PRÊT !|' + why + ' · vise le tunnel', 2.5);
    this.fire('BONUS');
  }

  resolveVuk() {
    const b = this.vukBall; if (!b) return;
    const v = this.vuk;
    if (v.locking) {
      if (this.lockedBalls >= 3) {
        this.lockedBalls = 0; this.lockLit = false; this.vukShots = 0; v.locking = false;
        this.multiballKind = 'ABORDAGE'; this.abordageT = 0;
        const gained = this.addScore(10000);
        this.showMessage("À L'ABORDAGE !!|MULTIBILLE 3 BILLES +" + gained, 3.2);
        this.fire('ABORDAGE');
        this.ejectFromVuk(b);
        this.releaseQueue = 2; this.releaseTimer = 0.55;
      } else {
        this.balls.splice(this.balls.indexOf(b), 1);
        this.vukBall = null; v.locking = false; v.cooldown = 0.5;
        this.resetBall();
      }
    } else this.ejectFromVuk(b);
  }

  ejectFromVuk(held) {
    const v = this.vuk;
    let b = held;
    if (!b) {
      if (this.balls.length >= MAX_BALLS) return;
      b = new Ball(v.x, v.y + 24); this.balls.push(b);
    } else this.vukBall = null;
    b.state = 'FREE'; b.x = v.x; b.y = v.y + 24;
    const a = rad(-15 + Math.random() * 30), sp = 520 + Math.random() * 160;
    b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp * 0.4 + 110;
    b.rampCooldown = 0.5; v.cooldown = 0.5; v.fireFlash = 0.3;
    this.fire('CANNON_FIRE');
  }

  ejectFromKicker() {
    const k = this.kicker, b = this.kickerBall;
    this.kickerBall = null;
    if (b) {
      const a = rad(-90 + k.aim);
      b.state = 'FREE'; b.vx = Math.cos(a) * 750; b.vy = Math.sin(a) * 750; b.rampCooldown = 0.5;
    }
    k.holdTime = 0; k.cooldown = 0.6; k.fireFlash = 0.35; this.fire('CANNON_FIRE');
  }

  // ---------------------------------------------------- cibles & missions
  onTargetHit(g) {
    g.flash = 0.2;
    if (g.unmasked) { this.addScore(50); this.fire('SLING'); return; }
    g.unmasked = true; this.addScore(500); this.fire('TARGET');
    const n = this.ghosts.filter(x => x.unmasked).length;
    if (n >= this.ghosts.length && !this.wizardActive) this.lightLock('3 FANTÔMES DÉMASQUÉS');
    if (this.missionIndex === 0 && !this.wizardActive) {
      this.missions[0].progress = n;
      if (n >= this.missions[0].goal) { this.ghostResetTimer = 1.2; this.captureGhost(); return; }
    }
    if (n >= this.ghosts.length) {
      this.ghostResetTimer = 1.2;
      const gained = this.addScore(2000);
      this.showMessage('FANTÔMES DÉMASQUÉS !|+' + gained, 1.8); this.fire('BONUS');
    }
  }

  advance(kind, amount) {
    if (this.wizardActive || this.missionIndex >= this.missions.length) return;
    if (kind !== this.missionIndex) return;
    const m = this.missions[this.missionIndex];
    m.progress = Math.min(m.goal, m.progress + amount);
    if (m.progress >= m.goal) this.captureGhost();
  }

  captureGhost() {
    const m = this.missions[this.missionIndex];
    const gained = this.addScore(5000);
    if (this.multiplier < 5) this.multiplier++;
    this.missionIndex++;
    this.fire('GHOST');
    if (this.missionIndex >= this.missions.length) { this.startWizard(); return; }
    if (this.missionIndex === 5) this.rampMask = 0;
    this.showMessage('FANTÔME CAPTURÉ !|' + m.ghostName + ' (+' + gained + ')', 3);
  }

  // ------------------------------------------------------- multibilles
  spawnBall(x, y, vx, vy) {
    if (this.balls.length >= MAX_BALLS) return;
    const nb = new Ball(x, y, vx, vy); nb.rampCooldown = 0.8; this.balls.push(nb);
  }

  startMultiball(kind, extra, x, y, vx0, vy0) {
    if (this.wizardActive || this.phase !== 'PLAYING') return;
    if (this.balls.length > 1) {
      const g = this.addScore(5000);
      this.showMessage('JACKPOT !|+' + g, 2); this.fire('BONUS');
    } else {
      this.multiballKind = kind;
      this.showMessage('MULTIBILLE ' + kind + ' !', 2.5); this.fire('MULTIBALL');
      if (kind === 'TEMPÊTE') this.spawnKraken();
    }
    for (let i = 0; i < extra; i++)
      this.spawnBall(x + (Math.random() - 0.5) * 16, y + i * 14, vx0 + (Math.random() - 0.5) * 160, vy0 + (Math.random() - 0.5) * 120);
  }

  spawnKraken() {
    const k = this.kraken; k.state = 'RISE'; k.hp = KRAKEN_HP; k.show = 0; k.t = 0; k.flash = 0; k.cool = 0; k.killPending = false;
    this.showMessage('LE KRAKEN SURGIT !|Abats-le : ' + KRAKEN_HP + ' coups', 2.6); this.fire('KRAKEN_SPAWN');
  }

  hitKraken(b) {
    const k = this.kraken;
    if (k.state !== 'ALIVE' && k.state !== 'RISE') return;
    if (k.show < 0.55) return;
    const dx = b.x - k.x, dy = b.y - k.y, minD = BALL_R + k.r, d2 = dx * dx + dy * dy;
    if (d2 >= minD * minD) return;
    const d = Math.max(Math.sqrt(d2), 0.001), nx = dx / d, ny = dy / d;
    b.x = k.x + nx * minD; b.y = k.y + ny * minD;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny; }
    const outN = b.vx * nx + b.vy * ny;
    if (outN < 320) { b.vx += nx * (320 - outN); b.vy += ny * (320 - outN); }
    if (k.state !== 'ALIVE' || k.cool > 0 || k.hp <= 0) return;
    k.cool = 0.2; k.flash = 0.25; k.hp--; this.addScore(400); this.fire('KRAKEN_HIT');
    if (k.hp <= 0) k.killPending = true;
    else if (k.hp === 10 || k.hp === 5 || k.hp === 1) this.showMessage('KRAKEN : ' + k.hp + (k.hp > 1 ? ' COUPS' : ' COUP') + ' !', 1.2);
  }

  killKraken() {
    const k = this.kraken; k.killPending = false; k.state = 'DYING'; k.t = 0; k.hp = 0;
    this.multiballKind = '';                              // fin de la TEMPÊTE : les rafales cessent
    let keep = null;                                      // on ne garde qu'une bille libre, la plus basse
    for (const b of this.balls) if (b.state === 'FREE' && (!keep || b.y > keep.y)) keep = b;
    if (keep) this.balls = this.balls.filter(b => b === keep || b.state !== 'FREE');
    this.score += 50000; this.krakenBonusT = 30;          // bonus x2 : 25 000 doublés + score doublé 30 s
    this.showMessage('KRAKEN ANÉANTI !|BONUS x2  +50 000', 3.5); this.fire('KRAKEN_DEATH');
  }

  krakenUpdate(dt) {
    const k = this.kraken;
    if (this.krakenBonusT > 0) this.krakenBonusT = Math.max(0, this.krakenBonusT - dt);
    if (k.flash > 0) k.flash = Math.max(0, k.flash - dt);
    if (k.cool > 0) k.cool = Math.max(0, k.cool - dt);
    // le Kraken fait couler le bateau et le bumper de droite se replie (mécanisme robotique) pour dégager le tir
    const act = k.state === 'RISE' || k.state === 'ALIVE' || k.state === 'DYING';
    this.boatSink = clamp(this.boatSink + (act ? dt / 2.2 : -dt / 2.0), 0, 1);
    const rb = this.bumpers[1]; if (rb) rb.ret = clamp(rb.ret + (act ? dt / 1.6 : -dt / 1.4), 0, 1);
    if (this.boatSink > 0.05) for (const b of this.balls) if (b.state === 'RAMP' && b.boardState === 1) b.boardTimer = Math.min(b.boardTimer, 0);
    if (k.state === 'RISE') { k.show = Math.min(1, k.show + dt / 1.2); if (k.show >= 1) k.state = 'ALIVE'; }
    else if (k.state === 'ALIVE') { k.show = 1; if (k.killPending) this.killKraken(); else if (!this.stormActive) k.state = 'LEAVING'; }
    else if (k.state === 'LEAVING') { k.show = Math.max(0, k.show - dt / 1.2); if (k.show <= 0) k.state = 'NONE'; }
    else if (k.state === 'DYING') { k.t += dt; k.show = Math.max(0, 1 - k.t / 2.8); if (k.t >= 2.8) { k.state = 'NONE'; k.show = 0; } }
  }

  startWizard() {
    this.wizardTime = WIZARD_SECONDS; this.multiballKind = 'WIZARD';
    for (const g of this.ghosts) g.unmasked = false;
    this.showMessage('MODE WIZARD !|YO HO ! LE GALION ACCOSTE', 3.5);
    this.fire('WIZARD');
    this.spawnBall(150, 330, 80, 120); this.spawnBall(222, 330, -80, 120); this.spawnBall(186, 260, 0, 160);
  }

  endWizard(bonus) {
    this.wizardTime = 0; this.missionIndex = 0;
    for (const m of this.missions) m.progress = 0;
    this.rampMask = 0; this.multiplier = 1; this.multiballKind = '';
    for (const g of this.ghosts) g.unmasked = false;
    if (bonus) { const g = this.addScore(25000); this.showMessage('WIZARD TERMINÉ !|+' + g, 3); }
  }

  onDrain(index) {
    if (this.balls.length > 1) {
      this.balls.splice(index, 1); this.fire('DRAIN');
      if (this.balls.length === 1 && !this.wizardActive) { this.multiballKind = ''; this.showMessage('MULTIBILLE TERMINÉE', 1.5); }
    } else this.lostBall();
  }

  lostBall() {
    this.fire('DRAIN');
    if (this.wizardActive) this.endWizard(false);
    this.ballsLeft--;
    if (this.ballsLeft <= 0) {
      this.phase = 'GAME_OVER'; this.inGame = false; this.gameOverTime = 0; this.balls.length = 0;
      if (this.score > this.highScore) this.highScore = this.score;
      this.multiplier = 1; this.fire('GAME_OVER');
    } else { this.resetBall(); this.showMessage('BILLE PERDUE', 1.5); }
  }

  collideSegment(b, x1, y1, x2, y2, radius, bounce, pivotX, pivotY, omega) {
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return -1;
    const t = clamp(((b.x - x1) * dx + (b.y - y1) * dy) / len2, 0, 1);
    const cx = x1 + dx * t, cy = y1 + dy * t;
    let nx = b.x - cx, ny = b.y - cy;
    const minD = BALL_R + radius, d2 = nx * nx + ny * ny;
    if (d2 >= minD * minD) return -1;
    let d = Math.sqrt(d2);
    if (d < 1e-4) { const l = Math.sqrt(len2); nx = -dy / l; ny = dx / l; d = 0; } else { nx /= d; ny /= d; }
    b.x += nx * (minD - d); b.y += ny * (minD - d);
    this.hitNx = nx; this.hitNy = ny;
    const rx = cx - pivotX, ry = cy - pivotY, sx = -omega * ry, sy = omega * rx;
    const vn = (b.vx - sx) * nx + (b.vy - sy) * ny;
    if (vn < 0) { b.vx -= (1 + bounce) * vn * nx; b.vy -= (1 + bounce) * vn * ny; return -vn; }
    return 0;
  }
}
