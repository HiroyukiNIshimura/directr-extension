import * as vscode from 'vscode';
import { getProfileSchema, getWorkflowSchema } from '../core/profileSchema';
import { validateSchema } from '../core/schemaDiagnostics';
import { parseWorkflow, validateWorkflow } from '../core/workflowModel';
import { parseYaml } from '../core/yamlModel';
import { resolveDirectorLocation } from '../location';

export class WorkflowDiagnostics implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('DirectoR');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly subscriptions: vscode.Disposable[];

  constructor() {
    this.subscriptions = [
      vscode.workspace.onDidOpenTextDocument((document) => this.schedule(document)),
      vscode.workspace.onDidChangeTextDocument((event) => this.schedule(event.document)),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.cancel(document.uri.toString());
        this.diagnostics.delete(document.uri);
      }),
    ];
    for (const document of vscode.workspace.textDocuments) this.schedule(document);
  }

  private schedule(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.cancel(key);
    const location = resolveDirectorLocation(document);
    if (!location) {
      this.diagnostics.delete(document.uri);
      return;
    }
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      const text = document.getText();
      const model = location.kind === 'workflow' ? parseWorkflow(text) : undefined;
      const yamlIssues = model
        ? model.errors.map((error) => ({ location: error, message: `YAML: ${error.message}` }))
        : parseYaml(text).errors.map((error) => {
            const start = error.pos[0] ?? 0;
            return {
              location: { start, end: Math.max(start + 1, error.pos[1] ?? start + 1) },
              message: `YAML: ${error.message}`,
            };
          });
      const issues = [
        ...yamlIssues,
        ...(model ? validateWorkflow(model) : []),
        ...validateSchema(
          text,
          location.kind === 'workflow'
            ? getWorkflowSchema(location.root)
            : getProfileSchema(location.root),
        ).map((issue) => ({ location: issue, message: issue.message })),
      ];
      this.diagnostics.set(document.uri, issues.map(({ location, message }) => {
        const range = new vscode.Range(document.positionAt(location.start), document.positionAt(location.end));
        const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = 'DirectoR';
        return diagnostic;
      }));
    }, 200));
  }

  private cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const subscription of this.subscriptions) subscription.dispose();
    this.diagnostics.dispose();
  }
}
