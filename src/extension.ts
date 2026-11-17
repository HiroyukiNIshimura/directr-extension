import * as vscode from 'vscode';

import { agentFileKey, profileNameFromAgentId } from './core/agentReference';
import { DirectorIndexService } from './indexService';
import { DirectorCodeLensProvider } from './providers/codeLensProvider';
import { DirectorDocumentLinkProvider } from './providers/documentLinkProvider';
import { DirectorHoverProvider } from './providers/hoverProvider';
import { DirectorCompletionProvider } from './providers/completionProvider';
import { WorkflowDiagnostics } from './providers/diagnostics';
import { showWorkflowDiagram } from './workflowDiagram';

const YAML_SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file', language: 'yaml' },
  { scheme: 'file', pattern: '**/*.yaml' },
  { scheme: 'file', pattern: '**/*.yml' },
];

export function activate(context: vscode.ExtensionContext): void {
  const indexes = new DirectorIndexService();
  const codeLensProvider = new DirectorCodeLensProvider(indexes);

  context.subscriptions.push(
    indexes,
    codeLensProvider,
    vscode.languages.registerDocumentLinkProvider(
      YAML_SELECTOR,
      new DirectorDocumentLinkProvider(indexes),
    ),
    vscode.languages.registerCodeLensProvider(YAML_SELECTOR, codeLensProvider),
    vscode.languages.registerHoverProvider(YAML_SELECTOR, new DirectorHoverProvider(indexes)),
    vscode.languages.registerCompletionItemProvider(YAML_SELECTOR, new DirectorCompletionProvider(indexes), ':', '[', ',', ' '),
    new WorkflowDiagnostics(),
    vscode.commands.registerCommand('directr.showWorkflowDiagram', () => {
      const document = vscode.window.activeTextEditor?.document;
      if (document) showWorkflowDiagram(document);
      else void vscode.window.showWarningMessage('DirectoR: workflow YAML を開いてから実行してください。');
    }),
    vscode.commands.registerCommand('directr.refreshIndex', () => {
      indexes.invalidateAll();
      vscode.window.setStatusBarMessage('DirectoR: インデックスを再読み込みしました', 3000);
    }),
    vscode.commands.registerCommand('directr.showUnresolvedReference', (agentId: unknown) => {
      const id = typeof agentId === 'string' && agentId ? agentId : '';
      const profileName = id ? profileNameFromAgentId(id) : undefined;
      const expected = [
        profileName
          ? `.director/workflows/profiles 配下で name: ${profileName} を持つ YAML`
          : undefined,
        id ? `.github/agents/${agentFileKey(id)}.agent.md` : undefined,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' または ');
      void vscode.window.showWarningMessage(
        `DirectoR: ${id || 'この agent'} の参照先が見つかりません（想定: ${expected}）。`,
      );
    }),
  );
}

export function deactivate(): void {
  // すべて context.subscriptions で破棄される
}
