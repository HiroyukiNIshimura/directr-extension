import * as vscode from 'vscode';
import { parseWorkflow } from '../core/workflowModel';
import type { DirectorIndexService } from '../indexService';
import { resolveDirectorLocation } from '../location';

export class DirectorCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly indexes: DirectorIndexService) {}

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const location = resolveDirectorLocation(document);
    if (location?.kind !== 'workflow') return [];
    const text = document.getText();
    const before = document.lineAt(position.line).text.slice(0, position.character);
    let key = /^\s*(?:-\s+)?(agent|depends_on|destination|start_step_id)\s*:/.exec(before)?.[1];
    if (!key && /^\s*-\s*[\w-]*$/.test(before)) {
      for (let line = position.line - 1; line >= 0; line -= 1) {
        const previous = document.lineAt(line).text;
        if (/^\s*depends_on\s*:/.test(previous)) { key = 'depends_on'; break; }
        if (!/^\s*-\s*[\w-]+\s*(?:#.*)?$/.test(previous) && previous.trim()) break;
      }
    }
    if (!key) return [];
    const model = parseWorkflow(text);
    const offset = document.offsetAt(position);
    const stepIndex = model.steps.findIndex((step, index) =>
      step.id.start <= offset && (index + 1 === model.steps.length || model.steps[index + 1].id.start > offset));
    let candidates: string[];
    if (key === 'agent') {
      candidates = [...this.indexes.get(location.root).profiles.keys()].map((name) => `DR-wfsub-${name}`);
    } else if (key === 'depends_on') {
      candidates = model.steps.slice(0, Math.max(stepIndex, 0)).map((step) => step.id.value);
    } else {
      candidates = model.steps.map((step) => step.id.value);
      if (key === 'destination' && !insideSuccess(document, position)) candidates.push('abort');
    }
    const range = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_-]+/);
    return [...new Set(candidates)].sort().map((candidate) => {
      const item = new vscode.CompletionItem(candidate, vscode.CompletionItemKind.Reference);
      if (range) item.range = range;
      return item;
    });
  }
}

function insideSuccess(document: vscode.TextDocument, position: vscode.Position): boolean {
  const indent = document.lineAt(position.line).text.match(/^\s*/)?.[0].length ?? 0;
  for (let line = position.line - 1; line >= 0; line -= 1) {
    const text = document.lineAt(line).text;
    if (!text.trim() || /^\s*#/.test(text)) continue;
    const previousIndent = text.match(/^\s*/)?.[0].length ?? 0;
    if (previousIndent >= indent) continue;
    if (/^\s*success\s*:/.test(text)) return true;
    if (/^\s*failure\s*:/.test(text) || /^\s*-\s+id\s*:/.test(text)) return false;
  }
  return false;
}
