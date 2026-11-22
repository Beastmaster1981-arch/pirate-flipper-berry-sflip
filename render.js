'use strict';
// Rendu WebGL (port de GLRenderer.kt) : mêmes shaders, mêmes maillages (exportés depuis le moteur Android).
const PREC = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
const LIT_VS = `uniform mat4 uVP; uniform mat4 uModel; attribute vec3 aPos; attribute vec3 aNormal; attribute vec4 aColor;
varying vec3 vW; varying vec3 vN; varying vec4 vC;
void main(){ vec4 w = uModel * vec4(aPos,1.0); vW = w.xyz; vN = (uModel * vec4(aNormal,0.0)).xyz; vC = aColor; gl_Position = uVP * w; }`;
const LIT_FS = PREC + `uniform vec3 uLight; uniform vec3 uEye; uniform vec3 uEmissive; uniform float uSpec; uniform float uShine;
uniform float uAlpha; uniform float uEnv; uniform float uTexOn; uniform sampler2D uTex;
varying vec3 vW; varying vec3 vN; varying vec4 vC;
void main(){
  vec3 baseCol = vC.rgb;
  if (uTexOn > 0.5) baseCol = texture2D(uTex, vC.rg).rgb;
  vec3 n = normalize(vN); vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.0) n = -n;
  float diff = max(dot(n, uLight), 0.0);
  vec3 h = normalize(uLight + v);
  float spec = pow(max(dot(n, h), 0.0), uShine) * uSpec;
  float amb = 0.30 + 0.15 * n.y;
  float fill = max(dot(n, v), 0.0) * 0.12;
  vec3 lit = vec3(amb*0.92 + 0.88*diff + fill, amb + 0.84*diff + fill, amb*1.1 + 0.80*diff + fill);
  vec3 col = baseCol * lit + uEmissive + vec3(spec);
  if (uEnv > 0.0) {
    float dn = dot(v, n); vec3 r = 2.0*dn*n - v;
    float sky = pow(0.5 + 0.5*r.y, 1.5);
    vec3 env = vec3(0.08 + 0.67*sky, 0.10 + 0.75*sky, 0.18 + 0.82*sky);
    float lobe = pow(max(dot(r, uLight), 0.0), 24.0) * 1.2;
    float lobe2 = pow(max(dot(r, vec3(0.5,0.6,-0.6)), 0.0), 30.0) * 0.6;
    env += vec3(lobe + 0.5*lobe2, lobe + 0.6*lobe2, lobe + 0.8*lobe2);
    float fres = 0.35 + 0.5 * pow(1.0 - max(dn, 0.0), 3.0);
    float k = min(uEnv / 0.6, 1.0);
    float base = 1.0 - fres * k;
    float dim = uEnv > 0.6 ? 0.5 : 1.0;
    col = baseCol * lit * base * dim + env * fres * k + vec3(spec) + uEmissive;
  }
  gl_FragColor = vec4(col, vC.a * uAlpha);
}`;
const FLOOR_VS = `uniform mat4 uVP; attribute vec3 aPos; attribute vec2 aColor; varying vec2 vUV; varying vec3 vW;
void main(){ vUV = aColor; vW = aPos; gl_Position = uVP * vec4(aPos,1.0); }`;
const FLOOR_FS = PREC + `uniform sampler2D uTex; uniform vec3 uLight; uniform vec3 uEye; varying vec2 vUV; varying vec3 vW;
void main(){
  vec3 base = texture2D(uTex, vUV).rgb; vec3 v = normalize(uEye - vW);
  float diff = uLight.y; vec3 h = normalize(uLight + v);
  float spec = pow(max(h.y, 0.0), 28.0) * 0.45; float amb = 0.45; float fill = v.y * 0.12;
  vec3 lit = vec3(amb*0.92 + 0.88*diff + fill, amb + 0.84*diff + fill, amb*1.1 + 0.80*diff + fill);
  gl_FragColor = vec4(base * lit + vec3(spec), 1.0);
}`;
const BG_VS = `attribute vec2 aPos; varying float vV; void main(){ vV = 0.5 - 0.5 * aPos.y; gl_Position = vec4(aPos, 0.9999, 1.0); }`;
const BG_FS = PREC + `varying float vV; void main(){ gl_FragColor = vec4(0.02 + 0.05*vV, 0.015 + 0.03*vV, 0.07 + 0.09*(1.0-vV), 1.0); }`;

