import * as path from 'node:path';

import { runTests } from '@vscode/test-electron';

/**
 * 実際の VS Code 拡張ホスト上で DocumentLink / CodeLens を検証する。
 * VSCODE_EXECUTABLE で使用する VS Code を、DIRECTR_TEST_WORKSPACE で対象プロジェクトを差し替えられる。
 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const workspace = process.env.DIRECTR_TEST_WORKSPACE;
  if (!workspace) {
    throw new Error('DIRECTR_TEST_WORKSPACE に .director/workflows を持つプロジェクトを指定してください');
  }

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
    launchArgs: [
      workspace,
      '--disable-extensions',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-gpu',
    ],
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
