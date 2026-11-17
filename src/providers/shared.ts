import * as vscode from 'vscode';

import type { TextRange } from '../core/agentReference';

export function toRange(range: TextRange): vscode.Range {
  return new vscode.Range(range.line, range.start, range.line, range.end);
}

export function toLineRange(line: number): vscode.Range {
  return new vscode.Range(line, 0, line, 0);
}
