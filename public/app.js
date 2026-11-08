// マスターAI — 議論の進行役（ブラウザ側）
// サーバー（npm start）があればそれ経由で、なければ（GitHub Pages など）ブラウザから各社APIを直接呼ぶ
import { DEFAULT_MODELS, streamProvider } from './providers.js';

// 議論に参加する3つの席。席ごとに図形の形と色が決まっている
const SEAT_STYLE = [
  { shape: 'icosahedron', near: '#8ff5d2', far: '#2b8a73' },
  { shape: 'torusknot', near: '#ffb995', far: '#b8542f' },
  { shape: 'lissajous', near: '#b3c8ff', far: '#6a4bff' },
];
const MASTER = { name: 'Master AI', near: '#ff9a7e', far: '#6e8cff' };
const PROVIDERS = ['openrouter', 'openai', 'claude', 'gemini'];
const PROVIDER_LABEL = { openrouter: 'OpenRouter', openai: 'OpenAI', claude: 'Anthropic', gemini: 'Google', '': '使わない' };
const OFFICIAL_NAME = { openai: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' };

const $ = s => document.querySelector(s);
const orb = $('#orb'), thread = $('#thread'), form = $('#composer'), input = $('#q'), send = $('#send'), statusEl = $('#status');

let mode = null;      // 'server' | 'browser'
let server = null;    // サーバーの /api/config
let settings = null;  // { keys, seats: [{ provider, model, name }], master, rounds }
let controller = null;
let pending = null;   // 設定後に始める質問
const history = [];   // { q, conclusion }

// ---------------------------------------------------------------- 幾何学の姿
let wanted = null;
function become(shape, { near, far }) {
  orb.setAttribute('near-color', near);
  orb.setAttribute('far-color', far);
  wanted = shape;
  const attempt = () => {
    if (wanted !== shape || orb.current?.id === shape) return;
    if (orb._morph) return setTimeout(attempt, 250); // 変形中は終わるのを待つ
    orb.show(shape);
  };
  attempt();
}
const holdShape = on => on ? orb.setAttribute('hold', '100000') : orb.removeAttribute('hold');

function setStatus(text, color) {
  statusEl.textContent = text || '';
  statusEl.style.setProperty('--status', color || MASTER.near);
}

// ---------------------------------------------------------------- Markdown（最小限・HTMLは常にエスケープ）
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inline = s => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');

function markdown(src) {
  const L = src.replace(/\r/g, '').split('\n'), out = [];
  const isBlock = l => /^(```|#{1,6}\s|\s*([-*+・]|\d+[.)])\s|\|)/.test(l);
  for (let i = 0; i < L.length;) {
    const l = L[i];
    let m;
    if (/^```/.test(l)) {
      const buf = []; i++;
      while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]);
      i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) {
      const n = Math.min(m[1].length + 2, 5); out.push(`<h${n}>${inline(m[2])}</h${n}>`); i++;
    } else if (/^\s*([-*+・])\s+/.test(l)) {
      const items = [];
      while (i < L.length && /^\s*([-*+・])\s+/.test(L[i])) items.push(L[i++].replace(/^\s*([-*+・])\s+/, ''));
      out.push(`<ul>${items.map(t => `<li>${inline(t)}</li>`).join('')}</ul>`);
    } else if (/^\s*\d+[.)]\s+/.test(l)) {
      const items = [];
      while (i < L.length && /^\s*\d+[.)]\s+/.test(L[i])) items.push(L[i++].replace(/^\s*\d+[.)]\s+/, ''));
      out.push(`<ol>${items.map(t => `<li>${inline(t)}</li>`).join('')}</ol>`);
    } else if (/^\|/.test(l)) {
      const rows = [];
      while (i < L.length && /^\|/.test(L[i])) rows.push(L[i++]);
      const cells = r => r.replace(/^\||\|\s*$/g, '').split('|').map(c => inline(c.trim()));
      const body = rows.filter(r => !/^\|[\s:|-]+\|?\s*$/.test(r));
      const [head, ...rest] = body;
      out.push(`<table><thead><tr>${cells(head || '').map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rest.map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (!l.trim()) {
      i++;
    } else {
      const buf = [];
      while (i < L.length && L[i].trim() && !(buf.length && isBlock(L[i]))) buf.push(L[i++]);
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------- 表示
const nearBottom = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 160;
const follow = fn => { const stick = nearBottom(); fn(); if (stick) scrollTo({ top: document.documentElement.scrollHeight }); };

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

function addRound(session, label) { follow(() => session.append(el('div', 'round', label))); }

function addTurn(session, { name, model, color, conclusion }) {
  const art = el('article', 'turn streaming' + (conclusion ? ' conclusion' : ''));
  art.style.setProperty('--c', color);
  const head = el('header');
  head.append(el('span', 'who', name));
  if (model) head.append(el('span', 'model', model));
  const body = el('div', 'body');
  art.append(head, body);
  follow(() => session.append(art));
  let text = '', queued = false;
  return {
    get text() { return text; },
    note(msg) { if (!text) body.innerHTML = `<span class="note">${esc(msg)}</span>`; },
    push(t) {
      text += t;
      if (queued) return; queued = true;
      requestAnimationFrame(() => { queued = false; follow(() => { body.innerHTML = markdown(text); }); });
    },
    end(state, msg) {
      art.classList.remove('streaming');
      if (state) art.classList.add(state);
      if (state === 'error') body.textContent = msg;
      else body.innerHTML = markdown(text);
    },
  };
}


// ---------------------------------------------------------------- 設定
const STORE = 'master-ai.settings';

function freshSeats() {
  const official = mode === 'server' ? ['openai', 'claude', 'gemini'].filter(p => server.providers[p]?.enabled) : [];
  if (official.length >= 2 && !(mode === 'server' && server.providers.openrouter?.enabled)) return official.map(provider => ({ provider, model: '', name: '' }));
  return [0, 1, 2].map(() => ({ provider: 'openrouter', model: '', name: '' }));
}

function loadSettings() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORE)); } catch {}
  let s = raw || {};
  if (raw && !raw.seats) { // 旧形式（ChatGPT・Claude・Gemini 固定）からの移行
    const keys = {}, seats = [];
    for (const p of ['openai', 'claude', 'gemini']) {
      if (!raw[p]) continue;
      keys[p] = raw[p].key || '';
      if (raw[p].key) seats.push({ provider: p, model: raw[p].model || '', name: '' });
    }
    s = { keys, seats, master: Math.max(0, seats.findIndex(x => x.provider === raw.master)), rounds: raw.rounds };
  }
  const seats = Array.isArray(s.seats) && s.seats.length ? s.seats.slice(0, 3) : freshSeats();
  while (seats.length < 3) seats.push({ provider: '', model: '', name: '' });
  return {
    keys: s.keys || {},
    seats,
    master: Number.isInteger(s.master) ? s.master : 0,
    rounds: Number.isInteger(s.rounds) ? s.rounds : 1,
  };
}

const saveSettings = () => { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch {} };

const hasKey = p => mode === 'server' ? Boolean(server.providers[p]?.enabled) : Boolean(settings.keys[p]);
const modelOf = seat => seat.model || (seat.provider && seat.provider !== 'openrouter'
  ? (mode === 'server' ? server.providers[seat.provider]?.model : DEFAULT_MODELS[seat.provider]) : '');
const shortName = id => id.split('/').pop().replace(/:free$/, '');

function activeSeats() {
  const seats = settings.seats
    .map((s, i) => ({ ...s, i, model: modelOf(s), style: SEAT_STYLE[i] }))
    .filter(s => s.provider && hasKey(s.provider) && s.model)
    .map(s => ({ ...s, name: s.name || OFFICIAL_NAME[s.provider] || shortName(s.model) }));
  const seen = {};
  for (const s of seats) seen[s.name] = (seen[s.name] || 0) + 1;
  for (const s of seats) if (seen[s.name] > 1) s.name += ` #${s.i + 1}`;
  return seats;
}

// ---------------------------------------------------------------- API
async function* viaServer(seat, system, prompt, signal) {
  const res = await fetch('api/turn', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: seat.provider, model: seat.model, system, prompt }),
  });
  if (!res.ok) throw new Error(`サーバーエラー (${res.status})`);
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(msg.error);
      if (msg.t) yield msg.t;
    }
  }
}

