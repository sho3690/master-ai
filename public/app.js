// マスターAI — 議論の進行役（ブラウザ側）
// サーバー（npm start）があればそれ経由で、なければ（GitHub Pages など）ブラウザから各社APIを直接呼ぶ
import { DEFAULT_MODELS, streamProvider } from './providers.js';

const AI = {
  openai: { name: 'ChatGPT', shape: 'icosahedron', near: '#8ff5d2', far: '#2b8a73' },
  claude: { name: 'Claude', shape: 'torusknot', near: '#ffb995', far: '#b8542f' },
  gemini: { name: 'Gemini', shape: 'lissajous', near: '#b3c8ff', far: '#6a4bff' },
};
const MASTER = { name: 'Master AI', near: '#ff9a7e', far: '#6e8cff' };

const $ = s => document.querySelector(s);
const orb = $('#orb'), thread = $('#thread'), form = $('#composer'), input = $('#q'), send = $('#send'), statusEl = $('#status');

let config = null;
let controller = null;
let pending = null; // キー設定後に始める質問
const history = []; // { q, conclusion }

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

// ---------------------------------------------------------------- API
async function* viaServer(provider, system, prompt, signal) {
  const res = await fetch('api/turn', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, system, prompt }),
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

const source = (provider, system, prompt, signal) => config.mode === 'server'
  ? viaServer(provider, system, prompt, signal)
  : streamProvider(provider, config.providers[provider], system, prompt, signal);

async function speak(provider, system, prompt, view, signal) {
  try {
    for await (const t of source(provider, system, prompt, signal)) view.push(t);
    if (!view.text.trim()) throw new Error('応答が空でした');
    view.end();
    return view.text.trim();
  } catch (e) {
    if (signal.aborted) { view.end('aborted'); return null; }
    const hint = config.mode === 'browser' ? '（「/key」と入力するとキーを設定し直せます）' : '';
    view.end('error', `${AI[provider].name} に接続できませんでした — ${e.message}${hint}`);
    return null;
  }
}

// ---------------------------------------------------------------- プロンプト
const participantSystem = (id, members) => {
  const others = members.filter(m => m !== id).map(m => AI[m].name).join('、');
  return [
    `あなたは「${AI[id].name}」として、マスターAIが進行する議論に参加しています。${others ? `ほかの参加者は ${others} です。` : ''}`,
    '- 日本語で、率直かつ具体的に話してください。前置きや決まり文句は不要です。',
    '- 他の参加者の発言は名前を挙げて参照し、同意・反論・補足をはっきり示してください。',
    '- 迎合せず、根拠のある異論は遠慮なく述べてください。',
    '- 不確かな事実は不確かだと明示してください。',
  ].join('\n');
};

const MASTER_SYSTEM = [
  'あなたはマスターAIです。ChatGPT・Claude・Gemini による議論を統括し、ユーザーに最終結論を示します。',
  '- 議論の多数派に流されず、根拠の強さで判断してください。',
  '- 日本語で、結論を曖昧にせず簡潔に書いてください。',
].join('\n');

const contextBlock = () => history.length
  ? `【これまでのやり取り】\n${history.slice(-3).map(h => `Q: ${h.q}\n結論: ${h.conclusion}`).join('\n\n')}\n\n`
  : '';

const transcriptText = log => log.map(e => `[${AI[e.id].name}]\n${e.text}`).join('\n\n');

const openingPrompt = q => `${contextBlock()}【質問】\n${q}\n\nまずは他の参加者の意見を見ずに、あなた自身の見解を述べてください。要点を絞って400字以内で。`;

const debatePrompt = (q, log, round, last) => `${contextBlock()}【質問】\n${q}\n\n【これまでの議論】\n${transcriptText(log)}\n\n` +
  `議論の第${round + 1}ラウンドです。他の参加者の意見を踏まえ、同意できる点・反論・見落とされている点を挙げ、必要なら自分の立場を更新してください。` +
  `${last ? 'これがあなたの最終発言です。最終的な立場を明確にしてください。' : '結論に向けて論点を絞ってください。'}300字以内で。`;

const conclusionPrompt = (q, log) => `${contextBlock()}【質問】\n${q}\n\n【議論の記録】\n${transcriptText(log)}\n\n` +
  '以上を踏まえ、次の形式で最終結論を出してください。\n\n## 結論\n（1〜3文。どの立場を採るか明確に）\n\n## 根拠\n（重要な根拠を箇条書きで。誰の指摘かを添える）\n\n## 残る相違点\n（意見が割れたまま残った点。なければ「なし」）';

