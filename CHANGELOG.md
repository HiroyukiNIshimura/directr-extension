# 変更履歴

## 1.2.0

### 追加

- workflow スキーマの `allOf`、`anyOf`、`oneOf`、`if` / `then` / `else`、`not`、`const` を診断対象に追加
- `success.routes`、`on_success`、`when`、route の `description` に対応
- chunk step の担当、最大並列数、最大タスク数をフロー図に表示
- workflow の `max_total_step_executions` と step の `max_visits` をフロー図に表示
- 前方 retry で、遷移先の依存が未完了になるケースを診断

### 変更

- フロー図を SVG の複数経路表示から縦並びのカード表示へ変更
- 依存先をチップとして表示し、成功・失敗経路は step ごとの折りたたみに整理
- 成功条件、失敗条件、route の構造化条件、処理、説明、遷移先を判定詳細へ表示
- DirectoR の現在の workflow schema に合わせ、parallel agent の担当別遷移も解析

### 修正

- `success.on_success: retry` を failure retry の依存不足診断対象から除外
- 複雑なスキーマ制約の診断で Promise の `then` と誤認されるテスト内の VS Code 診断を解消

## 1.1.0

### 追加

- workflow / profile の JSON Schema による診断
- 必須キー、型、候補値、配列、文字列長、数値下限の検証
- workflow の step と遷移参照に対する診断
- profile / workflow フィールドへのスキーマ説明 hover
- profile の `tools` と `phase` の補完
- profile の `template` からテンプレートファイルへのリンク

## 1.0.0

### 追加

- workflow YAML から profile / agent への移動
- profile から呼び出し元 workflow への逆参照
- step、artifact、生成済み agent へのリンク
- workflow フロー図表示
- VSIX パッケージ・公開スクリプト