class Cam {
  constructor() { this.view = new Float32Array(16); this.proj = new Float32Array(16); this.vp = new Float32Array(16); this.baseDist = 0; }
  setup(aspect, tgtX, tgtZ, dist) {
    const p = 52 * Math.PI / 180;
    this.tx = tgtX; this.ty = 0; this.tz = tgtZ;
    this.ex = tgtX; this.ey = dist * Math.sin(p); this.ez = tgtZ + dist * Math.cos(p);
    Mat.lookAt(this.view, this.ex, this.ey, this.ez, this.tx, 0, this.tz, 0, 1, 0);
    Mat.perspective(this.proj, 45, aspect, 250, 5000);
    Mat.multiply(this.vp, this.proj, this.view);
  }
  range() {
    const KEY = [[16, 0, 770], [384, 0, 770], [16, 22, 770], [384, 22, 770], [60, 22, 95], [340, 22, 95], [200, 22, 18], [20, 22, 200], [380, 22, 200], [118, 58, 62], [296, 58, 62]];
    let minY = 1e9, maxY = -1e9, maxX = 0; const t = [0, 0, 0, 0];
    for (const k of KEY) {
      Mat.transform(this.vp, k[0], k[1], k[2], 1, t);
      const nx = t[0] / t[3], ny = t[1] / t[3];
      minY = Math.min(minY, ny); maxY = Math.max(maxY, ny); maxX = Math.max(maxX, Math.abs(nx));
    }
    return [minY, maxY, maxX];
  }
  fits() { const r = this.range(); return r[2] <= 0.96 && r[0] >= -0.80 && r[1] <= 0.86; }
  fit(aspect, tgtX, tgtZ) {
    let tzc = tgtZ, dist = 1200;
    const kf = Math.tan(45 * Math.PI / 360), sp = Math.sin(52 * Math.PI / 180);
    for (let it = 0; it < 12; it++) {
      this.setup(aspect, tgtX, tzc, dist);
      const r = this.range(), center = (r[0] + r[1]) / 2;
      tzc -= (center + 0.06) * dist * kf / sp;
      let d = 300;
      for (; d < 4500; d += 6) { this.setup(aspect, tgtX, tzc, d); if (this.fits()) break; }
      dist = d;
    }
    this.setup(aspect, tgtX, tzc, dist);
    this.baseX = tgtX; this.baseZ = tzc; this.baseDist = dist;
  }
  punch(aspect, zoom, dx, dz) { if (this.baseDist > 0) this.setup(aspect, this.baseX + dx, this.baseZ + dz, this.baseDist / (1 + zoom)); }
}

