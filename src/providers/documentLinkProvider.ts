import * as path from 'node:path';

import * as vscode from 'vscode';

import { parseAgentReferences, parseProfileName } from '../core/agentReference';
import {
  findWorkflowCallers,
  resolveAgentTarget,
  type LinkTarget,
} from '../core/directorIndex';
import type { DirectorIndexService } from '../indexService';
import { resolveDirectorLocation } from '../location';
import { toRange } from './shared';

export class DirectorDocumentLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private readonly indexes: DirectorIndexService) {}

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const location = resolveDirectorLocation(document);
    if (!location) {
      return [];
    }

    const index = this.indexes.get(location.root);
    const text = document.getText();

    if (location.kind === 'workflow') {
      const links: vscode.DocumentLink[] = [];
      for (const reference of parseAgentReferences(text)) {
        const target = resolveAgentTarget(index, reference.agentId);
        if (!target) {
          continue;
        }
        links.push(createLink(reference.range, target));
      }
      return links;
    }

    const declaration = parseProfileName(text);
    if (!declaration) {
      return [];
    }

    const callers = findWorkflowCallers(index, declaration.name);
    if (callers.length !== 1) {
      return [];
    }

    const [caller] = callers;
    const steps = caller.stepIds.length ? ` (step: ${caller.stepIds.join(', ')})` : '';
    const link = new vscode.DocumentLink(
      toRange(declaration.range),
      vscode.Uri.file(caller.workflow.filePath),
    );
    link.tooltip = `この profile を呼び出す workflow: ${caller.workflow.fileName}${steps}`;
    return [link];
  }
}

function createLink(range: Parameters<typeof toRange>[0], target: LinkTarget): vscode.DocumentLink {
  const link = new vscode.DocumentLink(toRange(range), vscode.Uri.file(target.filePath));
  link.tooltip = `DirectoR ${target.kind === 'profile' ? 'profile' : 'agent'}: ${path.basename(target.filePath)}`;
  return link;
}
