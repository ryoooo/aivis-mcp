# Aivis MCP Apps

Aivis Cloud TTS APIをMCP Apps拡張で実装したMCPサーバー。音声再生UIを備えたインタラクティブなTTS体験を提供する。

## アーキテクチャ

```
Claude Desktop / Claude Code / Inspector
    │
    │  mcp-remote (stdio → HTTP proxy)
    │
    ▼
Hono HTTP Server (:3000/mcp)
    │
    │  セッションごとに McpServer + Transport を生成
    │
    ├── registerAppTool("synthesize-speech")
    │       → Aivis Cloud TTS API で音声合成
    │       → structuredContent で base64 音声を返却
    │
    └── registerAppResource("TTS Player")
            → Vite でバンドルした単一 HTML を配信
            → App SDK で MCP ホストと postMessage 通信
            → Web Audio API で音声再生
```

## セットアップ

```bash
bun install
cp .env.example .env
# .env ファイルにAIVIS_API_KEYを設定
```

## 使い方

```bash
# UIをビルド＆サーバー起動
bun run build && bun run server
```

サーバーが起動すると以下のエンドポイントが利用可能になる。

| エンドポイント | 用途 |
|---|---|
| `http://localhost:3000/mcp` | MCP Streamable HTTP |
| `http://localhost:3000/health` | ヘルスチェック |
| `http://localhost:3000/ui` | UIプレビュー（ホスト接続なし） |

## クライアントへの追加方法

### Claude Desktop

Claude DesktopはHTTP transportを直接サポートしていないため、`mcp-remote`プロキシを使用する。`claude_desktop_config.json`に以下を追加：

```json
{
  "mcpServers": {
    "aivis-tts": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

設定ファイルの場所：

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

#### WSL2環境（Windows）

WSL2上でサーバーを動かしている場合、Windows側の`node`/`npx`がPATHに入っていない可能性がある。mise等のバージョンマネージャを使っている場合はフルパスを指定する。

```json
{
  "mcpServers": {
    "aivis-tts": {
      "command": "C:\\Users\\<username>\\AppData\\Local\\mise\\installs\\pnpm\\<version>\\pnpm.exe",
      "args": ["dlx", "mcp-remote", "http://localhost:3000/mcp"],
      "env": {
        "PATH": "C:\\Users\\<username>\\AppData\\Local\\mise\\installs\\node\\<version>;%PATH%"
      }
    }
  }
}
```

`<username>` と `<version>` は自分の環境に合わせて置き換える。フルパスは `where.exe pnpm` / `where.exe node` で確認できる。

### Claude Code

```bash
claude mcp add --transport http aivis-tts http://localhost:3000/mcp
```

### MCP Inspector

```bash
bunx @modelcontextprotocol/inspector
```

起動後、Transport Type を **Streamable HTTP**、URL を `http://localhost:3000/mcp` に設定して接続する。

## テスト手順

### 1. ヘルスチェック

```bash
curl http://localhost:3000/health
# => {"status":"ok"}
```

### 2. MCP Inspectorでのツール確認

1. `bunx @modelcontextprotocol/inspector` を起動
2. Streamable HTTP / `http://localhost:3000/mcp` で接続
3. **Tools** タブに `synthesize-speech` が表示されることを確認
4. テキストを入力して実行し、base64エンコードされた音声データが返ることを確認

### 3. Claude Desktopでの統合テスト

1. 上記の設定で`claude_desktop_config.json`を編集
2. WSL側でサーバーを起動（`bun run build && bun run server`）
3. Claude Desktopを再起動
4. チャットで「テストと音声合成して」等のプロンプトを送信
5. `synthesize-speech` ツールが呼び出され、MCP Apps UIがチャット内にインライン表示される
6. 再生ボタンで音声再生、ダウンロードボタンで音声ファイル保存が可能

### 4. 複数セッション

MCP InspectorとClaude Desktopを同時に接続できる。サーバーはセッションごとに独立したMcpServerインスタンスを作成するため、相互に干渉しない。

## ツール

### synthesize-speech

テキストから音声を合成する。MCP Apps対応クライアントではインラインUIが表示される。

**パラメータ:**

- `text` (必須): 読み上げテキスト（1-3000文字）
- `model_uuid` (任意): モデルUUID
- `speaker_uuid` (任意): 話者UUID
- `output_format` (任意): `mp3` | `wav` | `flac`（デフォルト: `mp3`）

## 開発

```bash
# 開発サーバー（Vite）
bun run dev

# リント
bun run lint

# フォーマット
bun run format

# 型チェック
bun run typecheck

# テスト
bun test
```

## 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `AIVIS_API_KEY` | Yes | Aivis Cloud APIキー |
| `AIVIS_DEFAULT_MODEL_UUID` | No | デフォルトモデルUUID |
| `PORT` | No | サーバーポート（デフォルト: 3000） |

## トラブルシューティング

### SSE 409 Conflict エラー

`mcp-remote`のログに `Failed to open SSE stream: Conflict` が出る場合があるが、ツール呼び出しには影響しない。SSEストリームの再接続時にセッションが既存の場合に発生する既知の非致命的エラー。

### `spawn npx ENOENT` / `'node' is not recognized`

Claude DesktopがNode.jsを見つけられていない。mise等のバージョンマネージャを使っている場合、コマンドのフルパス指定と `env.PATH` の設定が必要（WSL2環境の設定例を参照）。

### `Server already initialized`

複数クライアントが同時接続しようとした場合の旧バージョンのエラー。サーバーを最新版に更新すること。

## API仕様

Aivis Cloud APIの詳細は https://api.aivis-project.com/v1/docs を参照。
