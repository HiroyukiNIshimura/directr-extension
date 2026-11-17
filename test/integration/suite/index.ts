import * as assert from 'node:assert';
import * as path from 'node:path';

import * as vscode from 'vscode';

function lensTargetPath(argument: unknown): string {
  const value = argument as { path?: string; fsPath?: string } | undefined;
  return value?.path ?? value?.fsPath ?? '';
}

async function openDocument(workspaceRoot: string, relative: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(path.join(workspaceRoot, relative)),
  );
  await vscode.window.showTextDocument(document);
  return document;
}

export async function run(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspaceRoot, 'DirectoR プロジェクトがワークスペースとして開かれていません');

  const workflow = await openDocument(workspaceRoot, '.director/workflows/release-validate.yaml');
  const workflowLinks =
    (await vscode.commands.executeCommand<vscode.DocumentLink[]>(
      'vscode.executeLinkProvider',
      workflow.uri,
    )) ?? [];
  assert.ok(
    workflowLinks.some((link) =>
      link.target?.fsPath.endsWith(path.join('profiles', 'source-verifier.yaml')),
    ),
    `workflow から profile へのリンクがありません: ${workflowLinks.map((link) => link.target?.fsPath).join(', ')}`,
  );

  const workflowLenses =
    (await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      workflow.uri,
    )) ?? [];
  const lensTargets = workflowLenses.flatMap((lens) =>
    (lens.command?.arguments ?? []).map((argument) => lensTargetPath(argument)),
  );
  assert.ok(
    lensTargets.some((target) => target.endsWith('wfsub-source-verifier.agent.md')),
    `agent 定義への CodeLens がありません: ${workflowLenses.map((lens) => lens.command?.title).join(', ')}`,
  );

  const singleCaller = await openDocument(
    workspaceRoot,
    '.director/workflows/profiles/workflow-designer.yaml',
  );
  const profileLinks =
    (await vscode.commands.executeCommand<vscode.DocumentLink[]>(
      'vscode.executeLinkProvider',
      singleCaller.uri,
    )) ?? [];
  assert.ok(
    profileLinks.some((link) => link.target?.fsPath.endsWith('create-workflow.yaml')),
    `profile から workflow へのリンクがありません: ${profileLinks.map((link) => link.target?.fsPath).join(', ')}`,
  );

  const multiCaller = await openDocument(
    workspaceRoot,
    '.director/workflows/profiles/source-verifier.yaml',
  );
  const profileLenses =
    (await vscode.commands.executeCommand<vscode.CodeLens[]>(
      'vscode.executeCodeLensProvider',
      multiCaller.uri,
    )) ?? [];
  const callerTitles = profileLenses
    .map((lens) => lens.command?.title ?? '')
    .filter((title) => title.includes('呼び出し元'));
  assert.ok(
    callerTitles.length >= 2,
    `呼び出し元の CodeLens が 2 件以上ありません: ${callerTitles.join(', ')}`,
  );
}
