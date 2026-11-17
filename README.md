# DirectoR Workflow Links

DirectoR の workflow YAML と、その step が呼び出す profile YAML / エージェント定義を行き来するための VS Code 拡張機能です。

## 対象ファイル

VS Code で開いているプロジェクト（ワークスペースフォルダ）直下の次のファイルだけで機能します。

| 種類 | パス |
| --- | --- |
| workflow | `.director/workflows/*.yaml`（`*.yml` も可） |
| profile | `.director/workflows/profiles/*.yaml`（`*.yml` も可） |

`profiles` の下位ディレクトリや `.director/workflows/generated` は対象外です。

## workflow YAML から profile / agent へ

`steps.agent`（`parallel.worker.agent` などの入れ子も含む）が指す先へリンクします。

| `steps.agent` の値 | 解決先 |
| --- | --- |
| `DR-wfsub-<name>` | `.director/workflows/profiles` 配下で `name: <name>` を持つ YAML |
| 上記が見つからない場合 | `.github/agents/<agent から DR- を除いた小文字>.agent.md` |

- `agent` の値に Cmd/Ctrl + クリックすると profile YAML を開きます。
- 各 step の上に、生成済みの `.github/agents/wfsub-<name>.agent.md` を開く CodeLens を表示します（`generate-wfsub.mjs` の出力規則に合わせています）。
- profile はあるが agent 定義が未生成の場合は警告 CodeLens、どちらも見つからない場合は `未解決` の警告 CodeLens を表示します。

## profile YAML から workflow へ

profile YAML の `name:` を手がかりに、その profile を `agent` として呼び出している workflow を逆引きします。

- 呼び出し元が 1 件: `name` の値にリンク（Cmd/Ctrl + クリックで workflow YAML を開く）。
- 呼び出し元が 2 件以上: `name` 行の上に呼び出し元 workflow ごとの CodeLens（step id 付き）を表示。

## step と artifact への移動

- workflow の `start_step_id`、`depends_on`、`success.destination`、`failure.destination` や `failure.routes` の遷移先から、その workflow 内の step 定義へ移動できます。
- profile の `artifacts` の値と `artifact_sections[].artifact` の別名から、対応する `.director/workflows/artifacts/*.yaml` を開けます。
- workflow の `agent` にマウスを合わせると、対応する profile の説明・phase・tools を表示します。

## 補完と診断

- workflow の `agent` に既存 profile、`depends_on` に先行 step、`destination` / `start_step_id` に step ID を補完します。
- 編集中の workflow に対し、YAML の構文、未定義・重複 step、依存順序、遷移先、後方遷移時の `max_visits` などを診断します。
- これは主要な参照のチェックであり、DirectoR のスキーマ・バリデーターによる完全な検証の代わりではありません。拡張機能はプロジェクト内のスクリプトを自動実行しません。

## フロー図

workflow YAML を開き、コマンドパレットから `DirectoR: フロー図を表示` を実行します。依存関係・成功・失敗遷移を色分けして表示し、step のクリックで YAML の定義へ移動できます。編集中の変更も反映されます。parallel / chunk の agent は親 step 内にまとめて表示します。

## コマンド

| コマンド | 説明 |
| --- | --- |
| `DirectoR: フロー図を表示` (`directr.showWorkflowDiagram`) | 開いている workflow のフロー図を表示します。 |
| `DirectoR: インデックスを再読み込み` (`directr.refreshIndex`) | キャッシュした索引を作り直します。 |
| `DirectoR: 未解決の agent 参照を表示` (`directr.showUnresolvedReference`) | 警告 CodeLens から呼ばれ、想定した参照先を表示します。 |

索引は `.director/workflows/**` と `.github/agents/**` の変更・保存時に自動で破棄されます。

## 開発

```sh
npm install
npm run compile
npm test
```

`F5`（Run Extension）で拡張機能開発ホストを起動できます。テストは `test/` 配下にあり、`vscode` モジュールをスタブして Provider の出力を検証します。

実際の VS Code 拡張ホストで検証する場合は、対象プロジェクトと VS Code の実体を指定して実行します。

```sh
DIRECTR_TEST_WORKSPACE=/path/to/director-project \
VSCODE_EXECUTABLE="/Applications/Visual Studio Code.app/Contents/MacOS/Code" \
npm run test:vscode
```

## アイコン

ストア用アイコンは未設定です。作成後に `package.json` の `icon` へ追加してください。
