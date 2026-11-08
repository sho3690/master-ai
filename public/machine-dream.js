/*!
 * machine-dream.js — 機械の夢（幾何学アニメーション Web Component）
 *
 * 使い方:
 *   <script src="machine-dream.js"></script>
 *   <machine-dream style="height:420px"></machine-dream>
 *
 * 属性（すべて省略可）:
 *   shapes       使う形のIDをカンマ区切りで指定（省略時は全16種）
 *                例: shapes="sphere,lorenz,tesseract"
 *   speed        動きの速さ（既定 1）
 *   hold         1つの形を保つ秒数（既定 5.5）
 *   points       点の数（既定は表示サイズから自動、900〜3000）
 *   hud          "name"（形の名前を左下に表示・既定）/ "none"（非表示）
 *   background   背景色（CSSの色、既定 #06070f）/ "transparent"（透過）
 *   near-color   手前の点の色（16進、既定 #ff9a7e）
 *   far-color    奥の点の色（16進、既定 #6e8cff）
 *   interactive  "false" でクリック切替と視点の傾きを無効化
 *
 * メソッド: next() / show(id) / pause() / play()
 * イベント: shapechange（detail: { id, name, spec, index }）
 * 一覧取得: customElements.get('machine-dream').shapes
 *
 * 画面外に出たときとタブが非表示のときは自動で描画を止めます。
 * OSの「視差効果を減らす」設定がオンなら動きを遅くします。
 */