const source = (seat, system, prompt, signal) => mode === 'server'
  ? viaServer(seat, system, prompt, signal)
  : streamProvider(seat.provider, { key: settings.keys[seat.provider], model: seat.model }, system, prompt, signal);

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
});

// 混雑（429・5xx・空応答）は、まだ何も話していなければ少し待って自動で再試行する
const RETRY_DELAYS = [3000, 8000];

async function speak(seat, system, prompt, view, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      for await (const t of source(seat, system, prompt, signal)) view.push(t);
      if (!view.text.trim()) throw new Error('応答が空でした');
      view.end();
      return view.text.trim();
    } catch (e) {
      if (signal.aborted) { view.end('aborted'); return null; }
      const msg = e.message || String(e);
      const daily = /per-day|per day/i.test(msg);
      const busy = !daily && (/^(408|429|5\d\d)\b/.test(msg) || /rate.?limit|overloaded|temporarily|Provider returned error|応答が空/i.test(msg));
      if (busy && !view.text && attempt < RETRY_DELAYS.length) {
        view.note(`混雑しているため再試行しています（${attempt + 2}/${RETRY_DELAYS.length + 1}回目）`);
        try { await wait(RETRY_DELAYS[attempt], signal); } catch { view.end('aborted'); return null; }
        continue;
      }
      const hint = daily ? '今日の無料枠を使い切りました。明日になるか、OpenRouter で10ドル分のクレジットを購入すると回数が増えます。'
        : busy ? 'このモデルが混雑しています。少し時間をおくか、質問欄に「/key」と入力して別のモデルに替えてください。'
        : '質問欄に「/key」と入力すると設定を変えられます。';
      view.end('error', `${seat.name} に接続できませんでした — ${msg}\n${hint}`);
      return null;
    }
  }
}

