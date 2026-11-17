import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  parseAgentReferences,
  parseProfileName,
  profileNameFromAgentId,
} from '../core/agentReference';
import {
  findWorkflowCallers,
  resolveAgentFile,
} from '../core/directorIndex';
import type { DirectorIndexService } from '../indexService';
import { resolveDirectorLocation } from '../location';
import { toLineRange } from './shared';

export class DirectorCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly subscription: vscode.Disposable;

  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  constructor(private readonly indexes: DirectorIndexService) {
    this.subscription = indexes.onDidChange(() => this.changeEmitter.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const location = resolveDirectorLocation(document);
    if (!location) {
      return [];
    }

    const index = this.indexes.get(location.root);
    const text = document.getText();

    return location.kind === 'workflow'
      ? workflowLenses(index, text)
      : profileLenses(index, text);
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }
}

function workflowLenses(
  index: ReturnType<DirectorIndexService['get']>,
  text: string,
): vscode.CodeLens[] {
  const lenses: vscode.CodeLens[] = [];

  for (const reference of parseAgentReferences(text)) {
    const range = toLineRange(reference.range.line);
    const profileName = profileNameFromAgentId(reference.agentId);
    const hasProfile = profileName !== undefined && index.profiles.has(profileName);
    const agentFile = resolveAgentFile(index, reference.agentId);

    if (hasProfile) {
      // DocumentLink は profile を指すため、生成済み agent 定義は CodeLens で併記する
      const command = agentFile
        ? {
            title: `$(file-code) agent: ${path.basename(agentFile)}`,
            tooltip: agentFile,
            command: 'vscode.open',
            arguments: [vscode.Uri.file(agentFile)],
          }
        : {
            title: `$(warning) agent 未生成: wfsub-${profileName}.agent.md`,
            command: 'directr.showUnresolvedReference',
            arguments: [reference.agentId],
          };
      lenses.push(new vscode.CodeLens(range, command));
      continue;
    }

    if (!agentFile) {
      lenses.push(
        new vscode.CodeLens(range, {
          title: `$(warning) 未解決: ${reference.agentId}`,
          command: 'directr.showUnresolvedReference',
          arguments: [reference.agentId],
        }),
      );
    }
  }

  return lenses;
}

function profileLenses(
  index: ReturnType<DirectorIndexService['get']>,
  text: string,
): vscode.CodeLens[] {
  const declaration = parseProfileName(text);
  if (!declaration) {
    return [];
  }

  const callers = findWorkflowCallers(index, declaration.name);
  if (callers.length <= 1) {
    // 呼び出し元が 1 件のときは DocumentLink が担当する
    return [];
  }

  const range = toLineRange(declaration.range.line);
  return callers.map((caller) => {
    const steps = caller.stepIds.length ? ` — ${caller.stepIds.join(', ')}` : '';
    return new vscode.CodeLens(range, {
      title: `$(arrow-left) 呼び出し元: ${caller.workflow.fileName}${steps}`,
      tooltip: caller.workflow.filePath,
      command: 'vscode.open',
      arguments: [vscode.Uri.file(caller.workflow.filePath)],
    });
  });
}
