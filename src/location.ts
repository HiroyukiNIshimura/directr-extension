import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  classifyDirectorDocument,
  type DirectorDocumentLocation,
  findRootForFile,
} from './core/directorIndex';

const DIRECTOR_WORKFLOWS_SEGMENT = `${path.sep}.director${path.sep}workflows${path.sep}`;

/**
 * 編集中ドキュメントが DirectoR の対象かを判定する。
 * ワークスペース外のファイルでも `.director/workflows` を上方探索して解決する。
 */
export function resolveDirectorLocation(
  document: vscode.TextDocument,
): DirectorDocumentLocation | undefined {
  if (document.uri.scheme !== 'file') {
    return undefined;
  }

  const filePath = document.uri.fsPath;
  if (!filePath.includes(DIRECTOR_WORKFLOWS_SEGMENT)) {
    return undefined;
  }

  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (folder) {
    const location = classifyDirectorDocument(filePath, folder.uri.fsPath);
    if (location) {
      return location;
    }
  }

  const root = findRootForFile(filePath);
  return root ? classifyDirectorDocument(filePath, root) : undefined;
}