// ---------------------------------------------------------------- プロンプト
const participantSystem = (seat, members) => {
  const others = members.filter(m => m !== seat).map(m => m.name).join('、');
  return [
    `あなたは「${seat.name}」として、マスターAIが進行する議論に参加しています。${others ? `ほかの参加者は ${others} です。` : ''}`,
    '- 日本語で、率直かつ具体的に話してください。前置きや決まり文句は不要です。',
    '- 他の参加者の発言は名前を挙げて参照し、同意・反論・補足をはっきり示してください。',
    '- 迎合せず、根拠のある異論は遠慮なく述べてください。',
    '- 不確かな事実は不確かだと明示してください。',
  ].join('\n');
};

const masterSystem = members => [
  `あなたはマスターAIです。${members.map(m => m.name).join('・')} による議論を統括し、ユーザーに最終結論を示します。`,
  '- 議論の多数派に流されず、根拠の強さで判断してください。',
  '- 日本語で、結論を曖昧にせず簡潔に書いてください。',
].join('\n');

const contextBlock = () => history.length
  ? `【これまでのやり取り】\n${history.slice(-3).map(h => `Q: ${h.q}\n結論: ${h.conclusion}`).join('\n\n')}\n\n`
  : '';

const transcriptText = log => log.map(e => `[${e.name}]\n${e.text}`).join('\n\n');

const openingPrompt = q => `${contextBlock()}【質問】\n${q}\n\nまずは他の参加者の意見を見ずに、あなた自身の見解を述べてください。要点を絞って400字以内で。`;

const debatePrompt = (q, log, round, last) => `${contextBlock()}【質問】\n${q}\n\n【これまでの議論】\n${transcriptText(log)}\n\n` +
  `議論の第${round + 1}ラウンドです。他の参加者の意見を踏まえ、同意できる点・反論・見落とされている点を挙げ、必要なら自分の立場を更新してください。` +
  `${last ? 'これがあなたの最終発言です。最終的な立場を明確にしてください。' : '結論に向けて論点を絞ってください。'}300字以内で。`;

const conclusionPrompt = (q, log) => `${contextBlock()}【質問】\n${q}\n\n【議論の記録】\n${transcriptText(log)}\n\n` +
  '以上を踏まえ、次の形式で最終結論を出してください。\n\n## 結論\n（1〜3文。どの立場を採るか明確に）\n\n## 根拠\n（重要な根拠を箇条書きで。誰の指摘かを添える）\n\n## 残る相違点\n（意見が割れたまま残った点。なければ「なし」）';

