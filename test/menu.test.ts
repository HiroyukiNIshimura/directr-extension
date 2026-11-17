import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('フロー図メニューは workflow 直下の YAML に限定する', () => {
  const manifest: unknown = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
  assert.ok(manifest && typeof manifest === 'object' && 'contributes' in manifest);
  const contributes = manifest.contributes;
  assert.ok(contributes && typeof contributes === 'object' && 'menus' in contributes);
  const menus = contributes.menus;
  assert.ok(menus && typeof menus === 'object' && 'editor/context' in menus);
  const editorMenu = menus['editor/context'];
  assert.ok(Array.isArray(editorMenu));
  const item: unknown = editorMenu.find((entry) => entry.command === 'directr.showWorkflowDiagram');
  assert.ok(item && typeof item === 'object' && 'when' in item && typeof item.when === 'string');
  const match = /^resourceScheme == file && resourcePath =~ \/(.*)\/i$/.exec(item.when);
  assert.ok(match);
  const pattern = new RegExp(match[1], 'i');
  for (const file of ['/repo/.director/workflows/flow.yaml', 'C:\\repo\\.director\\workflows\\flow.yml']) {
    assert.match(file, pattern);
  }
  for (const file of [
    '/repo/.director/workflows/profiles/flow.yaml',
    '/repo/.director/workflows/generated/flow.yaml',
    '/repo/.director/workflows/flow.yaml.bak',
    '/repo/other/flow.yaml',
  ]) {
    assert.doesNotMatch(file, pattern);
  }
});
