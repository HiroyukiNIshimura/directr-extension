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
      ? `<details><summary>診断 ${issues.length} 件（YAML の修正を確認してください）</summary><ul>${issues.map((issue) => `<li>${escapeHtml(issue.message)}</li>`).join('')}</ul></details>`
      : '';
    const startIndex = model.start
      ? model.steps.findIndex((step) => step.id.value === model.start?.value)
      : 0;
    const ordered = [
      ...model.steps.slice(startIndex).map((step, offset) => ({ step, index: startIndex + offset })),
      ...model.steps.slice(0, startIndex).map((step, index) => ({ step, index })),
    ];
    const nodes = ordered.map(({ step, index }, orderIndex) => {
      const successRoutes = step.transitions.filter((transition) => transition.kind === 'success' && transition.route);
      const directSuccess = step.transitions.find((transition) => transition.kind === 'success' && !transition.route);
      const next = ordered[orderIndex + 1]?.step;
      const target = directSuccess?.destination.value ?? (successRoutes.length ? undefined : next?.id.value);
      const failures = step.transitions.filter((transition) => transition.kind === 'failure');
      const dependencyText = step.dependencies.length
        ? step.dependencies.map((dependency) => `<span class="chip dependency">${escapeHtml(dependency.value)}</span>`).join('')
        : '<span class="muted">なし</span>';
      const agentRows = step.agents.map((agent) => `<li>${escapeHtml(agent.value)}</li>`).join('');
      const kindLabel = step.kind === 'parallel'
        ? `parallel${step.parallelPolicy ? ` · ${escapeHtml(step.parallelPolicy)}` : ''}`
        : step.kind === 'chunk'
          ? `chunk${step.chunk?.maxConcurrency ? ` · ${step.chunk.maxConcurrency} parallel` : ''}`
          : 'agent';
      const routeRows = [
        ...(step.successCondition
          ? [`<li><span class="route-success">成功</span><div>${directSuccess ? `<strong>continue → ${escapeHtml(directSuccess.destination.value)}</strong>` : ''}<p>${escapeHtml(step.successCondition)}</p></div></li>`]
          : []),
        ...successRoutes.map((transition) => {
          const source = transition.source ? ` (${escapeHtml(transition.source)})` : '';
          const description = transition.description ? `<p>${escapeHtml(transition.description)}</p>` : '';
          const condition = transition.condition ? `<p>${escapeHtml(transition.condition)}</p>` : '';
          return `<li><span class="route-success">成功 route${source}</span><div><strong>${escapeHtml(transition.label ?? 'route')} · ${escapeHtml(transition.action ?? 'continue')} → ${escapeHtml(transition.destination.value)}</strong>${description}${condition}</div></li>`;
        }),
        ...failures.map((transition) => {
          const source = transition.source ? ` (${escapeHtml(transition.source)})` : '';
          const route = transition.label ? `${escapeHtml(transition.label)} · ` : '';
          const action = transition.action ? `${escapeHtml(transition.action)} → ` : '';
          const description = transition.description ? `<p>${escapeHtml(transition.description)}</p>` : '';
          return `<li><span class="route-failure">失敗${source}</span><div><strong>${route}${action}${escapeHtml(transition.destination.value)}</strong>${description}${transition.condition ? `<p>${escapeHtml(transition.condition)}</p>` : ''}</div></li>`;
        }),
      ].join('');
      const jumpKind = target && target !== next?.id.value ? ' jump' : '';
      const connector = successRoutes.length
        ? `<div class="flow-connector branched"><span>成功分岐: ${successRoutes.length} routes（詳細を展開）</span></div>`
        : target
          ? `<div class="flow-connector${jumpKind}">${directSuccess ? `<span>success jump → ${escapeHtml(target)}</span>` : ''}</div>`
          : '<div class="flow-connector complete"><span>完了</span></div>';
      const metadata = [
        step.phase,
        step.maxVisits ? `max visits ${step.maxVisits}` : '',
        step.chunk?.maxTasks ? `max tasks ${step.chunk.maxTasks}` : '',
      ].filter((value): value is string => Boolean(value))
        .map((value) => `<span class="meta">${escapeHtml(value)}</span>`).join('');
      return `<article class="step-card">
        <div class="step-heading">
          <button class="step-open" type="button" data-step="${index}" aria-label="${escapeHtml(step.id.value)} の YAML を開く">
            <span class="step-id">${escapeHtml(step.id.value)}</span>
            <span class="step-kind">${kindLabel}</span>
          </button>
          ${metadata}
        </div>
        <div class="row"><span class="label">依存</span><div class="chips">${dependencyText}</div></div>
        <div class="agents"><span class="label">担当</span><ul>${agentRows}</ul></div>
        ${routeRows ? `<details class="routes"><summary>判定・経路 (${successRoutes.length + failures.length})</summary><ul>${routeRows}</ul></details>` : ''}
      </article>${connector}`;
    }).join('');
    const limit = model.maxTotalStepExecutions
      ? `<span class="summary-chip">全体上限: ${model.maxTotalStepExecutions} 回</span>`
      : '';
    content = `<p class="hint">線を主経路だけに絞り、依存と失敗経路は各 step 内に整理しています。step 名をクリックすると YAML へ移動します。</p>
      <div class="summary">${limit}<span class="summary-chip">steps: ${model.steps.length}</span></div>
      ${warnings}<div class="flow"><div class="terminal start">開始</div><div class="flow-connector"><span>実行順</span></div>${nodes}<div class="terminal finish">完了</div></div>`;
  }
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
    :root{color-scheme:light dark}
    *{box-sizing:border-box}body{font-family:var(--vscode-font-family, sans-serif);color:var(--vscode-foreground, #24292f);background:var(--vscode-editor-background, #fff);padding:20px;line-height:1.5}
    h2{margin:0 0 4px}.hint,.muted{color:var(--vscode-descriptionForeground, #65707a)}.hint{max-width:760px;margin:0 0 12px}
    details{margin:10px 0}summary{cursor:pointer}.summary{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 18px}.summary-chip,.meta,.chip,.step-kind{display:inline-flex;align-items:center;border-radius:999px;padding:2px 9px;font-size:12px}
    .summary-chip,.meta,.step-kind{background:var(--vscode-badge-background, #e8edf2);color:var(--vscode-badge-foreground, inherit)}
    .flow{max-width:900px;margin:0 auto;display:flex;flex-direction:column;align-items:center}.terminal{min-width:180px;text-align:center;border:1px solid var(--vscode-focusBorder, #5686c0);border-radius:999px;padding:7px 18px;font-weight:600;background:var(--vscode-editorWidget-background, #f6f8fa)}
    .step-card{width:min(760px,100%);border:1px solid var(--vscode-widget-border, #9aa4ad);border-left:4px solid var(--vscode-focusBorder, #5686c0);border-radius:10px;padding:14px 16px;background:var(--vscode-editorWidget-background, #f6f8fa);box-shadow:0 2px 8px #0002}
    .step-heading{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.step-open{appearance:none;border:0;background:none;color:inherit;padding:0;display:flex;align-items:center;gap:9px;cursor:pointer;text-align:left}.step-open:hover .step-id{text-decoration:underline}.step-id{font-weight:700;font-size:16px;overflow-wrap:anywhere}.step-kind{background:#6f42c122;color:var(--vscode-foreground)}
    .row,.agents{display:grid;grid-template-columns:62px 1fr;gap:8px;margin-top:10px}.label{font-size:12px;color:var(--vscode-descriptionForeground, #65707a);font-weight:600}.chips{display:flex;gap:5px;flex-wrap:wrap}.chip{border:1px solid #6688dd66;background:#6688dd18;color:#6688dd}.agents ul{list-style:none;padding:0;margin:0;overflow-wrap:anywhere}.agents li+li{margin-top:3px}
    .routes{border-top:1px solid var(--vscode-widget-border, #9aa4ad66);padding-top:8px}.routes summary{font-size:13px}.routes>ul{list-style:none;padding:0;margin:10px 0 0}.routes>ul>li{display:grid;grid-template-columns:minmax(90px,auto) 1fr;gap:10px;padding:8px 0;border-top:1px solid var(--vscode-widget-border, #9aa4ad33)}.routes>ul>li p{margin:2px 0 0;color:var(--vscode-descriptionForeground, #65707a);font-size:12px}.route-success{color:#2da44e;font-weight:600}.route-failure{color:#cf6a4c;font-weight:600}
    .flow-connector{height:54px;position:relative;display:flex;align-items:center;justify-content:center;color:#2da44e}.flow-connector:before{content:"";position:absolute;top:0;bottom:15px;left:50%;border-left:2px solid currentColor}.flow-connector:after{content:"";position:absolute;bottom:11px;left:calc(50% - 4px);border:5px solid transparent;border-top-color:currentColor;border-bottom:0}.flow-connector span{position:relative;z-index:1;margin-left:160px;background:var(--vscode-editor-background, #fff);border:1px solid #2da44e55;border-radius:999px;padding:2px 8px;font-size:11px}.flow-connector.jump span{color:#b7791f;border-color:#b7791f55}.flow-connector.jump{color:#b7791f}.flow-connector.branched{color:#b7791f}.flow-connector.branched:before{border-left-style:dashed}.flow-connector.branched:after{display:none}.flow-connector.branched span{border-color:#b7791f55}.finish{margin-top:2px}
    @media(max-width:600px){body{padding:12px}.flow-connector span{margin-left:110px}.row,.agents{grid-template-columns:1fr}.routes>ul>li{grid-template-columns:1fr;gap:3px}}
  </style></head><body><h2>${escapeHtml(model.name ?? 'Workflow')}</h2>${content}<script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelectorAll('[data-step]').forEach(node=>node.addEventListener('click',()=>vscode.postMessage({step:Number(node.dataset.step)})));</script></body></html>`;
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
