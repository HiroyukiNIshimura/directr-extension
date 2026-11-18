import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import Module from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';

import { buildDirectorIndex } from '../src/core/directorIndex';

// vscode は拡張ホスト内でしか解決できないため、Provider 検証用に最小スタブを差し込む
class Range {
  public startLine: number;
  public startCharacter: number;
  public endLine: number;
  public endCharacter: number;

  constructor(
    startLine: number | { line: number; character: number },
    startCharacter: number | { line: number; character: number },
    endLine?: number,
    endCharacter?: number,
  ) {
    if (typeof startLine === 'object' && typeof startCharacter === 'object') {
      this.startLine = startLine.line;
      this.startCharacter = startLine.character;
      this.endLine = startCharacter.line;
      this.endCharacter = startCharacter.character;
    } else {
      if (typeof startLine !== 'number' || typeof startCharacter !== 'number') {
        throw new TypeError('Invalid range arguments');
      }
      this.startLine = startLine;
      this.startCharacter = startCharacter;
      this.endLine = endLine ?? startLine;
      this.endCharacter = endCharacter ?? startCharacter;
    }
  }
}

class DocumentLink {
  tooltip: string | undefined;
  constructor(
    public range: Range,
    public target: { fsPath: string },
  ) {}
}

class CodeLens {
  constructor(
    public range: Range,
    public command: { title: string; command: string; arguments?: unknown[] },
  ) {}
}

class CompletionItem {
  detail: string | undefined;
  insertText: string | undefined;
  range: Range | undefined;
  constructor(
    public label: string,
    public kind: number,
  ) {}
}

class EventEmitter<T> {
  private readonly listeners = new Set<(event: T) => void>();

