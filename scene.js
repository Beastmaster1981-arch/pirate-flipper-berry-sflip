'use strict';
// Composition de la scène 3D (port de Scene.compose) + petites matrices 4x4 colonne-majeure.
const M = { BACKDROP: 0, WALLS: 1, SLING_L: 2, SLING_R: 3, RAMP0: 4, BUMPER: 7, GHOST: 8, GHOST_UN: 9, KICKER: 10, FLIPPER: 11, BOAT: 12,
  BALL: 13, SHADOW: 14, PLUNGER: 15, WATER: 16, RAILS: 17, INSERT: 18, GLOW: 19, CAP: 20, BARREL: 21, DROP: 22, WHEEL: 23, SEA: 24, SHIP: 25, VUK: 26, VGEM: 27, KRAKEN: 28, DECK: 29, COUNT: 30 };
const LIGHT = (() => { const x = -0.35, y = 0.85, z = 0.45, l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; })();
const INSERTS = [[38, 568, 1, 0.75, 0.2], [41, 596, 1, 0.75, 0.2], [334, 568, 1, 0.75, 0.2], [331, 596, 1, 0.75, 0.2],
  [110, 112, 0.3, 1, 0.6], [186, 98, 0.3, 1, 0.6], [262, 112, 0.3, 1, 0.6], [296, 372, 0.3, 0.7, 1],
  [158, 330, 1, 0.55, 0.2], [214, 330, 1, 0.55, 0.2], [120, 280, 0.3, 0.9, 1], [300, 300, 0.3, 0.9, 1], [186, 580, 0.4, 0.8, 1]];
const TEAL = [0.18, 0.77, 0.71], BLUE = [0.30, 0.62, 0.88], RGOLD = [0.89, 0.69, 0.29];

const Mat = {
  identity(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; },
  multiply(out, a, b) {
    const t = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; t[c * 4 + r] = s;
    }
    out.set(t);
  },
  translate(m, x, y, z) { Mat.identity(m); m[12] = x; m[13] = y; m[14] = z; },
  trs(out, tx, ty, tz, ry, rz, s) {
    const T = new Float32Array(16), R = new Float32Array(16), t = new Float32Array(16);
    Mat.translate(T, tx, ty, tz);
    Mat.identity(R); let c = Math.cos(ry), sn = Math.sin(ry); R[0] = c; R[2] = -sn; R[8] = sn; R[10] = c;
    Mat.multiply(t, T, R);
    Mat.identity(R); c = Math.cos(rz); sn = Math.sin(rz); R[0] = c; R[1] = sn; R[4] = -sn; R[5] = c;
    Mat.multiply(t, t, R);
    Mat.identity(R); R[0] = R[5] = R[10] = s;
    Mat.multiply(out, t, R);
  },
  perspective(m, fovDeg, aspect, near, far) {
    const f = 1 / Math.tan(fovDeg * Math.PI / 360); m.fill(0);
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = 2 * far * near / (near - far);
  },
  lookAt(m, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    let fx = cx - ex, fy = cy - ey, fz = cz - ez; const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    let sx = fy * uz - fz * uy, sy = fz * ux - fx * uz, sz = fx * uy - fy * ux; const sl = Math.hypot(sx, sy, sz); sx /= sl; sy /= sl; sz /= sl;
    const vx = sy * fz - sz * fy, vy = sz * fx - sx * fz, vz = sx * fy - sy * fx;
    m[0] = sx; m[4] = sy; m[8] = sz; m[12] = -(sx * ex + sy * ey + sz * ez);
    m[1] = vx; m[5] = vy; m[9] = vz; m[13] = -(vx * ex + vy * ey + vz * ez);
    m[2] = -fx; m[6] = -fy; m[10] = -fz; m[14] = fx * ex + fy * ey + fz * ez;
    m[3] = m[7] = m[11] = 0; m[15] = 1;
  },
  transform(m, x, y, z, w, o) { for (let r = 0; r < 4; r++) o[r] = m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r] * w; }
};

class Draw {
  constructor() { this.model = new Float32Array(16); this.reset(0); }
  reset(m) {
    this.mesh = m; Mat.identity(this.model); this.er = this.eg = this.eb = 0; this.spec = 0.25; this.shine = 24; this.env = 0;
    this.alpha = 1; this.blend = false; this.add = false; this.tex = false;
  }
}

function ghostPose(i, t, flash) {
  const ph = i * 2.1;
  return [4 * Math.sin(1.1 * t + ph), 5.5 + 2.5 * Math.sin(2.3 * t + ph) + 6 * flash, 3 * Math.sin(1.7 * t + 1.3 * ph),
    0.45 * Math.sin(0.9 * t + ph) + 0.7 * flash * Math.sin(t * 50), -0.16 * Math.cos(1.1 * t + ph)];
}

