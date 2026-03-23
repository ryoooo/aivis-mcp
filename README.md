# Aivis MCP Server

Aivis Cloud TTS API を MCP サーバー化する実装例です。Python（FastMCP）と TypeScript（MCP Apps）の 2 つの実装を収録しています。

| 実装 | ディレクトリ | 技術スタック | 特徴 |
|---|---|---|---|
| Python版 | ルート直下 (`main.py`) | Python + FastMCP + httpx | OpenAPI 定義からツールを自動生成、stdio/HTTP 対応 |
| TypeScript版 | [`mcp-apps/`](./mcp-apps/) | TypeScript + Bun + Hono + MCP Apps | インタラクティブな音声再生 UI、Streamable HTTP |

## Python 版（FastMCP）

`openapi.json` の定義をもとに [FastMCP](https://github.com/jlowin/fastmcp) で Aivis Cloud API を MCP サーバー化する実装です。音声合成エンドポイント `/v1/tts/synthesize` をホワイトリスト方式で公開し、Claude Desktop などの MCP クライアントから安全に呼び出せるようにしています。

## セットアップ

1. 依存パッケージをインストールします。

   ```bash
   uv sync
   # または
   pip install -e .
   ```

2. API キーなどの環境変数を設定します。`.env` に書いておくと自動で読み込まれます。

   ```dotenv
   AIVIS_API_KEY=xxxxxxxxxxxxxxxx
   # 任意: API 基本 URL を差し替えたい場合
   # AIVIS_API_BASE_URL=https://api.aivis-project.com
   # 任意: サーバー名やトランスポートをカスタマイズ
   # AIVIS_MCP_SERVER_NAME=aivis-cloud
   # AIVIS_MCP_TRANSPORT=stdio  # または http
   # AIVIS_MCP_PORT=8000
   # 任意: デフォルトで利用したいモデル UID（UUID または検索キーワード）
   # AIVIS_DEFAULT_MODEL_UID=kokuren
   ```

## 実行方法

```bash
uv run python main.py
```

デフォルトでは `stdio` トランスポートで起動します。`AIVIS_MCP_TRANSPORT=http` を指定するとローカル HTTP サーバーとして起動し、`AIVIS_MCP_PORT` でポートを選べます。

音声生成ツールを実行すると、レスポンスのバイナリデータはカレントディレクトリ直下の `aivis/` フォルダに `aivis_YYYYMMDDHHMMSSffffff.{拡張子}` 形式で自動保存されます。

`TextToSpeechAPI` ツールでは `model_uid` プロパティを指定すると、`/v1/aivm-models/search` を使ってモデルを検索し、`model_uuid`（および未指定の場合は `speaker_uuid`）を自動補完してから音声合成を実行します。キーワードが UUID に一致する場合はその値を直接利用します。`AIVIS_DEFAULT_MODEL_UID` を設定しておけば、`model_uid` 未指定時に自動的にその値が使われます。

`Users` カテゴリの `GET /v1/users/me` も MCP ツールとして公開しているため、現在ログイン中のアカウント情報をそのまま確認できます。

## 実装上の注意点

- `main.py` 内の `ALLOWED_OPERATIONS` に許可するパス/メソッドの組み合わせを登録しています。新しいエンドポイントを公開する際はここに追記してください。
- FastMCP の `route_map_fn` と `mcp_component_fn` で、OpenAPI から生成された MCP コンポーネントをカスタマイズしています。タグ付けや説明文の整形を追加したい場合はこれらの関数を修正します。
- `httpx.AsyncClient` を使って API を呼び出すため、API 応答のタイムアウトや User-Agent などは `_create_http_client` でまとめて制御できます。
- API 仕様の詳細は公式ドキュメント https://api.aivis-project.com/v1/docs を参照してください。

## 他クライアントへの追加方法

### Claude Code への追加

1. Claude Code CLI で以下のコマンドを実行し、MCP サーバーとして登録します。
   ```bash
   claude mcp add avis-cloud --env AIVIS_API_KEY="あなたのAPIキー" --env AIVIS_DEFAULT_MODEL_UID="7fc08a41-b64d-456d-8b22-8e1284674775" -- uv run python /absolute/path/to/main.py
   ```
2. HTTP 経由で公開したい場合は `claude mcp add --transport http ...` 形式も利用できます（Context7 連携例と同じく `--header "CONTEXT7_API_KEY: ..."` を付与する形式が公式で紹介されています）。
3. 追加後は Claude Code 上で `TextToSpeechAPI` ツールが利用可能になります。

### codex-cli への追加

1. codex CLI の設定ファイル（例: `~/.config/codex/mcp_servers.toml`）に以下を追記します。
   ```toml
   [mcp_servers.avis-cloud]
   command = "uv"
   args = ["run", "python", "/absolute/path/to/main.py"]
   env = { AIVIS_API_KEY = "あなたのAPIキー" }
   ```

## TypeScript 版（MCP Apps）

MCP Apps 拡張を使い、チャット内にインライン表示される音声再生 UI を備えた実装です。詳細は [`mcp-apps/README.md`](./mcp-apps/README.md) を参照してください。

```bash
cd mcp-apps
bun install
cp .env.example .env
# .env に AIVIS_API_KEY を設定
bun run build && bun run server
```