// ---------------------------------------------------------------- 議論の進行
async function discuss(q) {
  const members = activeSeats();
  const signal = controller.signal;

  document.body.classList.replace('idle', 'active');
  const session = el('section', 'session');
  session.append(el('h2', 'question', q));
  thread.append(session);
  requestAnimationFrame(() => session.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  if (!members.length) {
    session.append(el('p', 'notice', '議論に参加するAIが設定されていません。質問欄に「/key」と入力して設定してください。'));
    return;
  }

  holdShape(true);
  const log = [];
  const turnOf = seat => addTurn(session, { name: seat.name, model: seat.model, color: seat.style.near });

  // 1. それぞれの見解（同時に考える）
  addRound(session, 'それぞれの見解');
  become('tesseract', MASTER);
  setStatus(`${members.map(m => m.name).join('・')} が考えています`);
  const views = members.map(turnOf);
  const first = await Promise.all(members.map((m, k) => speak(m, participantSystem(m, members), openingPrompt(q), views[k], signal)));
  let alive = members.filter((m, k) => first[k]);
  members.forEach((m, k) => first[k] && log.push({ name: m.name, text: first[k] }));
  if (signal.aborted) return;

  // 2. 議論（順番に発言）
  for (let r = 0; r < settings.rounds && alive.length > 1; r++) {
    addRound(session, `議論 ${r + 1}`);
    for (const m of [...alive]) {
      if (signal.aborted) return;
      become(m.style.shape, m.style);
      setStatus(`${m.name} が発言しています`, m.style.near);
      const text = await speak(m, participantSystem(m, alive), debatePrompt(q, log, r, r === settings.rounds - 1), turnOf(m), signal);
      if (text) log.push({ name: m.name, text });
      else alive = alive.filter(x => x !== m);
    }
  }
  if (signal.aborted || !log.length) return;

  // 3. 結論（まとめ役の席が使えなければ、議論に残った席が代わりにまとめる）
  const master = members.find(m => m.i === settings.master && alive.includes(m)) || alive[0] || members[0];
  addRound(session, '結論');
  become('sphere', MASTER);
  setStatus('マスターAIが結論をまとめています');
  const view = addTurn(session, { name: MASTER.name, model: `via ${master.name}`, color: MASTER.near, conclusion: true });
  const conclusion = await speak(master, masterSystem(members), conclusionPrompt(q, log), view, signal);
  if (conclusion) history.push({ q, conclusion });
}

async function start(q) {
  controller = new AbortController();
  document.body.classList.add('running');
  send.disabled = false;
  send.setAttribute('aria-label', '停止');
  try {
    await discuss(q);
  } finally {
    controller = null;
    document.body.classList.remove('running');
    send.setAttribute('aria-label', '送信');
    send.disabled = !input.value.trim();
    setStatus('');
    holdShape(false);
    become('sphere', MASTER);
  }
}

// ---------------------------------------------------------------- 入力
const fit = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; };

input.addEventListener('input', () => { fit(); if (!controller) send.disabled = !input.value.trim(); });
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); form.requestSubmit(); }
});

form.addEventListener('submit', e => {
  e.preventDefault();
  if (controller) { controller.abort(); return; }
  const q = input.value.trim();
  if (!q || !settings) return;
  input.value = ''; fit(); send.disabled = true;
  if (/^\/(key|keys|設定)$/i.test(q)) return openSettings();
  if (activeSeats().length === 0) { pending = q; return openSettings(); }
  start(q);
});

// 会話をリセット: 議論を止め、ログと文脈を消してトップの状態に戻す
$('#reset').addEventListener('click', () => {
  controller?.abort();
  pending = null;
  history.length = 0;
  thread.replaceChildren();
  scrollTo(0, 0);
  document.body.classList.replace('active', 'idle');
  setStatus('');
  holdShape(false);
  become('sphere', MASTER);
  input.focus();
});