function glow(d, x, z, r, cr, cg, cb, a) {
  d.reset(M.GLOW); Mat.trs(d.model, x, 0.9, z, 0, 0, r);
  d.er = cr; d.eg = cg; d.eb = cb; d.spec = 0; d.alpha = a; d.blend = true; d.add = true;
}

function composeScene(s, lay, rampPts0, out) {
  let n = 0;
  const D = () => out[n++];
  let d = D(); d.reset(M.BACKDROP); d.er = 0.07; d.eg = 0.05; d.eb = 0.09; d.spec = 0;
  d = D(); d.reset(M.SEA); d.er = 0.005; d.eg = 0.02; d.eb = 0.04; d.spec = 0.35; d.shine = 60;
  const moored = [[112, -104, 0.5, 0.35], [146, -96, 0.42, -0.5]];
  for (let k = 0; k < 2; k++) {
    d = D(); d.reset(M.SHIP);
    Mat.trs(d.model, moored[k][0], 0.8 * Math.sin(s.time * 1.3 + k * 2), moored[k][1], moored[k][3], (2 * Math.sin(s.time * 1.1 + k)) * Math.PI / 180, moored[k][2]);
    d.er = 0.05; d.eg = 0.03; d.eb = 0.04; d.spec = 0.3;
  }
  {
    const e = 1 - (1 - s.shipT) * (1 - s.shipT), sx = 330 + (1 - e) * 330;
    const bob = Math.sin(s.time * 1.6) * (0.4 + 0.6 * (1 - s.shipT));
    d = D(); d.reset(M.SHIP);
    Mat.trs(d.model, sx, bob, -107, 0, (3 * Math.sin(s.time * 1.2)) * Math.PI / 180, 1);
    d.er = 0.05 + 0.06 * s.shipT; d.eg = 0.03 + 0.04 * s.shipT; d.eb = 0.04; d.spec = 0.3;
  }
  if (s.departT >= 0 && s.departT < 9) {
    const t = s.departT, grow = Math.min(1, t), tu = Math.min(1, t / 2.2), turn = tu * tu * (3 - 2 * tu);
    const mv = Math.max(0, Math.min(1, (t - 1.2) / 7.8));
    d = D(); d.reset(M.SHIP);
    Mat.trs(d.model, 296 + 420 * Math.pow(mv, 1.5), Math.sin(s.time * 1.8), -100 - 34 * mv, Math.PI * turn, (4 * Math.sin(s.time * 1.5)) * Math.PI / 180, 0.8 * grow);
    d.er = 0.03; d.eg = 0.02; d.eb = 0.03; d.spec = 0.3;
  }
  d = D(); d.reset(M.WALLS); d.spec = 0.7; d.shine = 50;
  d = D(); d.reset(M.RAILS); d.spec = 1.3; d.shine = 90; d.env = 0.45;
  for (let k = 0; k < 2; k++) {
    d = D(); d.reset(k === 0 ? M.SLING_L : M.SLING_R);
    d.er = s.slingFlash[k] * 0.6; d.eg = s.slingFlash[k] * 0.5; d.eb = s.slingFlash[k] * 0.2;
  }
  const rcols = [TEAL, BLUE, RGOLD];
  for (let i = 0; i < 3; i++) {
    d = D(); d.reset(M.RAMP0 + i); d.spec = 1; d.shine = 70;
    const rc = rcols[i]; d.er = rc[0] * 0.16; d.eg = rc[1] * 0.16; d.eb = rc[2] * 0.16;
  }
  const nb = lay.bumpers.length / 3;
  for (let i = 0; i < nb; i++) {
    const bx = lay.bumpers[i * 3], bz = lay.bumpers[i * 3 + 1], f = Math.min(1, s.bumperFlash[i]);
    const rr = s.bumperRet[i], q = Math.round(rr * 5) / 5, dn = q * 27, blink = rr > 0 && rr < 1 ? (Math.floor(s.time * 8) % 2) * 0.35 : 0;   // mouvement par paliers = robotique
    d = D(); d.reset(M.BUMPER); Mat.translate(d.model, bx, -dn, bz);
    d.er = 0.55 * f + blink; d.eg = 0.42 * f + 0.6 * blink; d.eb = 0.10 * f; d.spec = 0.55; d.shine = 40;
    d = D(); d.reset(M.CAP); Mat.trs(d.model, bx, 17.4 + 0.8 * f - dn, bz, q * Math.PI * 2, 0, 17.8);
    d.tex = true; d.er = 0.35 * f; d.eg = 0.30 * f; d.eb = 0.10 * f; d.spec = 0.9; d.shine = 70;
    d = D(); d.reset(M.WHEEL); Mat.trs(d.model, bx, 15.6 - dn, bz, s.bumperSpin[i] + q * 12, 0, 1);
    d.er = 0.30 * f; d.eg = 0.22 * f; d.eb = 0.05 * f; d.spec = 0.6; d.shine = 40;
  }
  d = D(); d.reset(M.VUK);
  const lit = s.vukLit * 0.28 + s.vukFlash * 0.4;
  d.er = 0.9 * lit; d.eg = 0.55 * lit; d.eb = 0.15 * lit; d.spec = 0.3;
  for (let k = 0; k < 3; k++) {
    d = D(); d.reset(M.VGEM); Mat.trs(d.model, lay.vukX, 16.8, lay.vukY + 6 - k * 10, 0, 0, 1);
    const on = k < s.vukLocked ? 1 : (s.vukLocked === 0 && s.vukLit > 0 && k === 0 ? 0.35 * s.vukLit : 0.04);
    d.er = on; d.eg = 0.62 * on; d.eb = 0.12 * on; d.spec = 0.9; d.shine = 60;
  }
  const ng = lay.ghosts.length / 3;
  for (let i = 0; i < ng; i++) {
    d = D(); d.reset(s.ghostUn[i] ? M.GHOST_UN : M.GHOST);
    const f = Math.min(1, s.ghostFlash[i]), gp = ghostPose(i, s.time, f);
    Mat.trs(d.model, lay.ghosts[i * 3] + gp[0], gp[1], lay.ghosts[i * 3 + 1] + gp[2], gp[3], gp[4], 1 + 0.035 * Math.sin(s.time * 3.1 + i));
    const un = s.ghostUn[i];
    d.er = 0.45 * f + (un ? 0 : 0.10); d.eg = 0.45 * f + (un ? 0 : 0.10); d.eb = 0.45 * f + (un ? 0 : 0.14);
  }
  d = D(); d.reset(M.KICKER); Mat.translate(d.model, lay.kickerX, 0, lay.kickerY);
  d.spec = 0.6; d.shine = 50; const cl = s.cannonLoaded; d.er = 0.35 * cl; d.eg = 0.20 * cl;
  {
    const sa = Math.sin(s.cannonAim), ca = Math.cos(s.cannonAim);
    d = D(); d.reset(M.BARREL);
    Mat.trs(d.model, lay.kickerX - sa * s.cannonRecoil * 8, 0, lay.kickerY + ca * s.cannonRecoil * 8, -s.cannonAim, 0, 1);
    d.spec = 0.9; d.shine = 60; d.env = 0.3;
    d.er = 0.45 * cl * 0.6 + 0.5 * s.cannonFlash; d.eg = 0.25 * cl * 0.6 + 0.35 * s.cannonFlash; d.eb = 0.08 * s.cannonFlash;
  }
  for (let k = 0; k < 2; k++) {
    d = D(); d.reset(M.FLIPPER);
    Mat.trs(d.model, lay.flippers[k * 2], 0, lay.flippers[k * 2 + 1], -(k === 0 ? s.leftAngle : s.rightAngle), 0, 1);
    d.spec = 0.5; d.shine = 40;
  }
  if (s.boatSink < 0.995) { const se = s.boatSink * s.boatSink * (3 - 2 * s.boatSink);
    d = D(); d.reset(M.BOAT); Mat.trs(d.model, s.boatX - 8 * se, s.boatBob - 62 * se, STRIP_Y, 0, (s.boatTilt + 28 * se) * Math.PI / 180, 1); d.spec = 0.3; }
  if (s.krakenShow > 0.01) {
    const e = 1 - Math.pow(1 - s.krakenShow, 2);
    d = D(); d.reset(M.KRAKEN);
    const wob = 0.12 * Math.sin(s.time * 1.6) + 0.18 * s.krakenFlash * Math.sin(s.time * 60);
    Mat.trs(d.model, s.krakenX, -52 * (1 - e), s.krakenY, wob + s.krakenDying * 0.6 * (1 - s.krakenShow),
      s.krakenDying * 0.5 * (1 - s.krakenShow), 1.45 + 0.05 * Math.sin(s.time * 3));
    d.er = 0.9 * s.krakenFlash; d.eg = 0.12 * s.krakenFlash; d.eb = 0.10 * s.krakenFlash; d.spec = 0.45; d.shine = 36;
  }
  d = D(); d.reset(M.DECK); d.spec = 0.3;
  d = D(); d.reset(M.FLIPPER); Mat.trs(d.model, 252, DECK_H, 115, -s.deckAngle, 0, 0.58); d.spec = 0.5; d.shine = 40;
  const dtp = [[168, 86], [204, 74]];
  for (let i = 0; i < 2; i++) {
    const f = Math.min(1, s.deckDropFlash[i]);
    d = D(); d.reset(M.DROP); Mat.trs(d.model, dtp[i][0], DECK_H - 17.5 * 0.55 * s.deckDrop[i], dtp[i][1], 0, 0, 0.55);
    d.spec = 0.8; d.shine = 50; d.er = 0.9 * f; d.eg = 0.6 * f; d.eb = 0.2 * f;
  }
  d = D(); d.reset(M.PLUNGER); Mat.translate(d.model, LANE_X + 14, 0, PLUNGER_REST_Y + s.plunge * PLUNGER_TRAVEL); d.spec = 0.6;
  d = D(); d.reset(M.DROP); Mat.translate(d.model, lay.dropX, -17.5 * s.dropAnim, lay.dropY);
  d.spec = 0.8; d.shine = 50; d.er = 0.9 * s.dropFlash; d.eg = 0.6 * s.dropFlash; d.eb = 0.2 * s.dropFlash;
  d = D(); d.reset(M.INSERT); Mat.trs(d.model, lay.dropX, 0.5, lay.dropY, 0, 0, 1); d.spec = 0; d.er = 0.02;
  for (let k = 0; k < INSERTS.length; k++) {
    const ic = INSERTS[k], p = 0.55 + 0.45 * Math.sin(s.time * 3 + k * 0.9);
    d = D(); d.reset(M.INSERT); Mat.trs(d.model, ic[0], 0.45, ic[1], 0, 0, 5.5);
    d.er = ic[2] * p; d.eg = ic[3] * p; d.eb = ic[4] * p; d.spec = 1; d.shine = 60;
  }
  for (let i = 0; i < s.ballCount; i++) {
    d = D(); d.reset(M.BALL); Mat.translate(d.model, s.ballX[i], s.ballH[i], s.ballY[i]); d.spec = 1.2; d.shine = 90; d.env = 0.8;
  }
  for (let i = 0; i < s.ballCount; i++) {
    const h = s.ballH[i]; d = D(); d.reset(M.SHADOW);
    const surf = h > 40 ? DECK_H : 0, hh = h - surf;
    Mat.trs(d.model, s.ballX[i] + 0.25 * hh, surf + 0.6, s.ballY[i] - 0.3 * hh, 0, 0, 9 + 0.2 * (hh - BALL_R));
    d.blend = true; d.alpha = Math.max(0.25, 1 - 0.012 * (hh - BALL_R));
  }
  for (let i = 0; i < nb; i++) {
    d = D(); d.reset(M.SHADOW); Mat.trs(d.model, lay.bumpers[i * 3] + 5, 0.5, lay.bumpers[i * 3 + 1] - 6, 0, 0, 27); d.blend = true; d.alpha = 0.8 * (1 - Math.min(1, s.bumperRet[i] * 1.3));
  }
  for (let i = 0; i < ng; i++) {
    d = D(); d.reset(M.SHADOW);
    const gp = ghostPose(i, s.time, Math.min(1, s.ghostFlash[i])), hh = gp[1];
    Mat.trs(d.model, lay.ghosts[i * 3] + gp[0] + 4 + 0.3 * hh, 0.5, lay.ghosts[i * 3 + 1] + gp[2] - 5 - 0.3 * hh, 0, 0, 15.5 - 0.35 * hh);
    d.blend = true; d.alpha = Math.max(0.3, 0.75 - 0.03 * hh);
  }
  d = D(); d.reset(M.WATER);
  Mat.translate(d.model, 3 * Math.sin(s.time * 1.1), 0.5 * Math.sin(s.time * 1.7), 0); d.spec = 0.9; d.shine = 70; d.blend = true;
  for (let k = 0; k < INSERTS.length; k++) {
    const ic = INSERTS[k], p = 0.55 + 0.45 * Math.sin(s.time * 3 + k * 0.9);
    glow(D(), ic[0], ic[1], 17, ic[2] * p, ic[3] * p, ic[4] * p, 0.7);
  }
  for (let i = 0; i < nb; i++) {
    const f = 0.35 + 0.65 * Math.min(1, s.bumperFlash[i]);
    const gk = 1 - Math.min(1, s.bumperRet[i] * 1.5);
    if (gk > 0.02) glow(D(), lay.bumpers[i * 3], lay.bumpers[i * 3 + 1], 46, f * gk, 0.62 * f * gk, 0.22 * f * gk, 0.75);
  }
  for (let i = 0; i < ng; i++) {
    const f = 0.35 + 0.65 * Math.min(1, s.ghostFlash[i]);
    if (s.ghostUn[i]) glow(D(), lay.ghosts[i * 3], lay.ghosts[i * 3 + 1], 26, 0.5 * f, f, 0.6 * f, 0.7);
    else glow(D(), lay.ghosts[i * 3], lay.ghosts[i * 3 + 1], 26, 0.5 * f, 0.7 * f, f, 0.7);
  }
  const kf = 0.3 + 0.7 * s.cannonLoaded;
  glow(D(), lay.kickerX, lay.kickerY, 34, kf, 0.5 * kf, 0.15 * kf, 0.7);
  {
    const sa = Math.sin(s.cannonAim), ca = Math.cos(s.cannonAim);
    if (s.cannonLock > 0) {
      const pulse = 0.6 + 0.4 * Math.sin(s.time * 14);
      for (let k = 1; k <= 9; k++) {
        const dist = 34 + k * 24, fade = (1 - k / 10) * pulse;
        glow(D(), lay.kickerX + sa * dist, lay.kickerY - ca * dist, 10, 1.8 * fade, 1.3 * fade, 0.4 * fade, 1);
      }
      glow(D(), lay.kickerX + sa * 262, lay.kickerY - ca * 262, 20, 1.6 * pulse, 0.5 * pulse, 0.2 * pulse, 1);
    }
    if (s.cannonFlash > 0) {
      const f = s.cannonFlash;
      glow(D(), lay.kickerX + sa * 28, lay.kickerY - ca * 28, 46 * (1.2 - 0.4 * f), f, 0.82 * f, 0.35 * f, 0.95);
      glow(D(), lay.kickerX + sa * 34, lay.kickerY - ca * 34, 18, f, f, 0.9 * f, 0.9);
    }
  }
  for (let i = 0; i < 3; i++) {
    const p = 0.6 + 0.4 * Math.sin(s.time * 2.5 + i * 2), c = rcols[i];
    glow(D(), rampPts0[i][0], rampPts0[i][1], 30, c[0] * p, c[1] * p, c[2] * p, 0.8);
  }
  if (s.krakenShow > 0.01) {
    const f = s.krakenShow;
    glow(D(), s.krakenX, s.krakenY, 44 * (0.7 + 0.3 * f), 0.10 * f, 0.45 * f, 0.40 * f, 0.8);
    if (s.krakenFlash > 0) glow(D(), s.krakenX, s.krakenY, 36, s.krakenFlash, 0.15 * s.krakenFlash, 0.1 * s.krakenFlash, 0.9);
  }
  {
    const f = Math.min(1, Math.max(s.deckHoleFlash, s.deckArmed * (0.55 + 0.45 * Math.sin(s.time * 8))));
    if (f > 0.02) { const gd = D(); glow(gd, 130, 72, 24, f, 0.8 * f, 0.3 * f, 0.9); gd.model[13] = DECK_H + 1; }
  }
  if (s.deckSlingFlash > 0) { const f = Math.min(1, s.deckSlingFlash), gd = D(); glow(gd, 133, 110, 16, f, 0.7 * f, 0.2 * f, 0.9); gd.model[13] = DECK_H + 1; }
  return n;
}

function newState() {
  return { time: 0, leftAngle: 0, rightAngle: 0, plunge: 0, boatX: 0, boatBob: 0, boatTilt: 0,
    bumperFlash: new Float32Array(8), bumperRet: new Float32Array(8), boatSink: 0, bumperSpin: new Float32Array(8), vukLocked: 0, vukLit: 0, vukFlash: 0, shipT: 0, departT: -1,
    ghostUn: new Array(8).fill(false), ghostFlash: new Float32Array(8), slingFlash: new Float32Array(2), cannonLoaded: 0,
    dropAnim: 0, dropFlash: 0, cannonAim: 0, cannonLock: 0, cannonRecoil: 0, cannonFlash: 0, wizard: false,
    deckAngle: 0, deckHoleFlash: 0, deckArmed: 0, deckSlingFlash: 0, deckDrop: new Float32Array(2), deckDropFlash: new Float32Array(2), krakenShow: 0, krakenFlash: 0, krakenX: 0, krakenY: 0, krakenDying: 0, ballCount: 0, ballX: new Float32Array(8), ballY: new Float32Array(8), ballH: new Float32Array(8) };
}
