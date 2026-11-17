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
  const extension = vscode.extensions.getExtension('j69.directr-workflow-links');
  const editorMenu: unknown = extension?.packageJSON?.contributes?.menus?.['editor/context'];
  assert.ok(
    Array.isArray(editorMenu) && editorMenu.some((item) => item.command === 'directr.showWorkflowDiagram'),
    'フロー図コマンドのエディターメニューが登録されていません',
  );

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

  const createWorkflow = await openDocument(workspaceRoot, '.director/workflows/create-workflow.yaml');
  const createText = createWorkflow.getText();
  const dependencyPosition = createWorkflow.positionAt(createText.indexOf('depends_on: [read-questionnaire]') + 'depends_on: ['.length);
  const stepLinks = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', createWorkflow.uri);
  const dependencyLink = stepLinks?.find((link) => link.range.contains(dependencyPosition) && link.target?.fragment.startsWith('L'));
  assert.ok(dependencyLink?.target, 'depends_on の step リンクがありません');
  await vscode.commands.executeCommand('vscode.open', dependencyLink.target);
  assert.equal(vscode.window.activeTextEditor?.selection.active.line, createWorkflow.positionAt(createText.indexOf('id: read-questionnaire')).line);

  const agentPosition = createWorkflow.positionAt(createText.indexOf('DR-wfsub-workflow-designer') + 4);
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', createWorkflow.uri, agentPosition);
  assert.ok(hovers?.some((hover) => hover.contents.some((content) =>
    typeof content !== 'string' && 'value' in content && content.value.includes('workflow-designer'))), 'profile のホバーがありません');
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', createWorkflow.uri, agentPosition);
  assert.ok(completions?.items.some((item) => item.label === 'DR-wfsub-workflow-designer'), 'agent の補完候補がありません');
  const dependencies = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', createWorkflow.uri, dependencyPosition);
  assert.ok(dependencies?.items.some((item) => item.label === 'read-questionnaire'), '依存先の補完候補がありません');

  const artifactProfile = await openDocument(workspaceRoot, '.director/workflows/profiles/workflow-artifacts-author.yaml');
  const artifactLinks = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', artifactProfile.uri);
  assert.ok(artifactLinks?.some((link) => link.target?.fsPath.endsWith(path.join('artifacts', 'jotai.yaml'))), 'artifact リンクがありません');

  await vscode.window.showTextDocument(createWorkflow);
  await vscode.commands.executeCommand('directr.showWorkflowDiagram');

  const edit = new vscode.WorkspaceEdit();
  edit.replace(createWorkflow.uri, new vscode.Range(dependencyPosition, dependencyPosition.translate(0, 'read-questionnaire'.length)), 'missing-step-for-test');
  assert.ok(await vscode.workspace.applyEdit(edit));
  try {
    let found = false;
    for (let attempt = 0; attempt < 30 && !found; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      found = vscode.languages.getDiagnostics(createWorkflow.uri).some((diagnostic) =>
        diagnostic.source === 'DirectoR' && diagnostic.message.includes('missing-step-for-test'));
    }
    assert.ok(found, '存在しない依存先の診断がありません');
  } finally {
    const restore = new vscode.WorkspaceEdit();
    restore.replace(createWorkflow.uri, new vscode.Range(createWorkflow.positionAt(0), createWorkflow.positionAt(createWorkflow.getText().length)), createText);
    assert.ok(await vscode.workspace.applyEdit(restore));
  }
}