  readonly event = (listener: (event: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

let workspaceRoot = '';

const vscodeStub = {
  Range,
  DocumentLink,
  CodeLens,
  CompletionItem,
  CompletionItemKind: { Reference: 18, EnumMember: 22 },
  EventEmitter,
  Uri: { file: (fsPath: string) => ({ scheme: 'file', fsPath }) },
  workspace: {
    get workspaceFolders() {
      return workspaceRoot ? [{ uri: { scheme: 'file', fsPath: workspaceRoot } }] : [];
    },
    getWorkspaceFolder(uri: { fsPath: string }) {
      return uri.fsPath.startsWith(workspaceRoot)
        ? { uri: { scheme: 'file', fsPath: workspaceRoot } }
        : undefined;
    },
    createFileSystemWatcher: () => ({ dispose: () => {} }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    onDidSaveTextDocument: () => ({ dispose: () => {} }),
  },
  window: { setStatusBarMessage: () => ({ dispose: () => {} }) },
  languages: {},
  commands: {},
};

type Loader = (request: string, parent: NodeModule, isMain: boolean) => unknown;
const originalLoad = (Module as unknown as { _load: Loader })._load;
(Module as unknown as { _load: Loader })._load = function patchedLoad(
  this: unknown,
  request: string,
  parent: NodeModule,
  isMain: boolean,
) {
  return request === 'vscode' ? vscodeStub : originalLoad.call(this, request, parent, isMain);
};

const { DirectorDocumentLinkProvider } = require('../src/providers/documentLinkProvider') as {
  DirectorDocumentLinkProvider: new (indexes: unknown) => {
    provideDocumentLinks(document: unknown): DocumentLink[];
  };
};
const { DirectorCodeLensProvider } = require('../src/providers/codeLensProvider') as {
  DirectorCodeLensProvider: new (indexes: unknown) => {
    provideCodeLenses(document: unknown): CodeLens[];
    dispose(): void;
  };
};
const { DirectorCompletionProvider } = require('../src/providers/completionProvider') as {
  DirectorCompletionProvider: new (indexes: unknown) => {
    provideCompletionItems(document: unknown, position: unknown): CompletionItem[];
  };
};

function createFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'directr-ext-providers-'));
  const write = (relative: string, content: string) => {
    const filePath = path.join(root, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  };

  write(
    '.director/workflows/release-validate.yaml',
    ['workflow:', '  steps:', '    - id: verify', '      agent: DR-wfsub-source-verifier'].join('\n'),
  );
  write(
    '.director/workflows/code-review.yaml',
    [
      'workflow:',
      '  steps:',
      '    - id: review',
      '      agent: DR-wfsub-source-verifier',
      '    - id: implement',
      '      agent: DR-wfsub-code-implementer',
      '    - id: missing',
      '      agent: DR-wfsub-missing',
    ].join('\n'),
  );
  write('.director/workflows/profiles/source-verifier.yaml', 'name: source-verifier\n');
  write('.director/workflows/profiles/code-implementer.yaml', 'name: code-implementer\n');
  write('.director/workflows/profiles/unused.yaml', 'name: unused\n');
  write('.director/workflows/templates/wfsub-standard.tmpl.md', 'template');
  write(
    '.director/workflows/schema/subagent-profile.schema.json',
    JSON.stringify({
      properties: {
        phase: {
          enum: ['plan', 'review', 'implement', 'execute'],
        },
        tools: {
          items: {
            enum: ['read', 'search', 'edit', 'execute', 'agent', 'web'],
          },
        },
      },
    }),
  );
  write('.github/agents/wfsub-source-verifier.agent.md', 'agent');

  return root;
}

const root = createFixture();
workspaceRoot = root;

const index = buildDirectorIndex(root);
const fakeIndexes = {
  get: () => index,
  onDidChange: () => ({ dispose: () => {} }),
};

function documentAt(relative: string, text?: string) {
  const filePath = path.join(root, relative);
  return {
    uri: { scheme: 'file', fsPath: filePath },
    getText: () => text ?? fs.readFileSync(filePath, 'utf8'),
    lineAt: (line: number) => {
      const content = text ?? fs.readFileSync(filePath, 'utf8');
      return { text: content.split('\n')[line] ?? '' };
    },
    positionAt: (offset: number) => {
      const content = text ?? fs.readFileSync(filePath, 'utf8');
      const before = content.slice(0, offset).split('\n');
      return { line: before.length - 1, character: before[before.length - 1].length };
    },
    getWordRangeAtPosition: () => undefined,
  };
}

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('workflow YAML の agent は profile へリンクし、未解決参照はリンクしない', () => {
  const provider = new DirectorDocumentLinkProvider(fakeIndexes);
  const links = provider.provideDocumentLinks(documentAt('.director/workflows/code-review.yaml'));

  assert.deepEqual(
    links.map((link) => [link.range.startLine, path.basename(link.target.fsPath)]),
    [
      [3, 'source-verifier.yaml'],
      [5, 'code-implementer.yaml'],
    ],
  );
});

test('profile が無い agent は .github/agents の定義へフォールバックする', () => {
  const agentFile = path.join(root, '.github/agents/wfcore-orchestrator.agent.md');
  fs.mkdirSync(path.dirname(agentFile), { recursive: true });
  fs.writeFileSync(agentFile, 'agent', 'utf8');
  const fallbackIndex = buildDirectorIndex(root);

  const provider = new DirectorDocumentLinkProvider({
    get: () => fallbackIndex,
    onDidChange: () => ({ dispose: () => {} }),
  });
  const document = documentAt(
    '.director/workflows/fallback.yaml',
    ['steps:', '  - id: step', '    agent: DR-wfcore-orchestrator'].join('\n'),
  );

  const links = provider.provideDocumentLinks(document);
  assert.equal(links.length, 1);
  assert.equal(path.basename(links[0].target.fsPath), 'wfcore-orchestrator.agent.md');
});

test('workflow YAML は生成済み agent 定義を CodeLens で併記する', () => {
  const provider = new DirectorCodeLensProvider(fakeIndexes);
  const lenses = provider.provideCodeLenses(documentAt('.director/workflows/code-review.yaml'));

  assert.deepEqual(
    lenses.map((lens) => [lens.range.startLine, lens.command.title]),
    [
      [3, '$(file-code) agent: wfsub-source-verifier.agent.md'],
      [5, '$(warning) agent 未生成: wfsub-code-implementer.agent.md'],
      [7, '$(warning) 未解決: DR-wfsub-missing'],
    ],
  );

  provider.dispose();
});

test('profile YAML は呼び出し元が 2 件以上なら CodeLens で列挙する', () => {
  const provider = new DirectorCodeLensProvider(fakeIndexes);
  const lenses = provider.provideCodeLenses(
    documentAt('.director/workflows/profiles/source-verifier.yaml'),
  );

  assert.deepEqual(
    lenses.map((lens) => lens.command.title),
    [
      '$(arrow-left) 呼び出し元: code-review.yaml — review',
      '$(arrow-left) 呼び出し元: release-validate.yaml — verify',
    ],
  );
  assert.deepEqual(
    lenses.map((lens) => {
      const target = lens.command.arguments?.[0];
      assert.ok(target && typeof target === 'object' && 'fsPath' in target && typeof target.fsPath === 'string');
      return path.basename(target.fsPath);
    }),
    ['code-review.yaml', 'release-validate.yaml'],
  );

  provider.dispose();
});

test('profile YAML は呼び出し元が 1 件なら name 行にリンクを張る', () => {
  const provider = new DirectorDocumentLinkProvider(fakeIndexes);
  const links = provider.provideDocumentLinks(
    documentAt('.director/workflows/profiles/code-implementer.yaml'),
  );

  assert.equal(links.length, 1);
  assert.equal(path.basename(links[0].target.fsPath), 'code-review.yaml');
  assert.deepEqual(
    [links[0].range.startLine, links[0].range.startCharacter, links[0].range.endCharacter],
    [0, 6, 6 + 'code-implementer'.length],
  );

  const codeLensProvider = new DirectorCodeLensProvider(fakeIndexes);
  const codeLenses = codeLensProvider.provideCodeLenses(
    documentAt('.director/workflows/profiles/code-implementer.yaml'),
  );
  assert.deepEqual(codeLenses, []);
  codeLensProvider.dispose();
});

test('呼び出し元が無い profile はリンクも CodeLens も出さない', () => {
  const links = new DirectorDocumentLinkProvider(fakeIndexes).provideDocumentLinks(
    documentAt('.director/workflows/profiles/unused.yaml'),
  );
  assert.deepEqual(links, []);
});

test('profile の template は templates 配下の tmpl.md へリンクする', () => {
  const provider = new DirectorDocumentLinkProvider(fakeIndexes);
  const links = provider.provideDocumentLinks(
    documentAt(
      '.director/workflows/profiles/unused.yaml',
      'name: unused\ntemplate: wfsub-standard\n',
    ),
  );

  assert.equal(links.length, 1);
  assert.equal(path.basename(links[0].target.fsPath), 'wfsub-standard.tmpl.md');
  assert.equal(links[0].range.startLine, 1);
});

test('profile の template はファイルが無ければリンクしない', () => {
  const provider = new DirectorDocumentLinkProvider(fakeIndexes);
  const links = provider.provideDocumentLinks(
    documentAt(
      '.director/workflows/profiles/unused.yaml',
      'name: unused\ntemplate: missing-template\n',
    ),
  );

  assert.deepEqual(links, []);
});

test('profile の tools は schema の enum を flow 形式で補完する', () => {
  const provider = new DirectorCompletionProvider(fakeIndexes);
  const items = provider.provideCompletionItems(
    documentAt(
      '.director/workflows/profiles/source-verifier.yaml',
      'name: source-verifier\ntools: [read, se',
    ),
    { line: 1, character: 16 },
  );

  assert.deepEqual(
    items.map((item) => item.label),
    ['read', 'search', 'edit', 'execute', 'agent', 'web'],
  );
});

test('profile の tools は block 形式の各要素でも補完する', () => {
  const provider = new DirectorCompletionProvider(fakeIndexes);
  const items = provider.provideCompletionItems(
    documentAt(
      '.director/workflows/profiles/source-verifier.yaml',
      'name: source-verifier\ntools:\n  - read\n  - ex',
    ),
    { line: 3, character: 6 },
  );

  assert.deepEqual(
    items.map((item) => item.label),
    ['read', 'search', 'edit', 'execute', 'agent', 'web'],
  );
});

test('profile の tools: 直後は有効な flow 配列として挿入する', () => {
  const provider = new DirectorCompletionProvider(fakeIndexes);
  const items = provider.provideCompletionItems(
    documentAt('.director/workflows/profiles/source-verifier.yaml', 'name: source-verifier\ntools: '),
    { line: 1, character: 7 },
  );

  assert.deepEqual(
    items.map((item) => item.insertText),
    ['[read]', '[search]', '[edit]', '[execute]', '[agent]', '[web]'],
  );
});

test('profile の tools 以外の block 配列では補完しない', () => {
  const provider = new DirectorCompletionProvider(fakeIndexes);
  const items = provider.provideCompletionItems(
    documentAt(
      '.director/workflows/profiles/source-verifier.yaml',
      'name: source-verifier\npurpose:\n  - re',
    ),
    { line: 2, character: 6 },
  );

  assert.deepEqual(items, []);
});

test('profile の phase は schema の enum を補完する', () => {
  const provider = new DirectorCompletionProvider(fakeIndexes);
  const items = provider.provideCompletionItems(
    documentAt(
      '.director/workflows/profiles/source-verifier.yaml',
      'name: source-verifier\nphase: rev',
    ),
    { line: 1, character: 10 },
  );

  assert.deepEqual(
    items.map((item) => [item.label, item.detail]),
    [
      ['plan', 'DirectoR profile phase'],
      ['review', 'DirectoR profile phase'],
      ['implement', 'DirectoR profile phase'],
      ['execute', 'DirectoR profile phase'],
    ],
  );
});

test('profile の phase ではないキーには候補を出さない', () => {
  const provider = new DirectorCompletionProvider(fakeIndexes);
  const items = provider.provideCompletionItems(
    documentAt(
      '.director/workflows/profiles/source-verifier.yaml',
      'name: source-verifier\nphase_rationale: rev',
    ),
    { line: 1, character: 20 },
  );

  assert.deepEqual(items, []);
});
