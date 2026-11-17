import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';

import {
  buildDirectorIndex,
  classifyDirectorDocument,
  findRootForFile,
  findWorkflowCallers,
  resolveAgentFile,
  resolveAgentTarget,
  resolveProfileAgentFile,
} from '../src/core/directorIndex';

function createFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'directr-ext-'));
  const write = (relative: string, content: string) => {
    const filePath = path.join(root, relative);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  };

  write(
    '.director/workflows/release-validate.yaml',
    ['workflow:', '  steps:', '    - id: verify', '      agent: DR-wfsub-source-verifier'].join('\n'),
  );
  write(
    '.director/workflows/code-review.yaml',
    [
      'workflow:',
      '  steps:',
      '    - id: review',
      '      agent: DR-wfsub-source-verifier',
      '    - id: implement',
      '      agent: DR-wfsub-code-implementer',
    ].join('\n'),
  );
  write(
    '.director/workflows/profiles/source-verifier.yaml',
    ['name: source-verifier', 'description: "検証"'].join('\n'),
  );
  write(
    '.director/workflows/profiles/code-implementer.yaml',
    ['name: code-implementer'].join('\n'),
  );
  write('.director/workflows/profiles/config/ignored.yaml', 'name: ignored\n');
  write('.director/workflows/generated/wfsub-code-implementer.agent.md', 'noise');
  write('.github/agents/wfsub-source-verifier.agent.md', 'agent');
  write('.github/agents/wfcore-orchestrator.agent.md', 'agent');

  return root;
}

const root = createFixture();
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('classifyDirectorDocument は workflows 直下と profiles 直下だけを対象にする', () => {
  const workflow = classifyDirectorDocument(
    path.join(root, '.director/workflows/release-validate.yaml'),
    root,
  );
  assert.equal(workflow?.kind, 'workflow');

  const profile = classifyDirectorDocument(
    path.join(root, '.director/workflows/profiles/source-verifier.yaml'),
    root,
  );
  assert.equal(profile?.kind, 'profile');

  assert.equal(
    classifyDirectorDocument(path.join(root, '.director/workflows/profiles/config/ignored.yaml'), root),
    undefined,
  );
  assert.equal(classifyDirectorDocument(path.join(root, '.director/workflows/README.md'), root), undefined);
  assert.equal(classifyDirectorDocument(path.join(root, 'src/extension.ts'), root), undefined);
});

test('findRootForFile は .director/workflows を持つディレクトリまで遡る', () => {
  assert.equal(findRootForFile(path.join(root, '.director/workflows/profiles/deep/file.yaml')), root);
});

test('buildDirectorIndex は name で profile を索引し generated を候補にしない', () => {
  const index = buildDirectorIndex(root);

  assert.equal(index.profiles.size, 2);
  assert.equal(index.workflows.length, 2);
  assert.equal(index.agentFiles.has('wfsub-code-implementer'), false);
  assert.equal(index.agentFiles.has('wfcore-orchestrator'), true);
});

test('resolveAgentTarget は profile を優先し、無ければ agent 定義にフォールバックする', () => {
  const index = buildDirectorIndex(root);

  assert.deepEqual(resolveAgentTarget(index, 'DR-wfsub-source-verifier'), {
    kind: 'profile',
    filePath: path.join(root, '.director/workflows/profiles/source-verifier.yaml'),
  });

  assert.deepEqual(resolveAgentTarget(index, 'DR-wfsub-code-implementer'), {
    kind: 'profile',
    filePath: path.join(root, '.director/workflows/profiles/code-implementer.yaml'),
  });

  assert.deepEqual(resolveAgentTarget(index, 'DR-wfcore-orchestrator'), {
    kind: 'agent',
    filePath: path.join(root, '.github/agents/wfcore-orchestrator.agent.md'),
  });

  assert.equal(resolveAgentTarget(index, 'DR-wfsub-missing'), undefined);
});

test('resolveAgentFile / resolveProfileAgentFile は .github/agents のファイルを返す', () => {
  const index = buildDirectorIndex(root);

  assert.equal(
    resolveAgentFile(index, 'DR-wfsub-source-verifier'),
    path.join(root, '.github/agents/wfsub-source-verifier.agent.md'),
  );
  assert.equal(
    resolveProfileAgentFile(index, 'source-verifier'),
    path.join(root, '.github/agents/wfsub-source-verifier.agent.md'),
  );
  assert.equal(resolveProfileAgentFile(index, 'code-implementer'), undefined);
});

test('findWorkflowCallers は呼び出し元 workflow と step id を返す', () => {
  const index = buildDirectorIndex(root);

  const callers = findWorkflowCallers(index, 'source-verifier');
  assert.deepEqual(
    callers.map((caller) => [caller.workflow.fileName, caller.stepIds]),
    [
      ['code-review.yaml', ['review']],
      ['release-validate.yaml', ['verify']],
    ],
  );

  assert.deepEqual(
    findWorkflowCallers(index, 'code-implementer').map((caller) => caller.workflow.fileName),
    ['code-review.yaml'],
  );
  assert.deepEqual(findWorkflowCallers(index, 'unknown-profile'), []);
});
