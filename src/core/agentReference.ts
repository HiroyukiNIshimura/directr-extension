/**
 * DirectoR の YAML から agent 参照と profile 名を位置情報付きで抽出する純粋関数群。
 * vscode に依存しないため Node のテストからそのまま呼び出せる。
 */

export interface TextRange {
  /** 0 始まりの行番号 */
  line: number;
  /** 行内の開始位置（0 始まり、文字数） */
  start: number;
  /** 行内の終了位置（0 始まり、文字数） */
  end: number;
}

export interface AgentReference {
  /** steps.agent に書かれた値（例: DR-wfsub-code-reviewer） */
  agentId: string;
  range: TextRange;
  /** 直近の step の id（取得できた場合） */
  stepId?: string;
}

export interface ProfileNameDeclaration {
  name: string;
  range: TextRange;
}

/** `DR-wfsub-<name>` / `wfsub-<name>` から profile 名を取り出す。該当しなければ undefined。 */
export function profileNameFromAgentId(agentId: string): string | undefined {
  const match = /^(?:dr-)?wfsub-(.+)$/i.exec(agentId.trim());
  const name = match?.[1]?.trim();
  return name ? name : undefined;
}

/**
 * `.github/agents` 配下のファイル名（拡張子 .agent.md を除いたもの）の照合キー。
 * 生成スクリプトは `wfsub-${profile.name}.agent.md` を出力するため、
 * agent id から `DR-` を外して小文字化した文字列がキーになる。
 */
export function agentFileKey(agentId: string): string {
  return agentId.trim().replace(/^dr-/i, '').toLowerCase();
}

const AGENT_LINE = /^(\s*(?:-\s+)?agent:)([ \t]*)(?:"([^"]*)"|'([^']*)'|([^\s#"']+))/;
const STEP_ID_LINE = /^\s*-\s+id:[ \t]*(?:"([^"]*)"|'([^']*)'|([^\s#'"]+))/;
const PROFILE_NAME_LINE = /^name:[ \t]*(?:"([^"]*)"|'([^']*)'|([^#\s]+))/;

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * `agent:` キーを持つ行をすべて拾う（`parallel.worker.agent` のような入れ子も対象）。
 * 直前の `- id:` を step として引き継ぐ。
 */
export function parseAgentReferences(text: string): AgentReference[] {
  const references: AgentReference[] = [];
  let currentStepId: string | undefined;

  const lines = splitLines(text);
  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const line = lines[lineNo];

    const stepMatch = STEP_ID_LINE.exec(line);
    if (stepMatch) {
      currentStepId = stepMatch[1] ?? stepMatch[2] ?? stepMatch[3];
    }

    const agentMatch = AGENT_LINE.exec(line);
    if (!agentMatch) {
      continue;
    }

    const quoted = agentMatch[3] ?? agentMatch[4];
    const raw = quoted ?? agentMatch[5] ?? '';
    const offset = agentMatch[1].length + agentMatch[2].length + (quoted === undefined ? 0 : 1);
    const leadingSpaces = raw.length - raw.trimStart().length;
    const agentId = raw.trim();
    if (!agentId) {
      continue;
    }

    const start = offset + leadingSpaces;
    references.push({
      agentId,
      range: { line: lineNo, start, end: start + agentId.length },
      stepId: currentStepId,
    });
  }

  return references;
}

/** profile YAML のトップレベル `name:` を取得する。 */
export function parseProfileName(text: string): ProfileNameDeclaration | undefined {
  const lines = splitLines(text);
  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const match = PROFILE_NAME_LINE.exec(lines[lineNo]);
    if (!match) {
      continue;
    }
    const quoted = match[1] ?? match[2];
    const value = (quoted ?? match[3] ?? '').trim();
    if (!value) {
      return undefined;
    }
    const start = lines[lineNo].indexOf(value, 'name:'.length);
    return {
      name: value,
      range: { line: lineNo, start, end: start + value.length },
    };
  }
  return undefined;
}
