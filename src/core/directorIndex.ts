import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  type AgentReference,
  agentFileKey,
  parseAgentReferences,
  parseProfileName,
  profileNameFromAgentId,
} from './agentReference';

export const DIRECTOR_DIR_NAME = '.director';
export const WORKFLOWS_DIR_NAME = 'workflows';
export const PROFILES_DIR_NAME = 'profiles';
export const AGENTS_DIR_NAME = 'agents';
export const AGENT_FILE_SUFFIX = '.agent.md';

export type DirectorDocumentKind = 'workflow' | 'profile';

export interface DirectorDocumentLocation {
  kind: DirectorDocumentKind;
  /** ワークスペース（または .director を包含するディレクトリ）のルート */
  root: string;
  filePath: string;
  fileName: string;
}

export interface ProfileEntry {
  filePath: string;
  fileName: string;
  name: string;
}

export interface WorkflowEntry {
  filePath: string;
  fileName: string;
  references: AgentReference[];
}

export interface DirectorIndex {
  root: string;
  /** profile の `name` をキーにした索引 */
  profiles: Map<string, ProfileEntry>;
  /** `.github/agents` のファイル名（.agent.md を除き小文字化）をキーにした索引 */
  agentFiles: Map<string, string>;
  workflows: WorkflowEntry[];
}

export interface LinkTarget {
  kind: 'profile' | 'agent';
  filePath: string;
}

export interface WorkflowCaller {
  workflow: WorkflowEntry;
  stepIds: string[];
}

function isYamlFile(fileName: string): boolean {
  return /\.ya?ml$/i.test(fileName);
}

function readDirSafe(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readFileSafe(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * ワークスペース直下の `.director/workflows/*.yaml` と
 * `.director/workflows/profiles/*.yaml` だけを対象として判定する。
 */
export function classifyDirectorDocument(
  filePath: string,
  root: string,
): DirectorDocumentLocation | undefined {
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }

  const segments = relative.split(path.sep);
  const fileName = segments[segments.length - 1];
  if (!isYamlFile(fileName)) {
    return undefined;
  }

  if (
    segments.length === 3 &&
    segments[0] === DIRECTOR_DIR_NAME &&
    segments[1] === WORKFLOWS_DIR_NAME
  ) {
    return { kind: 'workflow', root, filePath, fileName };
  }

  if (
    segments.length === 4 &&
    segments[0] === DIRECTOR_DIR_NAME &&
    segments[1] === WORKFLOWS_DIR_NAME &&
    segments[2] === PROFILES_DIR_NAME
  ) {
    return { kind: 'profile', root, filePath, fileName };
  }

  return undefined;
}

/** ファイルから上方に辿り、`.director/workflows` を持つディレクトリをルートとして返す。 */
export function findRootForFile(filePath: string, maxDepth = 32): string | undefined {
  let current = path.dirname(filePath);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (fs.existsSync(path.join(current, DIRECTOR_DIR_NAME, WORKFLOWS_DIR_NAME))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
  return undefined;
}

export function buildDirectorIndex(root: string): DirectorIndex {
  const workflowsDir = path.join(root, DIRECTOR_DIR_NAME, WORKFLOWS_DIR_NAME);
  const profilesDir = path.join(workflowsDir, PROFILES_DIR_NAME);
  const agentsDir = path.join(root, '.github', AGENTS_DIR_NAME);

  const workflows: WorkflowEntry[] = readDirSafe(workflowsDir)
    .filter((entry) => entry.isFile() && isYamlFile(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((fileName) => {
      const filePath = path.join(workflowsDir, fileName);
      const text = readFileSafe(filePath) ?? '';
      return { filePath, fileName, references: parseAgentReferences(text) };
    });

  const profiles = new Map<string, ProfileEntry>();
  for (const entry of readDirSafe(profilesDir)) {
    if (!entry.isFile() || !isYamlFile(entry.name)) {
      continue;
    }
    const filePath = path.join(profilesDir, entry.name);
    const text = readFileSafe(filePath) ?? '';
    const declaration = parseProfileName(text);
    const name = declaration?.name;
    if (!name || profiles.has(name)) {
      continue;
    }
    profiles.set(name, { filePath, fileName: entry.name, name });
  }

  const agentFiles = new Map<string, string>();
  for (const entry of readDirSafe(agentsDir)) {
    if (!entry.isFile() || !entry.name.endsWith(AGENT_FILE_SUFFIX)) {
      continue;
    }
    const key = entry.name.slice(0, -AGENT_FILE_SUFFIX.length).toLowerCase();
    if (!agentFiles.has(key)) {
      agentFiles.set(key, path.join(agentsDir, entry.name));
    }
  }

  return { root, profiles, agentFiles, workflows };
}

/** agent 参照に対応する `.github/agents` のファイルを返す。 */
export function resolveAgentFile(index: DirectorIndex, agentId: string): string | undefined {
  return index.agentFiles.get(agentFileKey(agentId));
}

/** profile 名に対応する `.github/agents/wfsub-<name>.agent.md` を返す。 */
export function resolveProfileAgentFile(
  index: DirectorIndex,
  profileName: string,
): string | undefined {
  return index.agentFiles.get(`wfsub-${profileName}`.toLowerCase());
}

/**
 * workflow の `steps.agent` が指す先。profile YAML を優先し、
 * 見つからない場合だけ agent 定義ファイルへフォールバックする。
 */
export function resolveAgentTarget(index: DirectorIndex, agentId: string): LinkTarget | undefined {
  const profileName = profileNameFromAgentId(agentId);
  if (profileName) {
    const profile = index.profiles.get(profileName);
    if (profile) {
      return { kind: 'profile', filePath: profile.filePath };
    }
  }

  const agentFile = resolveAgentFile(index, agentId);
  if (agentFile) {
    return { kind: 'agent', filePath: agentFile };
  }

  return undefined;
}

/** profile を呼び出している workflow を列挙する。 */
export function findWorkflowCallers(index: DirectorIndex, profileName: string): WorkflowCaller[] {
  const callers: WorkflowCaller[] = [];
  for (const workflow of index.workflows) {
    const matches = workflow.references.filter(
      (reference) => profileNameFromAgentId(reference.agentId) === profileName,
    );
    if (!matches.length) {
      continue;
    }
    const stepIds = [
      ...new Set(
        matches
          .map((match) => match.stepId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    callers.push({ workflow, stepIds });
  }
  return callers;
}
