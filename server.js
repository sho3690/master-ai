// マスターAI — ChatGPT / Claude / Gemini を中継するローカルサーバー（依存パッケージなし・Node 18+）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODELS, streamProvider } from './public/providers.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');

// ---- .env の読み込み（既存の環境変数を優先）
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch { /* .env なし */ }

const env = process.env;
const MOCK = env.MOCK === '1';
const PORT = Number(env.PORT) || 3000;

const PROVIDERS = {
  openai: { key: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || DEFAULT_MODELS.openai },
  claude: { key: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL || DEFAULT_MODELS.claude },
  gemini: { key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || DEFAULT_MODELS.gemini },
};
const enabled = id => id in PROVIDERS && (MOCK || Boolean(PROVIDERS[id].key));

// ---- 動作確認用のダミー応答（MOCK=1）
async function* streamMock(id, system, prompt, signal) {
  const name = { openai: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' }[id];
  const isMaster = system.startsWith('あなたはマスターAI');
  const text = isMaster
    ? `## 結論\n**これはダミーの結論です。** 3者の議論を踏まえ、段階的に進めるのが妥当です。\n\n## 根拠\n- ChatGPT は実行速度を重視\n- Claude はリスクの洗い出しを重視\n- Gemini はデータでの検証を提案\n\n## 残る論点\n- 予算配分の優先度`
    : `${name}としてのダミー発言です。質問の要点は「${(prompt.match(/【質問】\n([^\n]*)/) || [, ''])[1].slice(0, 30)}」だと理解しています。**まず前提を確認**し、次に選択肢を比較するのがよいと考えます。\n\n- 観点1: コスト\n- 観点2: \`実現性\``;
  for (const ch of text.match(/[\s\S]{1,3}/g)) {
    if (signal.aborted) return;
    await new Promise(r => setTimeout(r, 18));
    yield ch;
  }
}

// ---- HTTP
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const readJson = req => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', c => { s += c; if (s.length > 2e6) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
  req.on('error', reject);
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/api/config') {
    const providers = Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, { enabled: enabled(id), model: MOCK ? 'mock' : p.model }]));
    const master = enabled(env.MASTER_PROVIDER) ? env.MASTER_PROVIDER : (enabled('claude') ? 'claude' : Object.keys(PROVIDERS).find(enabled) || null);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ providers, master, rounds: Math.max(0, Math.min(4, Number(env.ROUNDS ?? 1))) }));
  }

  if (req.method === 'POST' && url.pathname === '/api/turn') {
    let body;
    try { body = await readJson(req); } catch { res.writeHead(400); return res.end(); }
    const { provider, system = '', prompt = '' } = body;
    if (!PROVIDERS[provider] || !enabled(provider)) { res.writeHead(400); return res.end(); }

    const ac = new AbortController();
    res.on('close', () => ac.abort());
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' });
    try {
      const gen = MOCK ? streamMock(provider, system, prompt, ac.signal) : streamProvider(provider, PROVIDERS[provider], system, prompt, ac.signal);
      for await (const t of gen) res.write(JSON.stringify({ t }) + '\n');
    } catch (e) {
      if (!ac.signal.aborted) res.write(JSON.stringify({ error: e.message || String(e) }) + '\n');
    }
    return res.end();
  }

  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const on = Object.keys(PROVIDERS).filter(enabled);
  console.log(`マスターAI: http://localhost:${PORT}${MOCK ? '  (MOCK モード)' : ''}`);
  console.log(`接続中: ${on.length ? on.join(', ') : 'なし — .env にAPIキーを設定してください'}`);
});