class Renderer {
  constructor(canvas, game, data) {
    this.canvas = canvas; this.game = game;
    const gl = this.gl = canvas.getContext('webgl', { antialias: (window.devicePixelRatio || 1) < 1.5, alpha: false, depth: true, powerPreference: 'high-performance' }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL indisponible');
    this.cam = new Cam(); this.state = newState(); this.draws = Array.from({ length: 220 }, () => new Draw());
    this.spinA = new Float32Array(8); this.spinV = new Float32Array(8); this.spinPrev = new Float32Array(8); this.spinT = 0; this.shipT = 0; this.punched = false;
    this.layout = Renderer.buildLayout(game);
    gl.clearColor(0.03, 0.02, 0.08, 1); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    this.lit = this.program(LIT_VS, LIT_FS, ['uVP', 'uModel', 'uLight', 'uEye', 'uEmissive', 'uSpec', 'uShine', 'uAlpha', 'uEnv', 'uTexOn', 'uTex']);
    this.floorP = this.program(FLOOR_VS, FLOOR_FS, ['uVP', 'uTex', 'uLight', 'uEye']);
    this.bgP = this.program(BG_VS, BG_FS, []);
    // maillages
    const buf = data.meshes, counts = data.counts; this.vbos = []; this.counts = [];
    let off = 0;
    for (let i = 0; i < M.COUNT; i++) {
      const arr = new Float32Array(buf, off, counts[i]); off += counts[i] * 4;
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      this.vbos.push(vb); this.counts.push(counts[i] / 10);
    }
    // sol
    const fl = [], fv = (x, z) => fl.push(x, 0, z, x / TABLE_W, z / TABLE_H);
    const pts = [[386, TABLE_H], [386, 200]]; const nn = 36;
    for (let i = 0; i <= nn; i++) { const a = Math.PI * i / nn; pts.push([200 + 186 * Math.cos(a), 200 - 186 * Math.sin(a)]); }
    pts.push([14, 200], [14, TABLE_H]);
    for (let i = 0; i < pts.length - 1; i++) { fv(200, 400); fv(pts[i][0], pts[i][1]); fv(pts[i + 1][0], pts[i + 1][1]); }
    fv(200, 400); fv(pts[pts.length - 1][0], pts[pts.length - 1][1]); fv(pts[0][0], pts[0][1]);
    this.floorVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.floorVbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fl), gl.STATIC_DRAW);
    this.floorCount = fl.length / 5;
    this.bgVbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bgVbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.floorTex = this.texture(data.floorImg, 0, true);
    this.logoTex = this.texture(data.logoImg, 1, true);
    this.scene = null;
  }

  static buildLayout(game) {
    const L = { bumpers: [], ghosts: [], flippers: [game.leftFlipper.px, game.leftFlipper.py, game.rightFlipper.px, game.rightFlipper.py] };
    for (const b of game.bumpers) L.bumpers.push(b.x, b.y, b.r);
    for (const g of game.ghosts) L.ghosts.push(g.x, g.y, g.r);
    L.kickerX = game.kicker.x; L.kickerY = game.kicker.y; L.vukX = game.vuk.x; L.vukY = game.vuk.y;
    L.dropX = game.dropTarget.x; L.dropY = game.dropTarget.y;
    return L;
  }

  texture(img, unit, mip) {
    const gl = this.gl, t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    const pot = (n) => (n & (n - 1)) === 0;
    if (pot(img.width) && pot(img.height)) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    gl.activeTexture(gl.TEXTURE0);
    return t;
  }

  program(vs, fs, uniforms) {
    const gl = this.gl, p = gl.createProgram();
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNormal'); gl.bindAttribLocation(p, 2, 'aColor');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.u = {}; for (const u of uniforms) p.u[u] = gl.getUniformLocation(p, u);
    return p;
  }

  resize() {
    // résolution adaptative : si l'appareil rame, on réduit automatiquement la définition (voir frame())
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * (this.resScale || 1);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    const changed = this.canvas.width !== w || this.canvas.height !== h || !this.fitted;
    if (changed) { this.canvas.width = w; this.canvas.height = h; }
    this.aspect = w / h; this.gl.viewport(0, 0, w, h);
    if (changed) { this.cam.fit(this.aspect, 200, 400); this.fitted = true; this.punched = false; }
  }

  updateBallHeights(dt) {
    const g = this.game;
    for (const b of g.balls) {
      if (b.state === 'RAMP') {
        const r = b.ramp; if (!r) continue;
        const deck = 20.4 + BALL_R;
        if (r.id === 0 && b.boardState === 3) {
          const top = r.heightAt(r.markDist) + BALL_R;
          b.visualH = top + (deck - top) * b.flightT + 16 * Math.sin(Math.PI * b.flightT);
        } else if (r.id === 0 && b.boardState === 1) b.visualH = deck;
        else b.visualH = r.heightAt(b.rampDist) + BALL_R;
      } else if (b.state === 'DECK') b.visualH = DECK_H + BALL_R;
      else if (b.state === 'HELD') b.visualH = 5;
      else b.visualH = b.visualH > BALL_R ? Math.max(BALL_R, b.visualH - 380 * dt) : BALL_R;
    }
  }

  applyCameraPunch() {
    const g = this.game, env = g.abordageEnv, t = g.time, c = this.cam;
    if (env > 0) {
      const amp = 9 * env; c.punch(this.aspect, 0.32 * env, amp * Math.sin(t * 61), amp * 0.7 * Math.cos(t * 73)); this.punched = true;
    } else if (g.stormActive) {
      const gg = Math.max(0, Math.sin(t * 1.7 + 2 * Math.sin(t * 0.6))), gust = gg * gg * gg, amp = 1.2 + 10 * gust;
      c.punch(this.aspect, 0.03 * gust, amp * Math.sin(t * 41) + 8 * gust, 0.45 * amp * Math.cos(t * 53)); this.punched = true;
    } else if (this.punched) { c.punch(this.aspect, 0, 0, 0); this.punched = false; }
  }

  fillState() {
    const g = this.game, s = this.state;
    s.time = g.time; s.leftAngle = g.leftFlipper.angle; s.rightAngle = g.rightFlipper.angle;
    s.plunge = g.phase === 'READY' ? g.plunge : 0;
    s.boatX = g.boatX(); s.boatBob = g.boatY() - STRIP_Y; s.boatTilt = g.boatTilt(); s.boatSink = g.boatSink; s.wizard = g.wizardActive;
    const dtw = clamp(g.time - this.spinT, 0, 0.1);
    this.shipT = clamp(this.shipT + (g.wizardActive ? dtw / 8 : -dtw / 5), 0, 1); s.shipT = this.shipT; s.departT = g.departT; this.spinT = g.time;
    for (let i = 0; i < Math.min(8, g.bumpers.length); i++) {
      const fl = Math.min(1, g.bumpers[i].flash / 0.15); s.bumperFlash[i] = fl; s.bumperRet[i] = g.bumpers[i].ret;
      if (fl > this.spinPrev[i] + 0.3) this.spinV[i] += i % 2 === 0 ? 11 : -11;
      this.spinPrev[i] = fl;
      this.spinV[i] += ((i % 2 === 0 ? 0.6 : -0.6) - this.spinV[i]) * Math.min(1, 2.2 * dtw);
      this.spinA[i] += this.spinV[i] * dtw; s.bumperSpin[i] = this.spinA[i];
    }
    for (let i = 0; i < Math.min(8, g.ghosts.length); i++) { s.ghostUn[i] = g.ghosts[i].unmasked; s.ghostFlash[i] = Math.min(1, g.ghosts[i].flash / 0.2); }
    let k = 0;
    for (const w of g.walls) if (w.kick > 0 && k < 2) s.slingFlash[k++] = Math.min(1, w.flash / 0.12);
    s.dropAnim = g.dropTarget.drop; s.dropFlash = Math.min(1, g.dropTarget.flash / 0.3);
    const kk = g.kicker, target = kk.aim * Math.PI / 180;
    s.cannonLoaded = kk.holdTime > 0 ? 1 : 0;
    if (kk.holdTime > 0) {
      const u = 1 - kk.holdTime / 0.9, t = clamp((u - 0.45) / 0.35, 0, 1), sm = t * t * (3 - 2 * t);
      s.cannonAim = target * sm + 0.7 * (1 - sm) * Math.sin(u * 22); s.cannonLock = sm > 0.98 ? 1 : 0;
    } else if (kk.fireFlash > 0) { s.cannonAim = target; s.cannonLock = 0; } else { s.cannonAim = 0; s.cannonLock = 0; }
    const ff = clamp(kk.fireFlash / 0.35, 0, 1); s.cannonFlash = ff * ff; s.cannonRecoil = ff;
    s.vukLocked = g.lockedBalls; s.vukLit = g.lockLit ? 0.6 + 0.4 * Math.sin(g.time * 7) : 0; s.vukFlash = clamp(g.vuk.fireFlash / 0.3, 0, 1);
    s.deckAngle = g.deck.flipper.angle; s.deckHoleFlash = g.deck.hole.flash;
    for (let i = 0; i < 2; i++) { const t = g.deck.targets[i]; s.deckDrop[i] = t.drop; s.deckDropFlash[i] = Math.min(1, t.flash / 0.15); }
    s.deckArmed = g.deck.armed ? 1 : 0; s.deckSlingFlash = Math.min(1, g.deck.slingFlash / 0.15);
    const kr = g.kraken; s.krakenShow = kr.show; s.krakenFlash = Math.min(1, kr.flash / 0.25); s.krakenX = kr.x; s.krakenY = kr.y; s.krakenDying = kr.state === 'DYING' ? 1 : 0;
    const n = Math.min(8, g.balls.length); s.ballCount = n;
    for (let i = 0; i < n; i++) { const b = g.balls[i]; s.ballX[i] = b.x; s.ballY[i] = b.y; s.ballH[i] = b.visualH; }
  }

  frame(dt) {
    const gl = this.gl, g = this.game;
    const nowMs = performance.now();
    if (this.lastMs && dt > 0) {
      const ft = Math.min(100, nowMs - this.lastMs);
      this.ftEma = this.ftEma ? this.ftEma * 0.92 + ft * 0.08 : ft;
      this.adaptT = (this.adaptT || 0) + ft;
      if (this.adaptT > 1500) {
        this.adaptT = 0; const sc = this.resScale || 1;
        if (this.ftEma > 24 && sc > 0.5) this.resScale = Math.max(0.5, sc * 0.85);
        else if (this.ftEma < 17.5 && sc < 1) this.resScale = Math.min(1, sc * 1.06);
      }
    }
    this.lastMs = nowMs;
    if (dt > 0) {
      try { g.update(dt); this.updateBallHeights(dt); }
      catch (e) { if (this.onError) this.onError(e); g.recover(); }
    }
    this.resize();
    this.applyCameraPunch();
    this.fillState();
    const rampPts0 = g.ramps.map(r => [r.pts[0], r.pts[1]]);
    const count = composeScene(this.state, this.layout, rampPts0, this.draws);
    gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // fond
    gl.disable(gl.DEPTH_TEST); gl.useProgram(this.bgP); gl.bindBuffer(gl.ARRAY_BUFFER, this.bgVbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(0); gl.enable(gl.DEPTH_TEST);
    // sol
    const cam = this.cam, fp = this.floorP;
    gl.useProgram(fp); gl.uniformMatrix4fv(fp.u.uVP, false, cam.vp);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.floorTex); gl.uniform1i(fp.u.uTex, 0);
    gl.uniform3f(fp.u.uLight, LIGHT[0], LIGHT[1], LIGHT[2]); gl.uniform3f(fp.u.uEye, cam.ex, cam.ey, cam.ez);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.floorVbo); gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 20, 12);
    gl.drawArrays(gl.TRIANGLES, 0, this.floorCount); gl.disableVertexAttribArray(0); gl.disableVertexAttribArray(2);
    // objets
    const p = this.lit, u = p.u;
    gl.useProgram(p); gl.uniformMatrix4fv(u.uVP, false, cam.vp);
    gl.uniform3f(u.uLight, LIGHT[0], LIGHT[1], LIGHT[2]); gl.uniform3f(u.uEye, cam.ex, cam.ey, cam.ez);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.logoTex); gl.uniform1i(u.uTex, 1); gl.activeTexture(gl.TEXTURE0);
    gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
    let mode = 0;
    for (let i = 0; i < count; i++) {
      const d = this.draws[i], want = !d.blend ? 0 : (d.add ? 2 : 1);
      if (want !== mode) {
        mode = want;
        if (mode === 0) { gl.disable(gl.BLEND); gl.depthMask(true); }
        else { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, mode === 1 ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE); gl.depthMask(false); }
      }
      if (this.counts[d.mesh] === 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbos[d.mesh]);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
      gl.uniformMatrix4fv(u.uModel, false, d.model); gl.uniform3f(u.uEmissive, d.er, d.eg, d.eb);
      gl.uniform1f(u.uSpec, d.spec); gl.uniform1f(u.uShine, d.shine); gl.uniform1f(u.uAlpha, d.alpha);
      gl.uniform1f(u.uEnv, d.env); gl.uniform1f(u.uTexOn, d.tex ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, this.counts[d.mesh]);
    }
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.disableVertexAttribArray(0); gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
  }
}
