import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';

// activate() の結線（Provider / コマンド / Watcher 登録）を確かめるための最小スタブ
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

const registrations: string[] = [];
const commands = new Map<string, (...args: unknown[]) => unknown>();
const warnings: string[] = [];
const watcherPatterns: string[] = [];

const vscodeStub = {
  EventEmitter,
  Range: class {},
  DocumentLink: class {},
  CodeLens: class {},
  RelativePattern: class {
    constructor(
      public base: unknown,
      public pattern: string,
    ) {
      watcherPatterns.push(pattern);
    }
  },
  Uri: { file: (fsPath: string) => ({ scheme: 'file', fsPath }) },
  languages: {
    registerDocumentLinkProvider: () => {
      registrations.push('documentLink');
      return { dispose: () => {} };
    },
    registerCodeLensProvider: () => {
      registrations.push('codeLens');
      return { dispose: () => {} };
    },
    registerHoverProvider: () => {
      registrations.push('hover');
      return { dispose: () => {} };
    },
    registerCompletionItemProvider: () => {
      registrations.push('completion');
      return { dispose: () => {} };
    },
    createDiagnosticCollection: () => ({
      set: () => {},
      delete: () => {},
      dispose: () => {},
    }),
  },
  commands: {
    registerCommand: (name: string, handler: (...args: unknown[]) => unknown) => {
      commands.set(name, handler);
      registrations.push(`command:${name}`);
      return { dispose: () => commands.delete(name) };
    },
  },
  window: {
    setStatusBarMessage: () => ({ dispose: () => {} }),
    showWarningMessage: (message: string) => {
      warnings.push(message);
      return Promise.resolve(undefined);
    },
  },
  workspace: {
    workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/tmp/directr-root' } }],
    getWorkspaceFolder: (uri: { fsPath: string }) =>
      uri.fsPath.startsWith('/tmp/directr-root')
        ? { uri: { scheme: 'file', fsPath: '/tmp/directr-root' } }
        : undefined,
    createFileSystemWatcher: () => ({
      onDidChange: () => ({ dispose: () => {} }),
      onDidCreate: () => ({ dispose: () => {} }),
      onDidDelete: () => ({ dispose: () => {} }),
      dispose: () => {},
    }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    onDidSaveTextDocument: () => ({ dispose: () => {} }),
    onDidOpenTextDocument: () => ({ dispose: () => {} }),
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
    onDidCloseTextDocument: () => ({ dispose: () => {} }),
    textDocuments: [],
  },
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

const { activate, deactivate } = require('../src/extension') as {
  activate(context: { subscriptions: { dispose(): void }[] }): void;
  deactivate(): void;
};
const { diagramHtml } = require('../src/workflowDiagram') as typeof import('../src/workflowDiagram');
const { parseWorkflow } = require('../src/core/workflowModel') as typeof import('../src/core/workflowModel');

test('activate は Provider と コマンドを登録する', () => {
  const context = { subscriptions: [] as { dispose(): void }[] };
  activate(context);

  assert.deepEqual(registrations, [
    'documentLink',
    'codeLens',
    'hover',
    'completion',
    'command:directr.showWorkflowDiagram',
    'command:directr.refreshIndex',
    'command:directr.showUnresolvedReference',
  ]);
  assert.ok(context.subscriptions.length >= 4);
  assert.deepEqual(watcherPatterns.sort(), ['.director/workflows/**', '.github/agents/**']);
});

test('未解決参照コマンドは想定パスを警告に含める', async () => {
  await commands.get('directr.showUnresolvedReference')?.('DR-wfsub-missing');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /name: missing/);
  assert.match(warnings[0], /\.github\/agents\/wfsub-missing\.agent\.md/);
});

test('deactivate は例外を投げない', () => {
  assert.doesNotThrow(() => deactivate());
});

test('フロー図はカード型で主経路と判定詳細を分けて YAML をエスケープする', () => {
  const model = parseWorkflow(`workflow:
  name: "<unsafe>"
  max_total_step_executions: 10
  steps:
    - id: plan
      depends_on: []
      success:
        routes:
          - id: approve
            description: "承認済み"
            when:
              path: payload.status
              equals: approved
            on_success: continue
            destination: review
      failure:
        condition: "failed"
        destination: abort
    - id: review
      depends_on: [plan]
      success:
        condition: "done"
      failure:
        condition: "failed"
        on_failure: retry
        destination: plan
`);
  const html = diagramHtml(model, 'test-nonce');
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<unsafe>/);
  assert.match(html, /class="step-card"/);
  assert.match(html, /class="chip dependency"/);
  assert.match(html, /class="routes"/);
  assert.match(html, /retry → plan/);
  assert.match(html, /成功分岐: 1 routes/);
  assert.match(html, /payload\.status equals &quot;approved&quot;/);
  assert.match(html, /全体上限: 10 回/);
  assert.match(html, /data-step="1"/);
  assert.doesNotMatch(html, /<svg/);
  assert.match(html, /線を主経路だけに絞り/);
  assert.doesNotMatch(html, /次 → review/);
});