// ---------------------------------------------------------------- 議論の進行
async function discuss(q) {
  const members = Object.keys(AI).filter(id => config.providers[id]?.enabled);
  const signal = controller.signal;

  document.body.classList.replace('idle', 'active');
  const session = el('section', 'session');
  session.append(el('h2', 'question', q));
  thread.append(session);
  requestAnimationFrame(() => session.scrollIntoView({ behavior: 'smooth', block: 'start' }));

  if (!members.length) {
    session.append(el('p', 'notice', config.mode === 'server'
      ? 'APIキーが設定されていません。master-ai/.env に OPENAI_API_KEY・ANTHROPIC_API_KEY・GEMINI_API_KEY を設定してサーバーを再起動してください。'
      : 'APIキーが設定されていません。「/key」と入力して設定してください。'));
    return;
  }

  holdShape(true);
  const log = [];
  const model = id => config.providers[id].model;

  // 1. それぞれの見解（同時に考える）
  addRound(session, 'それぞれの見解');
  become('tesseract', MASTER);
  setStatus(`${members.map(id => AI[id].name).join('・')} が考えています`);
  const views = members.map(id => addTurn(session, { name: AI[id].name, model: model(id), color: AI[id].near }));
  const first = await Promise.all(members.map((id, i) => speak(id, participantSystem(id, members), openingPrompt(q), views[i], signal)));
  let alive = members.filter((id, i) => first[i]);
  members.forEach((id, i) => first[i] && log.push({ id, text: first[i] }));
  if (signal.aborted) return;

  // 2. 議論（順番に発言）
  for (let r = 0; r < config.rounds && alive.length > 1; r++) {
    addRound(session, `議論 ${r + 1}`);
    for (const id of [...alive]) {
      if (signal.aborted) return;
      become(AI[id].shape, AI[id]);
      setStatus(`${AI[id].name} が発言しています`, AI[id].near);
      const view = addTurn(session, { name: AI[id].name, model: model(id), color: AI[id].near });
      const text = await speak(id, participantSystem(id, alive), debatePrompt(q, log, r, r === config.rounds - 1), view, signal);
      if (text) log.push({ id, text });
      else alive = alive.filter(x => x !== id);
    }
  }
  if (signal.aborted) return;
  if (!log.length) { setStatus(''); return; }

  // 3. 結論
  const master = config.master;
  addRound(session, '結論');
  become('sphere', MASTER);
  setStatus('マスターAIが結論をまとめています');
  const view = addTurn(session, { name: MASTER.name, model: `via ${AI[master].name}`, color: MASTER.near, conclusion: true });
  const conclusion = await speak(master, MASTER_SYSTEM, conclusionPrompt(q, log), view, signal);
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
  if (!q || !config) return;
  input.value = ''; fit(); send.disabled = true;
  if (/^\/(key|keys|設定)$/i.test(q)) return openSettings();
  if (config.mode === 'browser' && !Object.values(config.providers).some(p => p.enabled)) {
    pending = q;
    return openSettings();
  }
  start(q);
});

// ---------------------------------------------------------------- APIキー設定（サーバーなしで動かすとき）
const STORE = 'master-ai.settings';
const loadSettings = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };

function browserConfig() {
  const s = loadSettings();
  const providers = Object.fromEntries(Object.keys(AI).map(id => [id, {
    enabled: Boolean(s[id]?.key), key: s[id]?.key || '', model: s[id]?.model || DEFAULT_MODELS[id],
  }]));
  const order = ['claude', 'openai', 'gemini'];
  const master = order.find(id => providers[id].enabled && id === s.master) || order.find(id => providers[id].enabled) || null;
  return { mode: 'browser', providers, master, rounds: Number.isInteger(s.rounds) ? s.rounds : 1 };
}

const dialog = $('#settings'), settingsForm = $('#settings-form');
const LABELS = { openai: 'ChatGPT · OpenAI', claude: 'Claude · Anthropic', gemini: 'Gemini · Google' };
const fields = $('#settings-fields');
for (const id of Object.keys(AI)) {
  const row = el('fieldset', 'field');
  row.style.setProperty('--c', AI[id].near);
  row.innerHTML = `<legend>${LABELS[id]}</legend>
    <input name="${id}-key" type="password" placeholder="APIキー" autocomplete="off" spellcheck="false" aria-label="${AI[id].name} のAPIキー">
    <input name="${id}-model" type="text" placeholder="${DEFAULT_MODELS[id]}" autocomplete="off" spellcheck="false" aria-label="${AI[id].name} のモデル">`;
  fields.append(row);
}

function openSettings() {
  if (config.mode === 'server') { setStatus('APIキーはサーバーの .env で設定しています'); setTimeout(() => setStatus(''), 4000); return; }
  const s = loadSettings();
  for (const id of Object.keys(AI)) {
    settingsForm.elements[`${id}-key`].value = s[id]?.key || '';
    settingsForm.elements[`${id}-model`].value = s[id]?.model || '';
  }
  settingsForm.elements.master.value = s.master || 'claude';
  settingsForm.elements.rounds.value = String(config.rounds);
  dialog.showModal();
}

settingsForm.addEventListener('submit', e => {
  if (e.submitter?.value === 'cancel') { pending = null; return; }
  if (e.submitter?.value === 'clear') {
    try { localStorage.removeItem(STORE); } catch {}
    config = browserConfig(); pending = null; return;
  }
  const f = settingsForm.elements, s = { master: f.master.value, rounds: Number(f.rounds.value) };
  for (const id of Object.keys(AI)) s[id] = { key: f[`${id}-key`].value.trim(), model: f[`${id}-model`].value.trim() };
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch {}
  config = browserConfig();
  if (pending && Object.values(config.providers).some(p => p.enabled)) { const q = pending; pending = null; start(q); }
});
dialog.addEventListener('close', () => { if (!controller) input.focus(); });

// ---------------------------------------------------------------- 起動
(async () => {
  try {
    const res = await fetch('api/config');
    if (!res.ok) throw new Error();
    config = { mode: 'server', ...(await res.json()) };
  } catch {
    config = browserConfig();
  }
  input.focus();
})();
