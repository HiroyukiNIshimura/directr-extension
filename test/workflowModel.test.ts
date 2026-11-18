import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWorkflow, validateWorkflow } from '../src/core/workflowModel';
import { validateSchema } from '../src/core/schemaDiagnostics';
import { parseProfileInfo } from '../src/core/yamlModel';

const validWorkflow = `workflow:
  name: example
  steps:
    - id: plan
      phase: plan
      agent: DR-wfsub-planner
      max_visits: 2
      depends_on: []
      success: {}
      failure:
        on_failure: abort
        destination: abort
    - id: review
      phase: review
      chunk:
        distributor:
          agent: DR-wfsub-distributor
        parallel:
          worker:
            agent: DR-wfsub-worker
      max_visits: 2
      depends_on:
        - plan
      success: {}
      failure:
        on_failure: abort
        destination: abort
        routes:
          - id: repair
            on_failure: retry
            destination: plan
`;

test('workflow の step と入れ子の agent・依存・遷移を位置付きで解析する', () => {
  const model = parseWorkflow(validWorkflow);
  assert.deepEqual(model.errors, []);
  assert.deepEqual(model.steps.map((step) => step.id.value), ['plan', 'review']);
  assert.deepEqual(model.steps[1].agents.map((agent) => agent.value), ['DR-wfsub-distributor', 'DR-wfsub-worker']);
  assert.deepEqual(model.steps[1].dependencies.map((dep) => validWorkflow.slice(dep.start, dep.end)), ['plan']);
  assert.deepEqual(model.steps[1].transitions.map((transition) => transition.destination.value), ['abort', 'plan']);
  assert.deepEqual(validateWorkflow(model), []);
});

test('未定義・後方依存と未定義遷移、retry の上限不足を診断する', () => {
  const broken = validWorkflow
    .replace('      max_visits: 2\n', '')
    .replace('      depends_on: []', '      depends_on: [review, missing]')
    .replace('destination: plan', 'destination: missing');
  const issues = validateWorkflow(parseWorkflow(broken));
  assert.ok(issues.some((issue) => issue.message.includes('先行 step')));
  assert.ok(issues.some((issue) => issue.message.includes("依存先 step 'missing'")));
  assert.ok(issues.some((issue) => issue.message.includes("遷移先 'missing'")));

  const unbounded = validWorkflow.replace('      max_visits: 2\n', '');
  assert.ok(validateWorkflow(parseWorkflow(unbounded)).some((issue) => issue.message.includes("max_visits") && issue.message.includes('plan')));
});

test('不正な YAML は構文エラーを返し参照診断は行わない', () => {
  const model = parseWorkflow('workflow:\n  steps: [');
  assert.ok(model.errors.length);
  assert.deepEqual(validateWorkflow(model), []);
});

test('profile の情報と artifact 別名を解析する', () => {
  const text = `name: test
description: "説明"
phase: plan
tools: [read, search]
artifacts:
  state: jotai
artifact_sections:
  - artifact: state
`;
  const info = parseProfileInfo(text);
  assert.ok(info);
  assert.equal(info.description, '説明');
  assert.equal(info.phase, 'plan');
  assert.deepEqual(info.tools, ['read', 'search']);
  assert.deepEqual(info.artifacts.map((item) => [text.slice(item.start, item.end), item.value]), [['jotai', 'jotai'], ['state', 'jotai']]);
});

test('schema 違反を位置付きで診断する', () => {
  const text = `name: test
phase: invalid
tools: [read, read]
unknown: true
`;
  const schema = {
    type: 'object',
    required: ['name', 'phase', 'tools', 'intro'],
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      phase: { type: 'string', enum: ['plan', 'review'] },
      tools: {
        type: 'array',
        uniqueItems: true,
        items: { type: 'string', enum: ['read', 'edit'] },
      },
      intro: { type: 'string', minLength: 1 },
    },
  };

  const issues = validateSchema(text, schema);
  assert.ok(issues.some((issue) => issue.message.includes('候補外の値')));
  assert.ok(issues.some((issue) => issue.message.includes('重複')));
  assert.ok(issues.some((issue) => issue.message.includes('スキーマにないキー')));
  assert.ok(issues.some((issue) => issue.message.includes('必須キーがありません: intro')));
  assert.ok(issues.every((issue) => issue.start >= 0 && issue.end > issue.start));
});
