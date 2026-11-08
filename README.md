# Master AI

3つのAIが議論し、マスターAIが結論を出すアプリです。
OpenRouter 経由のオープンウェイトモデル（DeepSeek・Qwen・Llama・gpt-oss など）と、OpenAI・Anthropic・Google の公式APIを自由に組み合わせられます。
トップページには幾何学の姿をしたマスターAI（`machine-dream.js`）と質問欄だけを置いています。

## 議論の流れ

1. **それぞれの見解**: 3つのAIが互いの答えを見ずに、同時に回答します。
2. **議論**: 順番に発言し、相手の名前を挙げて同意・反論・補足をします（ラウンド数は変更可・既定1）。
3. **結論**: マスターAIが議論をまとめ、「結論・根拠・残る相違点」を示します。

発言者ごとに図形の形と色が変わります（1番目=正二十面体、2番目=トーラス結び目、3番目=リサージュ曲線、結論=球面）。
続けて質問すると、前回までの結論を踏まえて議論します。議論中は送信ボタンが停止ボタンになります。

## GitHub Pages で公開する

`public/` はサーバーなしで動きます。サーバーが見つからないときは、ブラウザから各社APIを直接呼びます。

- **設定**: 最初の質問のときに設定画面が開きます。あとから変えるときは、質問欄に `/key` と入力します。
- **APIキー**: OpenRouter のキー1つでオープンウェイトモデルを使えます（openrouter.ai → Keys → Create Key）。公式APIのキーは「公式API」を開いて入力します。キーはそのブラウザの localStorage にだけ保存されます。
- **モデルの選び方**: 席ごとに接続先とモデルを選びます。OpenRouter のモデルは検索して選べ、「オープンウェイトのみ」「無料のみ」で絞り込めます。「おまかせで選ぶ」で DeepSeek・Qwen・その他の系統から自動で選びます。
- **公開URL**: https://sho3690.github.io/master-ai/
- **更新**: `main` に push すると自動で公開し直されます（`.github/workflows/pages.yml`）。

## ローカルで使う（キーをサーバー側に置く）

Node.js 18 以上が必要です（追加パッケージなし）。

```sh
cp .env.example .env   # APIキーを入力
npm start              # → http://localhost:3000
```

- **キーなしで試す**: `npm run mock` で、ダミー応答のまま見た目と流れを確認できます。
- **キーの扱い**: サーバーだけが読み、ブラウザには送りません。参加させるモデルは画面の設定で選びます。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `public/index.html` | ページ（図形と質問欄のみ・APIキー設定画面） |
| `public/app.js` | 議論の進行・プロンプト・表示 |
| `public/providers.js` | 各APIの呼び出し（OpenRouter・OpenAI・Anthropic・Google、サーバーとブラウザで共用） |
| `public/style.css` | スタイル |
| `public/machine-dream.js` | 幾何学アニメーションの Web Component |
| `server.js` | ローカル用サーバー（API中継・静的ファイル配信） |
| `.github/workflows/pages.yml` | GitHub Pages へのデプロイ |
