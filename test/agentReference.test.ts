import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  agentFileKey,
  parseAgentReferences,
  parseProfileName,
  profileNameFromAgentId,
} from '../src/core/agentReference';

test('profileNameFromAgentId は DR-wfsub- を除いた profile 名を返す', () => {
  assert.equal(profileNameFromAgentId('DR-wfsub-code-reviewer'), 'code-reviewer');
  assert.equal(profileNameFromAgentId('wfsub-code-reviewer'), 'code-reviewer');
  assert.equal(profileNameFromAgentId('DR-wfcore-orchestrator'), undefined);
  assert.equal(profileNameFromAgentId(''), undefined);
});

test('agentFileKey は DR- を外して小文字化する', () => {
  assert.equal(agentFileKey('DR-wfsub-code-reviewer'), 'wfsub-code-reviewer');
  assert.equal(agentFileKey('DR-wfcore-orchestrator'), 'wfcore-orchestrator');
});

test('parseAgentReferences は入れ子の agent と step id を拾う', () => {
  const text = [
    'workflow:',
    '  steps:',
    '    - id: step-one',
    '      agent: DR-wfsub-workflow-designer',
    '      success:',
    '        routes:',
    '          - id: retry',
    '            agent: "DR-wfsub-workflow-design-reviewer"',
    '        parallel:',
    '          worker:',
    "            agent: 'DR-wfsub-chunk-reviewer'",
    '    - id: step-two',
    '      agent: DR-wfsub-code-reviewer',
  ].join('\n');

  const references = parseAgentReferences(text);

  assert.deepEqual(
    references.map((reference) => [reference.agentId, reference.range.line, reference.stepId]),
    [
      ['DR-wfsub-workflow-designer', 3, 'step-one'],
      ['DR-wfsub-workflow-design-reviewer', 7, 'retry'],
      ['DR-wfsub-chunk-reviewer', 10, 'retry'],
      ['DR-wfsub-code-reviewer', 12, 'step-two'],
    ],
  );

  const first = references[0];
  assert.equal(text.split('\n')[first.range.line].slice(first.range.start, first.range.end), 'DR-wfsub-workflow-designer');
});

test('parseAgentReferences は agent 以外のキーを拾わない', () => {
  const text = ['agents: DR-wfsub-x', '  input: "agent: DR-wfsub-y"', '      agent: DR-wfsub-z # コメント'].join('\n');
  const references = parseAgentReferences(text);

  assert.deepEqual(
    references.map((reference) => reference.agentId),
    ['DR-wfsub-z'],
  );
});

test('parseProfileName はトップレベルの name と位置を返す', () => {
  const text = ['name: workflow-designer', 'description: "x"', '  name: nested'].join('\n');
  const declaration = parseProfileName(text);

  assert.ok(declaration);
  assert.equal(declaration.name, 'workflow-designer');
  assert.deepEqual(declaration.range, { line: 0, start: 6, end: 23 });

  assert.equal(parseProfileName('description: "name: x"'), undefined);
});