// ---------------------------------------------------------------- OpenRouter のモデル一覧
let models = null, modelsLoading = null;
function loadModels() {
  if (models) return Promise.resolve(models);
  return modelsLoading ||= fetch('https://openrouter.ai/api/v1/models')
    .then(r => r.json())
    .then(j => {
      models = (j.data || []).map(m => ({
        id: m.id,
        full: m.name || m.id,
        name: (m.name || m.id).replace(/^[^:]+:\s*/, '').replace(/\s*\(free\)\s*$/i, ''),
        created: m.created || 0,
        open: Boolean(m.hugging_face_id),
        free: m.id.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0),
        pin: Number(m.pricing?.prompt) * 1e6, pout: Number(m.pricing?.completion) * 1e6,
      })).sort((a, b) => b.created - a.created);
      // 「:free」版にはHugging FaceのIDが付いていないことがあるので、元のモデルがオープンウェイトなら同じ扱いにする
      const openBase = new Set(models.filter(m => m.open).map(m => m.id.replace(/:free$/, '')));
      for (const m of models) if (!m.open && openBase.has(m.id.replace(/:free$/, ''))) m.open = true;
      models.anyOpen = models.some(m => m.open);
      return models;
    })
    .catch(() => { modelsLoading = null; return []; });
}

const money = n => '$' + (n < 10 ? n.toFixed(2) : n.toFixed(1));
const priceText = m => m.free ? '無料' : Number.isFinite(m.pin) ? `${money(m.pin)} / ${money(m.pout)}` : '';

function candidates() {
  const f = settingsForm.elements;
  return (models || []).filter(m => (!f['open-only'].checked || !models.anyOpen || m.open) && (!f['free-only'].checked || m.free));
}

function search(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return candidates().filter(m => words.every(w => `${m.id} ${m.full}`.toLowerCase().includes(w))).slice(0, 40);
}

// おまかせ: DeepSeek・Qwen・その他の系統から新しくて大きめのモデルを1つずつ
function autoPick() {
  const big = m => {
    if (/(vl|vision|coder|embed|guard|distill|tiny|mini|nano|small|audio|ocr)/i.test(m.id)) return false;
    const size = /(\d+(?:\.\d+)?)b\b/i.exec(m.id);
    return !size || Number(size[1]) >= 30;
  };
  const pool = candidates().filter(big), picked = [];
  for (const family of [/deepseek/i, /qwen/i, /llama|gpt-oss|mistral|kimi|glm|gemma/i]) {
    const m = pool.find(x => family.test(x.id) && !picked.includes(x));
    if (m) picked.push(m);
  }
  for (const m of pool) if (picked.length < 3 && !picked.includes(m)) picked.push(m);
  return picked;
}

// ---------------------------------------------------------------- 設定画面
const dialog = $('#settings'), settingsForm = $('#settings-form'), seatsEl = $('#seats');

SEAT_STYLE.forEach((style, i) => {
  const row = el('div', 'seat');
  row.style.setProperty('--c', style.near);
  row.innerHTML = `<span class="seat-no">${i + 1}</span>
    <select name="seat${i}-provider" aria-label="${i + 1}番目のAIの接続先">${['openrouter', 'openai', 'claude', 'gemini', ''].map(p => `<option value="${p}">${PROVIDER_LABEL[p]}</option>`).join('')}</select>
    <div class="seat-model">
      <input name="seat${i}-model" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${i + 1}番目のAIのモデル">
      <div class="picker" role="listbox" hidden></div>
    </div>`;
  seatsEl.append(row);
  const sel = row.querySelector('select'), inp = row.querySelector('input'), picker = row.querySelector('.picker');

  const show = async () => {
    for (const other of seatsEl.querySelectorAll('.picker')) if (other !== picker) other.hidden = true;
    if (sel.value !== 'openrouter') { picker.hidden = true; return; }
    await loadModels();
    const list = search(inp.value);
    picker.innerHTML = list.length
      ? list.map(m => `<button type="button" class="opt" data-id="${esc(m.id)}"><span>${esc(m.full)}</span><small>${priceText(m)}</small></button>`).join('')
      : `<p class="empty">${models?.length ? '見つかりません' : 'モデル一覧を読み込めませんでした。モデルIDを直接入力してください'}</p>`;
    picker.hidden = false;
  };
  const sync = () => {
    inp.disabled = !sel.value;
    inp.placeholder = sel.value === 'openrouter' ? 'タップしてモデルを検索' : sel.value ? DEFAULT_MODELS[sel.value] : '';
    if (!sel.value) inp.value = '';
  };
  row.sync = sync;
  sel.addEventListener('change', () => { if (sel.value !== 'openrouter' && inp.value.includes('/')) inp.value = ''; sync(); picker.hidden = true; });
  inp.addEventListener('focus', show);
  inp.addEventListener('input', show);
  inp.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || picker.hidden) return;
    const first = picker.querySelector('.opt');
    if (first) { e.preventDefault(); first.click(); }
  });
  picker.addEventListener('click', e => {
    const opt = e.target.closest('.opt');
    if (!opt) return;
    inp.value = opt.dataset.id;
    picker.hidden = true;
  });
});

