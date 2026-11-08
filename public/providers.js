// 各社APIの呼び出し定義（ストリーミング）— サーバー（Node）とブラウザの両方から使う

export const DEFAULT_MODELS = {
  openai: 'gpt-5',
  claude: 'claude-opus-5-5',
  gemini: 'gemini-2.5-pro',
};

export const API = {
  openai: ({ key, model }, system, prompt) => ({
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { authorization: `Bearer ${key}` },
    body: { model, stream: true, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] },
    pick: d => d.choices?.[0]?.delta?.content || '',
  }),
  claude: ({ key, model }, system, prompt) => ({
    url: 'https://api.anthropic.com/v1/messages',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: { model, max_tokens: 4096, stream: true, system, messages: [{ role: 'user', content: prompt }] },
    pick: d => {
      if (d.type === 'error') throw new Error(d.error?.message || 'Claude API error');
      return d.type === 'content_block_delta' && d.delta?.type === 'text_delta' ? d.delta.text : '';
    },
  }),
  gemini: ({ key, model }, system, prompt) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    headers: { 'x-goog-api-key': key },
    body: { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }] },
    pick: d => {
      if (d.error) throw new Error(d.error.message || 'Gemini API error');
      return (d.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    },
  }),
};

// provider: { key, model } — テキスト断片を順に返す
export async function* streamProvider(id, provider, system, prompt, signal) {
  const cfg = API[id](provider, system, prompt);
  const res = await fetch(cfg.url, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', ...cfg.headers },
    body: JSON.stringify(cfg.body),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { const j = JSON.parse(text); msg = j.error?.message || j.message || text; } catch {}
    throw new Error(`${res.status} ${msg}`.slice(0, 400));
  }
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let json; try { json = JSON.parse(data); } catch { continue; }
      const text = cfg.pick(json);
      if (text) yield text;
    }
  }
}
