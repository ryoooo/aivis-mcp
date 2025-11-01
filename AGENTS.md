# Aivis MCP Agents Playbook

## ゴールと前提
- OpenAPI 仕様 (`openapi.json`) を起点に Aivis Cloud API の音声合成 (`/v1/tts/synthesize`) とユーザー情報 (`/v1/users/me`) を MCP 化する。
- Python 3.12 / `uv` による依存管理と実行が前提。Python コマンドやテストは常に `uv` 経由で呼び出す。
- `AIVIS_API_KEY`（必須）と必要に応じて `AIVIS_API_BASE_URL`, `AIVIS_DEFAULT_MODEL_UID` を `.env` で設定する。
- 生成音声は `./aivis/` にバイナリ保存し、構造化レスポンスでクライアントへ返却する仕様を維持する。

推奨セットアップ:

```bash
uv sync
uv run python main.py --help
uv run pytest
```

## Context7 での運用ヒント
- Context7 の MCP クライアント登録時は `command = "uv"` とし、`args = ["run", "python", "main.py"]` を指定してサーバーを起動する。
- OpenAPI 仕様の読み込みや追加ハンドラーの提案を依頼するときは `docs/` と `article.md` を参照対象に含める。
- FastMCP の型生成やルート制御に関する質問は `route_map_fn`, `mcp_component_fn`, `RequestDirector` のキーワードで検索させると精度が高い。

```toml
# context7 エージェント設定例（抜粋）
[agent.aivis-server]
command = "uv"
args = ["run", "python", "main.py"]
workdir = "/home/ryoki/dev/aivis-mcp-book"
transport = "stdio"
```

## 役割別プレイブック

### 1. Research Agent（調査・設計補助）
- **目的**: FastMCP × OpenAPI の仕様確認、`model_uid` 自動補完の改善案収集。
- **主なタスク**
  - `article.md` 第2〜4章を参照して route マッピングや schema 無効化方針を整理。
  - Context7経由で FastMCP の README / experimental 仕様をリサーチし、設計メモに反映。
  - TypeScript 版ジェネレーター（Kubb + FastMCP プラグイン）の出力比較で Python 実装の抜け漏れを検出。
- **必須コマンド**
  - `uv run python main.py --list-tools` で公開ツールを確認。
  - `uv run python -m pip list` は使用しない。依存調査は `pyproject.toml` と `uv.lock` を参照。

### 2. Implementation Agent（実装担当）
- **目的**: `main.py` における MPC サーバーの拡張・メンテナンス。
- **主なタスク**
  - `ALLOWED_OPERATIONS` に新エンドポイントを追加し、`_route_map` を破壊しない。
  - `_prepare_model_arguments` による `model_uid`→`model_uuid` 補完の改善。
  - バイナリレスポンス保存ロジック（`_save_binary_response`）の保守。
- **ワークフロー**
  1. ブランチ作成 → `uv run pytest` で既存テスト確認。
  2. 実装 → 必要なら `docs/` に設計メモを追加。
  3. `uv run python main.py --transport stdio` でローカル検証。
- **フォーカス**: schema 循環参照回避 (`component.output_schema = None`)、`FastMCP.from_openapi` の `mcp_component_fn` カスタマイズ。

### 3. Testing & QA Agent（検証担当）
- **目的**: 自動テストと実 API 呼び出しを通じて品質保証する。
- **主なタスク**
  - `uv run pytest` を定期実行し、`pytest` の補助ケース（`model_uid` 補完、ファイル保存）を拡充。
  - API キーを使った実リクエストで `./aivis/` に生成されるファイルとレスポンス JSON を確認。
  - context7 Inspector / Claude Code など別クライアントでツール呼び出し互換性をレポート。
- **チェックリスト**
  - `AIVIS_API_KEY` 未設定時に明示的な例外が出ること。
  - `model_uid` が UUID の場合は検索呼び出しを行わないこと。
  - 音声ファイルの削除ポリシーと命名規則 (`aivis_{timestamp}.wav`) が守られていること。

### 4. Documentation Agent（ドキュメント整備）
- **目的**: `README.md`, `article.md`, `AGENTS.md` を中心に情報を整理し続ける。
- **主なタスク**
  - `article.md` 各章の更新内容を README のセットアップ手順と同期。
  - MCP クライアント別設定例（Context7 / Claude Code / codex-cli）を最新化。
  - トラブルシューティング（第8章）の追加事例を集約。
- **推奨フロー**
  1. 実装・テスト担当からの変更点をヒアリング。
  2. `docs/` に詳細、`README.md` に要約、`AGENTS.md` にオペレーションを追記。
  3. `uv run python main.py --help` の内容とドキュメントの乖離を確認。

## コラボレーションフロー
1. **調査期**: Research Agent が FastMCP の新仕様を検証し、必要なら設計メモを発行。
2. **実装期**: Implementation Agent が `main.py` や新モジュールを更新し、`uv run pytest` を事前に実行。
3. **検証期**: Testing Agent がユニットテストと実 API 呼び出しを行い、Context7 や Inspector でツール呼び出しを確認。
4. **ドキュメント期**: Documentation Agent が README / AGENTS を更新し、Context7 の設定例を最新化。

## 補足リファレンス
- FastMCP 公式ドキュメント（`fastmcp.server.openapi.FastMCPOpenAPI`, `RequestDirector`）
- `@beshkenadze/kubb-plugin-fastmcp` README & TESTING（TypeScript 実装比較用）
- `article.md` 第3章〜第6章：骨格実装・`model_uid` 補完・音声保存・統合テストの詳細
- `docs/`（存在する場合）：追加設計メモ

このプレイブックに従って役割分担を行うことで、Context7 など複数の MCP クライアントと連携しながら Aivis MCP サーバーを安全かつ迅速に改善できる。
