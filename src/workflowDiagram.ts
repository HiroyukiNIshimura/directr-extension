import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { parseWorkflow, validateWorkflow, type WorkflowModel } from './core/workflowModel';
import { resolveDirectorLocation } from './location';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function diagramHtml(model: WorkflowModel, nonce: string): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  let content = '';
  const ids = model.steps.map((step) => step.id.value);
  if (model.errors.length || !model.steps.length || new Set(ids).size !== ids.length || (model.start && !ids.includes(model.start.value))) {
    content = '<p>workflow の step を表示できません。YAML の構文と workflow.steps を確認してください。</p>';
  } else {
    const issues = validateWorkflow(model);
    const warnings = issues.length
      ? `<details><summary>診断 ${issues.length} 件（未解決の参照は図に表示されません）</summary><ul>${issues.map((issue) => `<li>${escapeHtml(issue.message)}</li>`).join('')}</ul></details>`
      : '';
    const height = 200 + model.steps.length * 100;
    const positions = new Map(model.steps.map((step, index) => [step.id.value, 95 + index * 100]));
    const paths: string[] = [];
    const nodes: string[] = [];
    const ordered = [...model.steps];
    const start = model.start ? ordered.findIndex((step) => step.id.value === model.start?.value) : 0;
    if (start > 0) ordered.push(...ordered.splice(0, start));
    const edge = (from: string, to: string | null, kind: string, label: string) => {
      const sourceY = positions.get(from);
      const targetY = to === null ? height - 95 : to === 'abort' && kind === 'failure' ? height - 35 : positions.get(to);
      if (sourceY === undefined || targetY === undefined) return;
      const side = kind === 'dependency' ? 100 : kind === 'failure' ? 850 : 700;
      const x = kind === 'dependency' ? 330 : 670;
      const middleY = (sourceY + targetY) / 2;
      paths.push(`<path class="${kind}" d="M ${x} ${sourceY} C ${side} ${sourceY}, ${side} ${targetY}, ${x} ${targetY}" marker-end="url(#arrow-${kind})"/>`);
      paths.push(`<text class="edge-label ${kind}" x="${side}" y="${middleY - 5}">${escapeHtml(label)}</text>`);
    };
    for (const [index, step] of model.steps.entries()) {
      const y = 95 + index * 100;
      const details = [step.phase, ...step.agents.map((agent) => agent.value)].filter(Boolean).join(' / ');
      const shortDetails = details.length > 48 ? `${details.slice(0, 45)}…` : details;
      nodes.push(`<g class="step" tabindex="0" role="button" aria-label="${escapeHtml(step.id.value)}" data-step="${index}"><title>${escapeHtml(details)}</title><rect x="330" y="${y - 28}" width="340" height="56" rx="8"/><text x="345" y="${y - 3}">${escapeHtml(step.id.value)}</text><text class="details" x="345" y="${y + 17}">${escapeHtml(shortDetails)}</text></g>`);
      for (const dep of step.dependencies) edge(dep.value, step.id.value, 'dependency', '依存');
      for (const transition of step.transitions) {
        edge(step.id.value, transition.destination.value, transition.kind, transition.kind === 'success' ? '成功' : `失敗${transition.label ? `: ${transition.label}` : ''}`);
      }
      if (!step.transitions.some((transition) => transition.kind === 'success')) {
        const orderIndex = ordered.indexOf(step);
        const next = ordered[orderIndex + 1];
        edge(step.id.value, next?.id.value ?? null, 'success', next ? '成功（次）' : '成功（完了）');
      }
    }
    const startY = positions.get(ordered[0].id.value);
    if (startY !== undefined) {
      paths.push(`<path class="success" d="M 500 45 C 760 45, 760 ${startY}, 670 ${startY}" marker-end="url(#arrow-success)"/>`);
    }
    nodes.push('<g class="end"><rect x="330" y="5" width="340" height="40" rx="8"/><text x="345" y="30">開始</text></g>');
    nodes.push(`<g class="end"><rect x="330" y="${height - 117}" width="340" height="45" rx="8"/><text x="345" y="${height - 88}">完了</text></g>`);
    nodes.push(`<g class="end"><rect x="330" y="${height - 57}" width="340" height="45" rx="8"/><text x="345" y="${height - 28}">abort</text></g>`);
    content = `<p>step をクリックすると YAML の定義へ移動します。</p>${warnings}<div class="legend"><span class="dependency">━━ 依存</span> <span class="success">━━ 成功</span> <span class="failure">━━ 失敗・差戻し</span></div><div class="canvas"><svg viewBox="0 0 1000 ${height}" width="1000" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs>${['dependency', 'success', 'failure'].map((kind) => `<marker id="arrow-${kind}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path class="${kind}" d="M 0 0 L 8 4 L 0 8 z"/></marker>`).join('')}</defs>${paths.join('')}${nodes.join('')}</svg></div>`;
  }
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
    body{font-family:var(--vscode-font-family, sans-serif);color:var(--vscode-foreground, #24292f);background:var(--vscode-editor-background, #fff);padding:16px}
    .canvas{overflow:auto} .legend{display:flex;gap:24px} .step{cursor:pointer} .step rect,.end rect{fill:var(--vscode-editorWidget-background, #f6f8fa);stroke:var(--vscode-focusBorder, #5686c0);stroke-width:2}
    text{fill:var(--vscode-foreground, #24292f);font-size:14px}.details{font-size:11px}.edge-label{font-size:11px}
    .legend .dependency{color:#6688dd}.legend .success{color:#32a852}.legend .failure{color:#dd7755}
    path.dependency,path.success,path.failure{fill:none;stroke-width:2} path.dependency{stroke:#6688dd;stroke-dasharray:6 4} path.success{stroke:#32a852} path.failure{stroke:#dd7755}
    text.dependency,marker .dependency{fill:#6688dd} text.success,marker .success{fill:#32a852} text.failure,marker .failure{fill:#dd7755} marker path{stroke:none}
  </style></head><body><h2>${escapeHtml(model.name ?? 'Workflow')}</h2>${content}<script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelectorAll('[data-step]').forEach(node=>{const open=()=>vscode.postMessage({step:Number(node.dataset.step)});node.addEventListener('click',open);node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}})});</script></body></html>`;
}

export function showWorkflowDiagram(document: vscode.TextDocument): void {
  if (resolveDirectorLocation(document)?.kind !== 'workflow') {
    void vscode.window.showWarningMessage('DirectoR: workflow YAML を開いてから実行してください。');
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    'directr.workflowDiagram', 'DirectoR: フロー図', vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  const nonce = randomBytes(16).toString('hex');
  const update = () => { panel.webview.html = diagramHtml(parseWorkflow(document.getText()), nonce); };
  update();
  const change = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.toString() === document.uri.toString()) update();
  });
  const message = panel.webview.onDidReceiveMessage((value: unknown) => {
    if (!value || typeof value !== 'object' || !('step' in value) || typeof value.step !== 'number' || !Number.isInteger(value.step)) return;
    const step = parseWorkflow(document.getText()).steps[value.step];
    if (!step) return;
    const position = document.positionAt(step.id.start);
    void vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(position, position) });
  });
  panel.onDidDispose(() => { change.dispose(); message.dispose(); });
}
