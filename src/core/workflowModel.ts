import { isMap } from 'yaml';
import { entries, field, numberValue, parseYaml, stringAt, stringValue, type LocatedString } from './yamlModel';

export interface Transition {
  destination: LocatedString;
  kind: 'success' | 'failure';
  action?: string;
  label?: string;
}

export interface WorkflowStep {
  id: LocatedString;
  phase?: string;
  agents: LocatedString[];
  dependencies: LocatedString[];
  transitions: Transition[];
  maxVisits?: number;
}

export interface WorkflowModel {
  name?: string;
  start?: LocatedString;
  steps: WorkflowStep[];
  errors: { message: string; start: number; end: number }[];
}

function failureTransitions(node: unknown, text: string): Transition[] {
  const result: Transition[] = [];
  const add = (value: unknown) => {
    const destination = stringAt(field(value, 'destination'), text);
    if (destination) {
      result.push({
        destination,
        kind: 'failure',
        action: stringValue(field(value, 'on_failure')),
        label: stringValue(field(value, 'id')),
      });
    }
  };
  add(node);
  for (const route of entries(field(node, 'routes'))) add(route);
  return result;
}

export function parseWorkflow(text: string): WorkflowModel {
  const doc = parseYaml(text);
  const errors = doc.errors.map((error) => ({
    message: error.message,
    start: error.pos[0],
    end: Math.max(error.pos[0] + 1, error.pos[1]),
  }));
  const workflow = field(doc.contents, 'workflow');
  const steps: WorkflowStep[] = [];
  for (const node of entries(field(workflow, 'steps'))) {
    if (!isMap(node)) continue;
    const id = stringAt(field(node, 'id'), text);
    if (!id) continue;
    const agents = [
      stringAt(field(node, 'agent'), text),
      ...entries(field(field(node, 'parallel'), 'agents')).map((agent) => stringAt(field(agent, 'agent'), text)),
      stringAt(field(field(field(node, 'chunk'), 'distributor'), 'agent'), text),
      stringAt(field(field(field(field(node, 'chunk'), 'parallel'), 'worker'), 'agent'), text),
    ].filter((agent): agent is LocatedString => agent !== undefined);
    const dependencies = entries(field(node, 'depends_on'))
      .map((item) => stringAt(item, text))
      .filter((item): item is LocatedString => item !== undefined);
    const transitions = failureTransitions(field(node, 'failure'), text);
    const destination = stringAt(field(field(node, 'success'), 'destination'), text);
    if (destination) transitions.unshift({ destination, kind: 'success' });
    for (const agent of entries(field(field(node, 'parallel'), 'agents'))) {
      transitions.push(...failureTransitions(field(agent, 'failure'), text));
    }
    steps.push({
      id,
      phase: stringValue(field(node, 'phase')),
      agents,
      dependencies,
      transitions,
      maxVisits: numberValue(field(node, 'max_visits')),
    });
  }
  return {
    name: stringValue(field(workflow, 'name')),
    start: stringAt(field(workflow, 'start_step_id'), text),
    steps,
    errors,
  };
}

export interface WorkflowIssue {
  location: LocatedString;
  message: string;
}

export function validateWorkflow(model: WorkflowModel): WorkflowIssue[] {
  if (model.errors.length) return [];
  const issues: WorkflowIssue[] = [];
  const positions = new Map<string, number>();
  model.steps.forEach((step, index) => {
    if (positions.has(step.id.value)) {
      issues.push({ location: step.id, message: `step ID '${step.id.value}' が重複しています。` });
    } else positions.set(step.id.value, index);
  });
  if (model.start && !positions.has(model.start.value)) {
    issues.push({ location: model.start, message: `開始 step '${model.start.value}' が見つかりません。` });
  }
  const firstIndex = model.start ? positions.get(model.start.value) ?? 0 : 0;
  if (model.start && model.steps[firstIndex]?.dependencies.length) {
    issues.push({ location: model.start, message: '開始 step の depends_on は空にしてください。' });
  }
  const ordered = [...model.steps.slice(firstIndex), ...model.steps.slice(0, firstIndex)];
  model.steps.forEach((step, index) => {
    for (const dep of step.dependencies) {
      const depIndex = positions.get(dep.value);
      if (depIndex === undefined) {
        issues.push({ location: dep, message: `依存先 step '${dep.value}' が見つかりません。` });
      } else if (depIndex >= index) {
        issues.push({ location: dep, message: `depends_on '${dep.value}' は先行 step を指定してください。` });
      }
    }
    for (const transition of step.transitions) {
      const target = positions.get(transition.destination.value);
      if (target === undefined && !(transition.kind === 'failure' && transition.destination.value === 'abort')) {
        issues.push({ location: transition.destination, message: `遷移先 '${transition.destination.value}' が見つかりません。` });
        continue;
      }
      if (transition.kind === 'failure' && transition.action === 'abort' && transition.destination.value !== 'abort') {
        issues.push({ location: transition.destination, message: 'on_failure: abort の遷移先は abort にしてください。' });
      }
      if (transition.kind === 'failure' && transition.action === 'retry' && target !== undefined && target < index) {
        for (const bounded of [step, model.steps[target]]) {
          if (!Number.isInteger(bounded.maxVisits) || (bounded.maxVisits ?? 0) < 1) {
            issues.push({ location: transition.destination, message: `retry に必要な max_visits が '${bounded.id.value}' にありません。` });
          }
        }
      }
      if (transition.kind === 'success' && target !== undefined) {
        const from = ordered.indexOf(step);
        const to = ordered.indexOf(model.steps[target]);
        if (from === to) issues.push({ location: transition.destination, message: '成功時の遷移先に同じ step は指定できません。' });
        if (to < from) {
          for (const bounded of ordered.slice(to, from + 1)) {
            if (!Number.isInteger(bounded.maxVisits) || (bounded.maxVisits ?? 0) < 1) {
              issues.push({ location: transition.destination, message: `後方遷移に必要な max_visits が '${bounded.id.value}' にありません。` });
            }
          }
        }
      }
    }
  });
  return issues;
}