(() => {
  if (typeof window === 'undefined' || customElements.get('machine-dream')) return;

  const TAU = Math.PI * 2;
  const PHI = (1 + Math.sqrt(5)) / 2;

  const rng = seed => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // 重心を原点に、最大半径を r に揃える
  const normalize = (a, r = 1) => {
    const n = a.length / 3; let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += a[i*3]; cy += a[i*3+1]; cz += a[i*3+2]; }
    cx /= n; cy /= n; cz /= n; let m = 0;
    for (let i = 0; i < n; i++) {
      a[i*3] -= cx; a[i*3+1] -= cy; a[i*3+2] -= cz;
      m = Math.max(m, Math.hypot(a[i*3], a[i*3+1], a[i*3+2]));
    }
    const k = r / (m || 1); for (let i = 0; i < a.length; i++) a[i] *= k;
    return a;
  };

  const fixed = fill => (N, H) => {
    const a = new Float32Array(N * 3);
    fill(a, N, H);
    return () => a;
  };

  const edgePoints = (V, len2, scale) => fixed((a, N) => {
    const E = [];
    for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
      const d = (V[i][0]-V[j][0])**2 + (V[i][1]-V[j][1])**2 + (V[i][2]-V[j][2])**2;
      if (Math.abs(d - len2) < 1e-6) E.push([V[i], V[j]]);
    }
    const per = N / E.length;
    for (let i = 0; i < N; i++) {
      const [A, B] = E[Math.floor(i / per) % E.length], s = (i % per) / per;
      for (let k = 0; k < 3; k++) a[i*3+k] = (A[k] + (B[k]-A[k]) * s) * scale;
    }
  });

  const SHAPES = [
    { id: 'sphere', name: '球面', spec: 'fibonacci lattice · φ = 1.618…',
      make: fixed((a, N) => {
        for (let i = 0; i < N; i++) {
          const y = 1 - 2 * (i + .5) / N, r = Math.sqrt(1 - y*y), p = i * 2.399963;
          a[i*3] = Math.cos(p) * r; a[i*3+1] = y; a[i*3+2] = Math.sin(p) * r;
        }
      }) },

    { id: 'lorenz', name: 'ローレンツ・アトラクタ', spec: 'σ=10  ρ=28  β=8/3',
      make: fixed((a, N) => {
        let x = .1, y = 0, z = 0; const dt = .005;
        const step = () => { const dx = 10*(y-x), dy = x*(28-z)-y, dz = x*y-8/3*z; x += dx*dt; y += dy*dt; z += dz*dt; };
        for (let k = 0; k < 2000; k++) step();
        for (let i = 0; i < N; i++) { for (let k = 0; k < 4; k++) step(); a[i*3] = x; a[i*3+1] = z; a[i*3+2] = y; }
        normalize(a, 1.05);
      }) },

    { id: 'tesseract', name: '四次元超立方体', spec: 'tesseract · 16 vertices · 32 edges · rot(xw, yz)',
      make: N => {
        const V = []; for (let v = 0; v < 16; v++) V.push([v&1?1:-1, v&2?1:-1, v&4?1:-1, v&8?1:-1]);
        const E = []; for (let a = 0; a < 16; a++) for (let b = a+1; b < 16; b++) { const d = a ^ b; if (!(d & (d-1))) E.push([V[a], V[b]]); }
        const out = new Float32Array(N * 3), per = N / 32;
        return t => {
          const c1 = Math.cos(t*.45), s1 = Math.sin(t*.45), c2 = Math.cos(t*.3), s2 = Math.sin(t*.3);
          for (let i = 0; i < N; i++) {
            const [A, B] = E[Math.floor(i / per) % 32], s = (i % per) / per;
            const x = A[0]+(B[0]-A[0])*s, y = A[1]+(B[1]-A[1])*s, z = A[2]+(B[2]-A[2])*s, w = A[3]+(B[3]-A[3])*s;
            const x2 = x*c1 - w*s1, w2 = x*s1 + w*c1, y2 = y*c2 - z*s2, z2 = y*s2 + z*c2, k = .95 / (2.6 - w2);
            out[i*3] = x2*k; out[i*3+1] = y2*k; out[i*3+2] = z2*k;
          }
          return out;
        };
      } },

    { id: 'torusknot', name: 'トーラス結び目', spec: 'torus knot · p=3  q=7',
      make: fixed((a, N, H) => {
        for (let i = 0; i < N; i++) {
          const s = i / N * TAU, r = .62 + .26 * Math.cos(7*s);
          a[i*3] = r*Math.cos(3*s) + (H[0][i]-.5)*.06;
          a[i*3+1] = .3*Math.sin(7*s) + (H[1][i]-.5)*.06;
          a[i*3+2] = r*Math.sin(3*s) + (H[2][i]-.5)*.06;
        }
      }) },

    { id: 'ripple', name: '干渉する格子', spec: 'y = cos(5r − ωt)·e^(−0.6r) + 第2波源',
      make: N => {
        const G = Math.floor(Math.sqrt(N)), out = new Float32Array(N * 3);
        return t => {
          for (let i = 0; i < N; i++) {
            const j = Math.min(i, G*G-1), x = (j % G / (G-1) - .5) * 2.1, z = (Math.floor(j / G) / (G-1) - .5) * 2.1;
            const r = Math.hypot(x, z), r2 = Math.hypot(x - .5, z + .4);
            out[i*3] = x; out[i*3+2] = z;
            out[i*3+1] = .2*Math.cos(5*r - 2.2*t)*Math.exp(-.6*r) + .12*Math.cos(7*r2 - 1.6*t)*Math.exp(-r2);
          }
          return out;
        };
      } },

    { id: 'torus', name: 'トーラス', spec: 'R = 0.75  r = 0.32 · 60 rings',
      make: fixed((a, N) => {
        const rings = 60, per = N / rings;
        for (let i = 0; i < N; i++) {
          const u = TAU * Math.floor(i / per) / rings, v = TAU * (i % per) / per, R = .75 + .32*Math.cos(v);
          a[i*3] = R*Math.cos(u); a[i*3+1] = .32*Math.sin(v); a[i*3+2] = R*Math.sin(u);
        }
      }) },

    { id: 'helix', name: '二重螺旋', spec: 'double helix · 4 turns · rung every 7th',
      make: (N, H) => {
        const out = new Float32Array(N * 3);
        return t => {
          for (let i = 0; i < N; i++) {
            const s = i / N;
            if (i % 7 === 0) {
              const q = Math.round(s * 48) / 48, a = q*TAU*4 + t*.5, f = H[0][i]*2 - 1;
              out[i*3] = .42*Math.cos(a)*f; out[i*3+1] = (q - .5)*2.2; out[i*3+2] = .42*Math.sin(a)*f;
            } else {
              const a = s*TAU*4 + t*.5 + (i & 1 ? Math.PI : 0);
              out[i*3] = .42*Math.cos(a); out[i*3+1] = (s - .5)*2.2; out[i*3+2] = .42*Math.sin(a);
            }
          }
          return out;
        };
      } },

    { id: 'icosahedron', name: '正二十面体', spec: 'icosahedron · 12 vertices · 30 edges',
      make: (() => {
        const V = [];
        for (const a of [-1, 1]) for (const b of [-1, 1]) V.push([0, a, b*PHI], [a, b*PHI, 0], [b*PHI, 0, a]);
        return edgePoints(V, 4, 1 / Math.hypot(1, PHI));
      })() },

    { id: 'mobius', name: 'メビウスの帯', spec: 'möbius strip · 1 face · 1 edge',
      make: fixed((a, N) => {
        const strips = 14, per = N / strips;
        for (let i = 0; i < N; i++) {
          const u = TAU * (i % per) / per, v = (Math.floor(i / per) / (strips - 1) - .5) * 1.4;
          const R = 1 + v/2 * Math.cos(u/2);
          a[i*3] = R*Math.cos(u); a[i*3+1] = v/2*Math.sin(u/2); a[i*3+2] = R*Math.sin(u);
        }
        normalize(a);
      }) },

    { id: 'klein', name: 'クラインの壺', spec: 'figure-8 immersion · a = 2',
      make: fixed((a, N) => {
        const nu = 80, nv = N / nu;
        for (let i = 0; i < N; i++) {
          const u = TAU * Math.floor(i / nv) / nu, v = TAU * (i % nv) / nv;
          const r = 2 + Math.cos(u/2)*Math.sin(v) - Math.sin(u/2)*Math.sin(2*v);
          a[i*3] = r*Math.cos(u); a[i*3+1] = Math.sin(u/2)*Math.sin(v) + Math.cos(u/2)*Math.sin(2*v); a[i*3+2] = r*Math.sin(u);
        }
        normalize(a);
      }) },

    { id: 'sierpinski', name: 'シェルピンスキー四面体', spec: 'chaos game · ratio 1/2 · dim = 2',
      make: fixed((a, N) => {
        const V = [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]], r = rng(7);
        let p = [0, 0, 0];
        for (let i = -20; i < N; i++) {
          const v = V[Math.floor(r() * 4)];
          p = [(p[0]+v[0])/2, (p[1]+v[1])/2, (p[2]+v[2])/2];
          if (i >= 0) { a[i*3] = p[0]*.62; a[i*3+1] = p[1]*.62; a[i*3+2] = p[2]*.62; }
        }
      }) },

    { id: 'crystal', name: '振動する結晶格子', spec: 'cubic lattice 7³ · phonon k = 3',
      make: (N, H) => {
        const S = 7, sites = S*S*S, out = new Float32Array(N * 3);
        return t => {
          for (let i = 0; i < N; i++) {
            const s = i % sites, ix = s % S, iy = Math.floor(s / S) % S, iz = Math.floor(s / (S*S));
            const x0 = (ix/(S-1) - .5)*1.3, y0 = (iy/(S-1) - .5)*1.3, z0 = (iz/(S-1) - .5)*1.3;
            const th = H[1][i]*TAU + t*(1 + H[0][i]), cz = H[2][i]*2 - 1, rr = Math.sqrt(1 - cz*cz) * .035;
            out[i*3] = x0 + .045*Math.sin(3*y0 - 2*t) + rr*Math.cos(th);
            out[i*3+1] = y0 + .045*Math.sin(3*z0 - 1.7*t) + cz*.035;
            out[i*3+2] = z0 + rr*Math.sin(th);
          }
          return out;
        };
      } },

    { id: 'harmonics', name: '球面調和の揺らぎ', spec: 'r = 0.62 + 0.3·cos3θ·sin(4φ + ωt)',
      make: N => {
        const th = new Float32Array(N), ph = new Float32Array(N), out = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) { const y = 1 - 2*(i+.5)/N; th[i] = Math.acos(y); ph[i] = i * 2.399963; }
        return t => {
          for (let i = 0; i < N; i++) {
            const r = .62 + .3*Math.cos(3*th[i])*Math.sin(4*ph[i] + .6*t), s = Math.sin(th[i]);
            out[i*3] = r*s*Math.cos(ph[i]); out[i*3+1] = r*Math.cos(th[i]); out[i*3+2] = r*s*Math.sin(ph[i]);
          }
          return out;
        };
      } },

    { id: 'lissajous', name: 'リサージュ曲線', spec: 'x:y:z = 3:4:5 · δ drifting',
      make: (N, H) => {
        const out = new Float32Array(N * 3);
        return t => {
          for (let i = 0; i < N; i++) {
            const s = i / N * TAU;
            out[i*3] = .9*Math.sin(3*s + .25*t) + (H[0][i]-.5)*.04;
            out[i*3+1] = .9*Math.sin(4*s) + (H[1][i]-.5)*.04;
            out[i*3+2] = .9*Math.sin(5*s + .17*t + 1) + (H[2][i]-.5)*.04;
          }
          return out;
        };
      } },

    { id: 'shell', name: '対数螺旋の貝殻', spec: 'r = e^(0.13u) · 2.5 turns',
      make: fixed((a, N) => {
        const nu = 90, nv = N / nu;
        for (let i = 0; i < N; i++) {
          const u = 5*Math.PI * Math.floor(i / nv) / nu, v = TAU * (i % nv) / nv, k = Math.exp(.13*u), R = k*(1.15 + Math.cos(v));
          a[i*3] = R*Math.cos(u); a[i*3+1] = k*Math.sin(v) - k*1.6; a[i*3+2] = R*Math.sin(u);
        }
        normalize(a);
      }) },

    { id: 'gyroid', name: 'ジャイロイド', spec: 'sin x cos y + sin y cos z + sin z cos x = 0',
      make: fixed((a, N) => {
        const r = rng(11), k = Math.PI * 1.6;
        let n = 0, tries = 0;
        while (n < N && tries < 2e6) {
          tries++;
          const x = r()*2 - 1, y = r()*2 - 1, z = r()*2 - 1;
          if (x*x + y*y + z*z > 1) continue;
          const X = x*k, Y = y*k, Z = z*k;
          if (Math.abs(Math.sin(X)*Math.cos(Y) + Math.sin(Y)*Math.cos(Z) + Math.sin(Z)*Math.cos(X)) > .07) continue;
          a[n*3] = x; a[n*3+1] = y; a[n*3+2] = z; n++;
        }
        const filled = Math.max(1, n);
        for (let j = 0; n < N; n++, j++) { const s = (j % filled) * 3; a[n*3] = a[s]; a[n*3+1] = a[s+1]; a[n*3+2] = a[s+2]; }
      }) },
  ];

  const hex = (s, fb) => {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((s || '').trim());
    if (!m) return fb;
    let h = m[1]; if (h.length === 3) h = h.replace(/./g, c => c + c);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const ease = x => x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2;
  const BANDS = 10;

  const CSS = `
    :host { display: block; position: relative; overflow: hidden; height: 360px; contain: content;
      --md-text: #dfe4f5; --md-muted: #8a93b4;
      --md-font: system-ui, sans-serif; --md-font-mono: ui-monospace, "SFMono-Regular", Menlo, monospace; }
    :host([hidden]) { display: none; }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    :host(:not([interactive="false"])) canvas { cursor: pointer; }
    .hud { position: absolute; left: 14px; right: 14px; bottom: 12px; display: grid; gap: 3px;
      pointer-events: none; transition: opacity .5s ease; }
    .hud.fade { opacity: 0; }
    .name { font: 500 13px/1.3 var(--md-font); letter-spacing: .08em; color: var(--md-text); }
    .spec { font: 11px/1.3 var(--md-font-mono); color: var(--md-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    :host([hud="none"]) .hud { display: none; }
  `;

  class MachineDream extends HTMLElement {
    static get observedAttributes() {
      return ['shapes', 'points', 'near-color', 'far-color', 'background'];
    }
    static get shapes() { return SHAPES.map(({ id, name, spec }) => ({ id, name, spec })); }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style><canvas part="canvas" role="img"></canvas>
        <div class="hud" part="hud"><div class="name"></div><div class="spec"></div></div>`;
      this._cvs = root.querySelector('canvas');
      this._ctx = this._cvs.getContext('2d');
      this._hud = root.querySelector('.hud');
      this._raf = 0; this._visible = true; this._paused = false;
      this._t = 0; this._phase = 0; this._cur = 0; this._nxt = 0; this._morph = false;
      this._tilt = [0, 0, 0, 0];
      this._frame = this._frame.bind(this);
      this._onClick = () => { if (this.getAttribute('interactive') !== 'false') this.next(); };
      this._onMove = e => {
        if (this.getAttribute('interactive') === 'false') return;
        const r = this.getBoundingClientRect();
        this._tilt[2] = ((e.clientX - r.left) / r.width - .5) * .9;
        this._tilt[3] = ((e.clientY - r.top) / r.height - .5) * .5;
      };
      this._onLeave = () => { this._tilt[2] = 0; this._tilt[3] = 0; };
    }

    connectedCallback() {
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this);
      this._io = new IntersectionObserver(es => { this._visible = es[0].isIntersecting; this._loop(); });
      this._io.observe(this);
      this._onVis = () => this._loop();
      document.addEventListener('visibilitychange', this._onVis);
      this._cvs.addEventListener('click', this._onClick);
      this.addEventListener('pointermove', this._onMove);
      this.addEventListener('pointerleave', this._onLeave);
      this._resize();
      this._setup();
      this._loop();
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf); this._raf = 0;
      this._ro && this._ro.disconnect(); this._io && this._io.disconnect();
      document.removeEventListener('visibilitychange', this._onVis);
      this._cvs.removeEventListener('click', this._onClick);
      this.removeEventListener('pointermove', this._onMove);
      this.removeEventListener('pointerleave', this._onLeave);
    }

    attributeChangedCallback(name) {
      if (!this.isConnected || !this._list) return;
      if (name === 'shapes' || name === 'points') this._setup();
      else if (name === 'background') this._clear();
      else this._colors();
    }

    // ---- public API
    next() { if (this._list && !this._morph) this._go((this._cur + 1) % this._list.length); }
    show(id) {
      if (!this._list) return;
      const k = this._list.findIndex(s => s.id === id);
      if (k >= 0 && k !== this._cur && !this._morph) this._go(k);
    }
    pause() { this._paused = true; }
    play() { this._paused = false; this._last = performance.now(); this._loop(); }
    get current() { const s = this._list && this._list[this._morph ? this._nxt : this._cur]; return s ? { id: s.id, name: s.name, spec: s.spec } : null; }

    // ---- internals
    _setup() {
      const want = (this.getAttribute('shapes') || '').split(',').map(s => s.trim()).filter(Boolean);
      this._list = want.length ? want.map(id => SHAPES.find(s => s.id === id)).filter(Boolean) : SHAPES.slice();
      if (!this._list.length) this._list = SHAPES.slice();
      const area = Math.max(1, this._w * this._h);
      const N = parseInt(this.getAttribute('points'), 10) || Math.round(Math.min(3000, Math.max(900, area / 160)));
      this._N = N;
      const h = seed => { const a = new Float32Array(N); for (let i = 0; i < N; i++) { const s = Math.sin(i * 127.1 + seed) * 43758.5453; a[i] = s - Math.floor(s); } return a; };
      this._H = [h(311.7), h(74.7), h(19.19)];
      this._fns = new Map();
      this._sx = new Float32Array(N); this._sy = new Float32Array(N); this._ss = new Float32Array(N); this._sb = new Uint8Array(N);
      this._cur = 0; this._morph = false; this._phase = 0;
      this._colors();
      this._label(this._list[0], true);
    }

    _pos(shape) {
      let f = this._fns.get(shape.id);
      if (!f) { f = shape.make(this._N, this._H); this._fns.set(shape.id, f); }
      return f(this._t);
    }

    _colors() {
      const near = hex(this.getAttribute('near-color'), [255, 154, 126]);
      const far = hex(this.getAttribute('far-color'), [110, 140, 255]);
      this._band = [];
      for (let b = 0; b < BANDS; b++) {
        const k = b / (BANDS - 1), c = far.map((v, j) => Math.round(v + (near[j] - v) * k));
        this._band.push(`rgba(${c[0]},${c[1]},${c[2]},${(.35 + .55*k).toFixed(2)})`);
      }
    }

    _label(s, now) {
      const set = () => {
        this._hud.querySelector('.name').textContent = s.name;
        this._hud.querySelector('.spec').textContent = s.spec;
        this._cvs.setAttribute('aria-label', `幾何学アニメーション: ${s.name}`);
        this._hud.classList.remove('fade');
      };
      if (now) return set();
      this._hud.classList.add('fade');
      clearTimeout(this._lt); this._lt = setTimeout(set, 450);
    }

    _go(k) {
      this._nxt = k; this._morph = true; this._phase = 0;
      const s = this._list[k];
      this._label(s);
      this.dispatchEvent(new CustomEvent('shapechange', { detail: { id: s.id, name: s.name, spec: s.spec, index: k }, bubbles: true }));
    }

    _resize() {
      const r = this.getBoundingClientRect();
      this._w = Math.max(1, r.width); this._h = Math.max(1, r.height);
      this._dpr = Math.min(window.devicePixelRatio || 1, 2);
      this._cvs.width = Math.round(this._w * this._dpr); this._cvs.height = Math.round(this._h * this._dpr);
      this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      this._clear();
    }

    _clear() {
      const ctx = this._ctx, bg = this.getAttribute('background') || '#06070f';
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      if (bg === 'transparent') ctx.clearRect(0, 0, this._w, this._h);
      else { ctx.fillStyle = bg; ctx.fillRect(0, 0, this._w, this._h); }
    }

    _loop() {
      const run = this.isConnected && this._visible && !document.hidden;
      if (run && !this._raf) { this._last = performance.now(); this._raf = requestAnimationFrame(this._frame); }
      else if (!run && this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    }

    _frame(now) {
      this._raf = 0;
      if (!this._list) return;
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const speed = (parseFloat(this.getAttribute('speed')) || 1) * (reduce ? .35 : 1);
      const hold = parseFloat(this.getAttribute('hold')) || 5.5, MORPH = 3.4;
      const dt = Math.min((now - this._last) / 1000, .05); this._last = now;
      if (!this._paused) { this._t += dt * speed; this._phase += dt * speed; }

      if (!this._morph && this._phase > hold && this._list.length > 1) this._go((this._cur + 1) % this._list.length);
      let p = 0;
      if (this._morph) {
        p = Math.min(this._phase / MORPH, 1);
        if (p >= 1) { this._cur = this._nxt; this._morph = false; this._phase = 0; p = 0; }
      }

      const ctx = this._ctx, W = this._w, H = this._h, N = this._N, fade = reduce ? .45 : .2;
      const bg = this.getAttribute('background') || '#06070f';
      if (bg === 'transparent') {
        ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = fade; ctx.fillStyle = '#000';
      } else {
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = fade; ctx.fillStyle = bg;
      }
      ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;

      const A = this._pos(this._list[this._cur]), B = this._morph ? this._pos(this._list[this._nxt]) : null;
      const [h1, h2, h3] = this._H, tl = this._tilt, t = this._t;
      tl[0] += (tl[2] - tl[0]) * .04; tl[1] += (tl[3] - tl[1]) * .04;
      const yaw = t*.16 + tl[0], pitch = .38 + Math.sin(t*.11)*.18 + tl[1];
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const scale = Math.min(W, H) * .34, ox = W / 2, oy = H / 2, br = 1 + Math.sin(t*.7)*.015;
      const sx = this._sx, syA = this._sy, ss = this._ss, sb = this._sb;

      for (let i = 0; i < N; i++) {
        const o = i * 3;
        let x = A[o], y = A[o+1], z = A[o+2];
        if (B) {
          const lp = ease(Math.min(Math.max(p*1.5 - h1[i]*.5, 0), 1)), sw = Math.sin(lp*Math.PI) * .45;
          x += (B[o] - x)*lp + (h2[i] - .5)*sw;
          y += (B[o+1] - y)*lp + (h3[i] - .5)*sw;
          z += (B[o+2] - z)*lp + (h1[i] - .5)*sw;
        }
        x = (x + Math.sin(t*1.3 + h1[i]*TAU)*.004) * br;
        y = (y + Math.cos(t*1.1 + h2[i]*TAU)*.004) * br;
        z *= br;
        const x1 = x*cy - z*sy, z1 = x*sy + z*cy, y2 = y*cp - z1*sp, z2 = y*sp + z1*cp;
        const k = 2.8 / (2.8 + z2);
        sx[i] = ox + x1*scale*k; syA[i] = oy + y2*scale*k;
        ss[i] = (.7 + (1 - z2)*.55) * k * 1.6;
        sb[i] = Math.max(0, Math.min(BANDS - 1, Math.round((1 - (z2 + 1.1) / 2.2) * (BANDS - 1))));
      }

      ctx.globalCompositeOperation = 'lighter';
      for (let b = 0; b < BANDS; b++) {
        ctx.fillStyle = this._band[b];
        for (let i = 0; i < N; i++) {
          if (sb[i] !== b) continue;
          const s = ss[i]; ctx.fillRect(sx[i] - s/2, syA[i] - s/2, s, s);
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      this._loop();
      if (!this._raf && this.isConnected && this._visible && !document.hidden) this._raf = requestAnimationFrame(this._frame);
    }
  }

  customElements.define('machine-dream', MachineDream);
})();
