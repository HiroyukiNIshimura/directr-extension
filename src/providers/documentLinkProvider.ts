import * as path from 'node:path';

import * as vscode from 'vscode';

import { parseAgentReferences, parseProfileName } from '../core/agentReference';
import {
  findWorkflowCallers,
  resolveAgentTarget,
  type LinkTarget,
} from '../core/directorIndex';
import { parseWorkflow } from '../core/workflowModel';
import { parseProfileInfo } from '../core/yamlModel';
import * as fs from 'node:fs';
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
      const workflow = parseWorkflow(text);
      if (!workflow.errors.length) {
        const steps = new Map(workflow.steps.map((step) => [step.id.value, step.id]));
        const references = [
          ...(workflow.start ? [workflow.start] : []),
          ...workflow.steps.flatMap((step) => [
            ...step.dependencies,
            ...step.transitions.map((transition) => transition.destination),
          ]),
        ];
        for (const reference of references) {
          const target = steps.get(reference.value);
          if (!target) continue;
          const position = document.positionAt(target.start);
          const uri = document.uri.with({ fragment: `L${position.line + 1},${position.character + 1}` });
          const link = new vscode.DocumentLink(
            new vscode.Range(document.positionAt(reference.start), document.positionAt(reference.end)),
            uri,
          );
          link.tooltip = `step: ${reference.value}`;
          links.push(link);
        }
      }
      return links;
    }

    const declaration = parseProfileName(text);
    const links: vscode.DocumentLink[] = [];
    if (declaration) {
      const callers = findWorkflowCallers(index, declaration.name);
      if (callers.length === 1) {
        const [caller] = callers;
        const steps = caller.stepIds.length ? ` (step: ${caller.stepIds.join(', ')})` : '';
        const link = new vscode.DocumentLink(
          toRange(declaration.range),
          vscode.Uri.file(caller.workflow.filePath),
        );
        link.tooltip = `この profile を呼び出す workflow: ${caller.workflow.fileName}${steps}`;
        links.push(link);
      }
    }
    for (const artifact of parseProfileInfo(text)?.artifacts ?? []) {
      if (!artifact.value || artifact.value === '.' || artifact.value === '..' ||
          /[/\\]/.test(artifact.value) || [...artifact.value].some((char) => char.charCodeAt(0) < 32)) continue;
      const directory = path.join(location.root, '.director', 'workflows', 'artifacts');
      const file = ['yaml', 'yml'].map((ext) => path.join(directory, `${artifact.value}.${ext}`))
        .find((candidate) => fs.existsSync(candidate));
      if (!file) continue;
      const link = new vscode.DocumentLink(
        new vscode.Range(document.positionAt(artifact.start), document.positionAt(artifact.end)),
        vscode.Uri.file(file),
      );
      link.tooltip = `artifact: ${artifact.value}`;
      links.push(link);
    }
    return links;
  }
}

function createLink(range: Parameters<typeof toRange>[0], target: LinkTarget): vscode.DocumentLink {
  const link = new vscode.DocumentLink(toRange(range), vscode.Uri.file(target.filePath));
  link.tooltip = `DirectoR ${target.kind === 'profile' ? 'profile' : 'agent'}: ${path.basename(target.filePath)}`;
  return link;
}
