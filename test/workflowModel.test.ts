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

  const forwardRetry = `workflow:
  name: forward-retry
  steps:
    - id: first
      failure:
        on_failure: retry
        destination: third
      depends_on: []
    - id: second
      depends_on: [first]
    - id: third
      depends_on: [second]
`;
  assert.ok(validateWorkflow(parseWorkflow(forwardRetry)).some((issue) =>
    issue.message.includes('未完了') && issue.message.includes('second')));
});

test('success route と構造化 when を位置付きで解析・検証する', () => {
  const text = `workflow:
  name: routes
  steps:
    - id: approve
      success:
        routes:
          - id: revise
            description: 修正経路
            when:
              path: payload.status
              equals: revise
            on_success: retry
            destination: design
      failure:
        condition: failed
        destination: abort
        on_failure: abort
      depends_on: []
    - id: design
      success:
        condition: done
      failure:
        condition: failed
        destination: abort
        on_failure: abort
      depends_on: [approve]
`;
  const model = parseWorkflow(text);
  const route = model.steps[0].transitions.find((transition) => transition.label === 'revise');
  assert.equal(route?.kind, 'success');
  assert.equal(route?.action, 'retry');
  assert.equal(route?.description, '修正経路');
  assert.equal(route?.condition, 'payload.status equals "revise"');
  assert.ok(route?.route);
  assert.deepEqual(validateWorkflow(model), []);

  const broken = parseWorkflow(text.replace('destination: design', 'destination: missing'));
  assert.ok(validateWorkflow(broken).some((issue) => issue.message.includes("遷移先 'missing'")));
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

test('schema の組み合わせ条件と oneOf を診断する', () => {
  const schema = {
    type: 'object',
    properties: {
      agent: { type: 'string' },
      parallel: { type: 'object' },
      failure: {
        type: 'object',
        required: ['destination', 'on_failure'],
        properties: {
          destination: { type: 'string' },
          on_failure: { type: 'string', enum: ['abort', 'retry', 'skip'] },
        },
        allOf: [{
          if: {
            properties: { on_failure: { const: 'abort' } },
            required: ['on_failure'],
          },
          ['th' + 'en']: {
            properties: { destination: { const: 'abort' } },
          },
        }],
      },
      policy: {
        type: 'string',
        oneOf: [
          { const: 'all' },
          { const: 'any' },
          { pattern: '^any\\([1-9][0-9]*\\)$' },
        ],
      },
    },
    allOf: [{
      if: {
        anyOf: [{ required: ['parallel'] }],
      },
      ['th' + 'en']: {
        not: { required: ['agent'] },
      },
      else: {
        required: ['agent'],
      },
    }],
  };

  const invalid = validateSchema(`agent: worker
parallel: {}
failure:
  destination: worker
  on_failure: abort
policy: sometimes
`, schema);
  assert.ok(invalid.some((issue) => issue.message.includes('許可')));
  assert.ok(invalid.some((issue) => issue.message.includes('abort')));
  assert.ok(invalid.some((issue) => issue.message.includes('oneOf')));

  const valid = validateSchema(`parallel: {}
failure:
  destination: abort
  on_failure: abort
policy: any(2)
`, schema);
  assert.deepEqual(valid, []);
});
