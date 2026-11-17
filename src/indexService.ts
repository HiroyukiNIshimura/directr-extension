import * as vscode from 'vscode';

import { buildDirectorIndex, type DirectorIndex } from './core/directorIndex';
import { resolveDirectorLocation } from './location';

const WATCH_PATTERNS = ['.director/workflows/**', '.github/agents/**'];

/**
 * ルートごとの DirectoR 索引をキャッシュし、ファイル変更時に破棄する。
 */
export class DirectorIndexService implements vscode.Disposable {
  private readonly indexes = new Map<string, DirectorIndex>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];

  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.disposables.push(
      this.changeEmitter,
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.rebuildWatchers();
        this.invalidateAll();
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        const root = folder?.uri.fsPath ?? resolveDirectorLocation(document)?.root;
        this.invalidate(root);
      }),
    );
    this.rebuildWatchers();
  }

  get(root: string): DirectorIndex {
    const cached = this.indexes.get(root);
    if (cached) {
      return cached;
    }
    const index = buildDirectorIndex(root);
    this.indexes.set(root, index);
    return index;
  }

  invalidate(root: string | undefined): void {
    if (!root) {
      this.invalidateAll();
      return;
    }
    if (this.indexes.delete(root)) {
      this.changeEmitter.fire();
    }
  }

  invalidateAll(): void {
    this.indexes.clear();
    this.changeEmitter.fire();
  }

  dispose(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private rebuildWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      for (const pattern of WATCH_PATTERNS) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, pattern),
        );
        const invalidate = () => this.invalidate(folder.uri.fsPath);
        watcher.onDidChange(invalidate);
        watcher.onDidCreate(invalidate);
        watcher.onDidDelete(invalidate);
        this.watchers.push(watcher);
      }
    }
  }
}