// 候補リストの外をタップしたり別の欄に移ったら閉じる（タップが効いた後に閉じるので、表示がずれて押し間違えない）
const closePickers = e => {
  for (const box of seatsEl.querySelectorAll('.seat-model')) if (!box.contains(e.target)) box.querySelector('.picker').hidden = true;
};
settingsForm.addEventListener('click', closePickers);

$('#auto-pick').addEventListener('click', async e => {
  const btn = e.currentTarget;
  btn.disabled = true;
  await loadModels();
  const picks = autoPick();
  picks.forEach((m, i) => {
    settingsForm.elements[`seat${i}-provider`].value = 'openrouter';
    settingsForm.elements[`seat${i}-model`].value = m.id;
  });
  seatsEl.querySelectorAll('.seat').forEach(row => row.sync());
  btn.disabled = false;
  if (!picks.length) setStatus('モデル一覧を読み込めませんでした');
});

function openSettings() {
  const f = settingsForm.elements;
  $('#keys-section').hidden = mode === 'server';
  for (const p of PROVIDERS) if (f[`key-${p}`]) f[`key-${p}`].value = settings.keys[p] || '';
  settings.seats.forEach((s, i) => {
    f[`seat${i}-provider`].value = s.provider;
    f[`seat${i}-model`].value = s.model;
    if (mode === 'server') for (const o of f[`seat${i}-provider`].options) o.disabled = Boolean(o.value) && !server.providers[o.value]?.enabled;
  });
  seatsEl.querySelectorAll('.seat').forEach(row => row.sync());
  f.master.value = String(settings.master);
  f.rounds.value = String(settings.rounds);
  dialog.showModal();
  loadModels();
}

settingsForm.addEventListener('submit', e => {
  const action = e.submitter?.value;
  if (action === 'cancel') { pending = null; return; }
  if (action === 'clear') {
    try { localStorage.removeItem(STORE); } catch {}
    settings = loadSettings(); pending = null; return;
  }
  const f = settingsForm.elements;
  if (mode !== 'server') for (const p of PROVIDERS) settings.keys[p] = f[`key-${p}`].value.trim();
  const fallback = autoPick();
  settings.seats = SEAT_STYLE.map((_, i) => {
    const provider = f[`seat${i}-provider`].value;
    let model = provider ? f[`seat${i}-model`].value.trim() : '';
    if (provider === 'openrouter' && !model) model = fallback.find(m => !SEAT_STYLE.some((_, j) => f[`seat${j}-model`].value.trim() === m.id))?.id || '';
    if (provider === 'openrouter' && model) f[`seat${i}-model`].value = model;
    const name = provider === 'openrouter' ? (models?.find(m => m.id === model)?.name || shortName(model)) : '';
    return { provider, model, name };
  });
  settings.master = Number(f.master.value);
  settings.rounds = Number(f.rounds.value);
  saveSettings();
  if (pending && activeSeats().length) { const q = pending; pending = null; start(q); }
});
dialog.addEventListener('close', () => { if (!controller) input.focus(); });

// ---------------------------------------------------------------- 起動
(async () => {
  try {
    const res = await fetch('api/config');
    if (!res.ok) throw new Error();
    server = await res.json();
    mode = 'server';
  } catch {
    mode = 'browser';
  }
  settings = loadSettings();
  input.focus();
})();
