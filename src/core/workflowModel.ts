import { isMap, isNode } from 'yaml';
import { entries, field, numberValue, parseYaml, stringAt, stringValue, type LocatedString } from './yamlModel';

export interface Transition {
  destination: LocatedString;
  kind: 'success' | 'failure';
  action?: string;
  label?: string;
  condition?: string;
  description?: string;
  source?: string;
  when?: string;
  route?: boolean;
}

export interface WorkflowStep {
  id: LocatedString;
  phase?: string;
  agents: LocatedString[];
  kind: 'step' | 'parallel' | 'chunk';
  parallelPolicy?: string;
  chunk?: {
    maxConcurrency?: number;
    maxTasks?: number;
  };
  dependencies: LocatedString[];
  transitions: Transition[];
  successCondition?: string;
  failureCondition?: string;
  maxVisits?: number;
}

export interface WorkflowModel {
  name?: string;
  start?: LocatedString;
  maxTotalStepExecutions?: number;
  steps: WorkflowStep[];
  errors: { message: string; start: number; end: number }[];
}

function routeCondition(node: unknown): string | undefined {
  const condition = stringValue(field(node, 'condition'));
  if (condition) return condition;
  const when = field(node, 'when');
  const path = stringValue(field(when, 'path'));
  if (!when || !path) return undefined;
  for (const operator of ['equals', 'not_equals', 'in', 'exists']) {
    const value = field(when, operator);
    if (isNode(value)) return `${path} ${operator} ${JSON.stringify(value.toJSON())}`;
  }
  return path;
}

function failureTransitions(node: unknown, text: string, source?: string): Transition[] {
  const result: Transition[] = [];
  const add = (value: unknown) => {
    const destination = stringAt(field(value, 'destination'), text);
    if (destination) {
      result.push({
        destination,
        kind: 'failure',
        action: stringValue(field(value, 'on_failure')),
        label: stringValue(field(value, 'id')),
        condition: routeCondition(value),
        description: stringValue(field(value, 'description')),
        source,
        route: field(value, 'id') !== undefined,
      });
    }
  };
  add(node);
  for (const route of entries(field(node, 'routes'))) add(route);
  return result;
}

function successTransitions(node: unknown, text: string, source?: string): Transition[] {
  const result: Transition[] = [];
  const destination = stringAt(field(node, 'destination'), text);
  if (destination) {
    result.push({
      destination,
      kind: 'success',
      condition: routeCondition(node),
      source,
    });
  }
  for (const route of entries(field(node, 'routes'))) {
    const routeDestination = stringAt(field(route, 'destination'), text);
    if (!routeDestination) continue;
    result.push({
      destination: routeDestination,
      kind: 'success',
      action: stringValue(field(route, 'on_success')),
      label: stringValue(field(route, 'id')),
      condition: routeCondition(route),
      description: stringValue(field(route, 'description')),
      source,
      route: true,
    });
  }
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
    const parallel = field(node, 'parallel');
    const chunk = field(node, 'chunk');
    const parallelAgents = entries(field(parallel, 'agents'));
    const agents = [
      stringAt(field(node, 'agent'), text),
      ...parallelAgents.map((agent) => stringAt(field(agent, 'agent'), text)),
      stringAt(field(field(chunk, 'distributor'), 'agent'), text),
      stringAt(field(field(field(chunk, 'parallel'), 'worker'), 'agent'), text),
    ].filter((agent): agent is LocatedString => agent !== undefined);
    const dependencies = entries(field(node, 'depends_on'))
      .map((item) => stringAt(item, text))
      .filter((item): item is LocatedString => item !== undefined);
    const transitions = failureTransitions(field(node, 'failure'), text);
    const success = field(node, 'success');
    transitions.unshift(...successTransitions(success, text));
    for (const agent of parallelAgents) {
      const source = stringValue(field(agent, 'id')) ?? stringValue(field(agent, 'agent'));
      transitions.push(...successTransitions(field(agent, 'success'), text, source));
      transitions.push(...failureTransitions(field(agent, 'failure'), text, source));
    }
    steps.push({
      id,
      phase: stringValue(field(node, 'phase')),
      agents,
      kind: parallel ? 'parallel' : chunk ? 'chunk' : 'step',
      parallelPolicy: stringValue(field(parallel, 'transition_policy')),
      chunk: chunk
        ? {
            maxConcurrency: numberValue(field(field(chunk, 'parallel'), 'max_concurrency')),
            maxTasks: numberValue(field(field(chunk, 'distributor'), 'max_tasks')),
          }
        : undefined,
      dependencies,
      transitions,
      successCondition: stringValue(field(success, 'condition')),
      failureCondition: stringValue(field(field(node, 'failure'), 'condition')),
      maxVisits: numberValue(field(node, 'max_visits')),
    });
  }
  return {
    name: stringValue(field(workflow, 'name')),
    start: stringAt(field(workflow, 'start_step_id'), text),
    maxTotalStepExecutions: numberValue(field(workflow, 'max_total_step_executions')),
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
      if (transition.action === 'retry' && target !== undefined && target < index) {
        for (const bounded of [step, model.steps[target]]) {
          if (!Number.isInteger(bounded.maxVisits) || (bounded.maxVisits ?? 0) < 1) {
            issues.push({ location: transition.destination, message: `retry に必要な max_visits が '${bounded.id.value}' にありません。` });
          }
        }
      }
      if (transition.kind === 'failure' && transition.action === 'retry' &&
          target !== undefined && target > index) {
        const unavailable = new Set(model.steps.slice(index, target).map((item) => item.id.value));
        const missing = model.steps[target].dependencies.filter((dependency) => unavailable.has(dependency.value));
        if (missing.length) {
          issues.push({
            location: transition.destination,
            message: `retry 先 '${transition.destination.value}' の依存 step が失敗元から未完了になります: ${missing.map((dependency) => dependency.value).join(', ')}`,
          });
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
