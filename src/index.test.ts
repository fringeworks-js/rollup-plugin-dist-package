import fg from 'fast-glob';
import fs from 'fs-extra';
import path from 'path';
import type { NormalizedOutputOptions } from 'rollup';
import distPackage from './index';

vi.mock('fs-extra', () => ({
  default: {
    readJsonSync: vi.fn(),
    writeJsonSync: vi.fn(),
    ensureDirSync: vi.fn(),
  },
}));

vi.mock('fast-glob', () => ({
  default: {
    globSync: vi.fn(),
  },
}));

const mockFs = vi.mocked(fs);
const mockFg = vi.mocked(fg);

const OUTPUT_DIR = '/test/dist';

function getWrittenPackageJson(): Record<string, unknown> {
  const calls = mockFs.writeJsonSync.mock.calls;
  return calls[calls.length - 1][1] as Record<string, unknown>;
}

function callModuleParsed(
  plugin: ReturnType<typeof distPackage>,
  importedIds: string[],
  dynamicallyImportedIds: string[] = [],
) {
  (plugin.moduleParsed as any)({ importedIds, dynamicallyImportedIds });
}

async function callGenerateBundle(
  plugin: ReturnType<typeof distPackage>,
  outputOptions: Partial<NormalizedOutputOptions> = { dir: OUTPUT_DIR },
) {
  await (plugin.generateBundle as any)(outputOptions, {});
}

describe('distPackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFg.globSync.mockReturnValue([]);
  });

  it('プラグイン名はdist-packageである', () => {
    expect(distPackage().name).toBe('dist-package');
  });

  // -------------------------
  // moduleParsed
  // -------------------------
  describe('moduleParsed', () => {
    it('外部パッケージのimportを収集しgenerateBundle時にフィルタに使われる', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { react: '^18.0.0' },
      });
      callModuleParsed(plugin, ['react']);
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).toMatchObject({
        dependencies: { react: '^18.0.0' },
      });
    });

    it('inputDirパス配下の内部ファイルは収集しない', async () => {
      const inputDir = '/project/src';
      const plugin = distPackage({ inputDir, outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { react: '^18.0.0' },
      });
      callModuleParsed(plugin, [`${inputDir}/utils.ts`]);
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).not.toHaveProperty('dependencies');
    });

    it('\\0始まりの仮想モジュールは収集しない', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { react: '^18.0.0' },
      });
      callModuleParsed(plugin, ['\0virtual-module']);
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).not.toHaveProperty('dependencies');
    });

    it('dynamicallyImportedIdsも収集する', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { lodash: '^4.0.0' },
      });
      callModuleParsed(plugin, [], ['lodash']);
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).toMatchObject({
        dependencies: { lodash: '^4.0.0' },
      });
    });
  });

  // -------------------------
  // generateBundle - content
  // -------------------------
  describe('generateBundle - content', () => {
    it('contentオブジェクトのプロパティが出力に含まれる', async () => {
      const plugin = distPackage({
        outputDir: OUTPUT_DIR,
        content: { version: '2.0.0' },
      });
      mockFs.readJsonSync.mockReturnValue({ version: '1.0.0' });
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).toMatchObject({ version: '2.0.0' });
    });

    it('content関数はorgPackageJsonを受け取り戻り値が出力ベースになる', async () => {
      const plugin = distPackage({
        outputDir: OUTPUT_DIR,
        content: (pkg) => ({ version: `${pkg.version}-dist` }),
      });
      mockFs.readJsonSync.mockReturnValue({ version: '1.0.0' });
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).toMatchObject({ version: '1.0.0-dist' });
    });
  });

  // -------------------------
  // generateBundle - inheritProps
  // -------------------------
  describe('generateBundle - inheritProps', () => {
    it('orgPackageJsonのプロパティがデフォルトのinheritPropsで引き継がれる', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        name: 'my-pkg',
        version: '1.0.0',
        license: 'MIT',
      });
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).toMatchObject({
        name: 'my-pkg',
        version: '1.0.0',
        license: 'MIT',
      });
    });

    it('contentで設定済みのプロパティはorgPackageJsonで上書きされない', async () => {
      const plugin = distPackage({
        outputDir: OUTPUT_DIR,
        content: { version: '2.0.0-override' },
      });
      mockFs.readJsonSync.mockReturnValue({ version: '1.0.0' });
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).toMatchObject({
        version: '2.0.0-override',
      });
    });

    it('カスタムinheritPropsで指定したプロパティのみ引き継がれる', async () => {
      const plugin = distPackage({
        outputDir: OUTPUT_DIR,
        inheritProps: ['name'],
      });
      mockFs.readJsonSync.mockReturnValue({ name: 'my-pkg', version: '1.0.0' });
      await callGenerateBundle(plugin);

      const result = getWrittenPackageJson();
      expect(result).toMatchObject({ name: 'my-pkg' });
      expect(result).not.toHaveProperty('version');
    });
  });

  // -------------------------
  // generateBundle - 依存関係フィルタリング
  // -------------------------
  describe('generateBundle - 依存関係フィルタリング', () => {
    it('importしたdependenciesのみ出力に含まれる', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
      });
      callModuleParsed(plugin, ['react']);
      await callGenerateBundle(plugin);

      const result = getWrittenPackageJson();
      expect(result).toMatchObject({ dependencies: { react: '^18.0.0' } });
      expect(result.dependencies).not.toHaveProperty('lodash');
    });

    it('importしたdevDependenciesはdependenciesとして出力される', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        devDependencies: { typescript: '^5.0.0' },
      });
      callModuleParsed(plugin, ['typescript']);
      await callGenerateBundle(plugin);

      const result = getWrittenPackageJson();
      expect(result).toMatchObject({ dependencies: { typescript: '^5.0.0' } });
      expect(result).not.toHaveProperty('devDependencies');
    });

    it('peerDependenciesはimportに関わらず全て出力に含まれる', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        peerDependencies: { react: '>=17', 'react-dom': '>=17' },
      });
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).toMatchObject({
        peerDependencies: { react: '>=17', 'react-dom': '>=17' },
      });
    });

    it('importしたoptionalDependenciesのみ出力に含まれる', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        optionalDependencies: { 'pkg-a': '^1.0.0', 'pkg-b': '^2.0.0' },
      });
      callModuleParsed(plugin, ['pkg-a']);
      await callGenerateBundle(plugin);

      const result = getWrittenPackageJson();
      expect(result).toMatchObject({
        optionalDependencies: { 'pkg-a': '^1.0.0' },
      });
      expect(result.optionalDependencies).not.toHaveProperty('pkg-b');
    });

    it('dependenciesとdevDependenciesに同じパッケージがある場合は重複しない', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { react: '^18.0.0' },
        devDependencies: { react: '^18.0.0' },
      });
      callModuleParsed(plugin, ['react']);
      await callGenerateBundle(plugin);

      const deps = getWrittenPackageJson().dependencies as Record<
        string,
        string
      >;
      expect(Object.keys(deps).filter((k) => k === 'react')).toHaveLength(1);
    });

    it('サブパスimportは親パッケージ名にマッチする', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { lodash: '^4.0.0' },
      });
      callModuleParsed(plugin, ['lodash/merge']);
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).toMatchObject({
        dependencies: { lodash: '^4.0.0' },
      });
    });

    it('スコープドパッケージのサブパスimportも親パッケージ名にマッチする', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { '@scope/pkg': '^1.0.0' },
      });
      callModuleParsed(plugin, ['@scope/pkg/utils']);
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).toMatchObject({
        dependencies: { '@scope/pkg': '^1.0.0' },
      });
    });
  });

  // -------------------------
  // generateBundle - resolveWorkspaceDeps
  // -------------------------
  describe('generateBundle - resolveWorkspaceDeps', () => {
    function makeWorkspacePlugin(
      specifier: string,
    ): ReturnType<typeof distPackage> {
      const plugin = distPackage({
        outputDir: OUTPUT_DIR,
        resolveWorkspaceDeps: true,
        packagesDir: 'packages',
      });
      mockFg.globSync.mockReturnValue(['packages/pkg-a/package.json']);
      mockFs.readJsonSync.mockImplementation((filePath) => {
        if (filePath === 'packages/pkg-a/package.json') {
          return { name: 'pkg-a', version: '1.2.3' };
        }
        return { dependencies: { 'pkg-a': specifier } };
      });
      callModuleParsed(plugin, ['pkg-a']);
      return plugin;
    }

    async function resolveTest(specifier: string, expected: string) {
      const plugin = makeWorkspacePlugin(specifier);
      await callGenerateBundle(plugin);
      const deps = getWrittenPackageJson().dependencies as Record<
        string,
        string
      >;
      expect(deps['pkg-a']).toBe(expected);
    }

    it('* → 実バージョン', () => resolveTest('*', '1.2.3'));
    it('workspace:* → 実バージョン', () => resolveTest('workspace:*', '1.2.3'));
    it('workspace: → 実バージョン（空レンジ）', () =>
      resolveTest('workspace:', '1.2.3'));
    it('workspace:^ → ^付きバージョン', () =>
      resolveTest('workspace:^', '^1.2.3'));
    it('workspace:~ → ~付きバージョン', () =>
      resolveTest('workspace:~', '~1.2.3'));
    it('workspace:^1.0.0 → ^1.0.0（具体的レンジはそのまま）', () =>
      resolveTest('workspace:^1.0.0', '^1.0.0'));
    it('portal:./local → 実バージョン', () =>
      resolveTest('portal:./local', '1.2.3'));
    it('link:./local → 実バージョン', () =>
      resolveTest('link:./local', '1.2.3'));
  });

  // -------------------------
  // generateBundle - processor
  // -------------------------
  describe('generateBundle - processor', () => {
    it('processorが最終的なpackage.jsonに適用される', async () => {
      const plugin = distPackage({
        outputDir: OUTPUT_DIR,
        processor: (pkg) => ({ ...pkg, custom: 'added' }) as any,
      });
      mockFs.readJsonSync.mockReturnValue({ name: 'my-pkg' });
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).toMatchObject({ custom: 'added' });
    });
  });

  // -------------------------
  // generateBundle - outputDir解決
  // -------------------------
  describe('generateBundle - outputDir解決', () => {
    it('options.outputDirが指定された場合はそこに出力される', async () => {
      const plugin = distPackage({ outputDir: '/custom/dist' });
      mockFs.readJsonSync.mockReturnValue({});
      await callGenerateBundle(plugin, { dir: '/other' });

      expect(mockFs.writeJsonSync.mock.calls[0][0]).toContain(
        path.normalize('/custom/dist'),
      );
    });

    it('outputDirがない場合はoutputOptions.dirが使われる', async () => {
      const plugin = distPackage();
      mockFs.readJsonSync.mockReturnValue({});
      await callGenerateBundle(plugin, { dir: '/from-rollup' });

      expect(mockFs.writeJsonSync.mock.calls[0][0]).toContain(
        path.normalize('/from-rollup'),
      );
    });

    it('dirもない場合はoutputOptions.fileのdirnameが使われる', async () => {
      const plugin = distPackage();
      mockFs.readJsonSync.mockReturnValue({});
      await callGenerateBundle(plugin, { file: '/build/bundle/index.js' });

      expect(mockFs.writeJsonSync.mock.calls[0][0]).toContain(
        path.normalize('/build/bundle'),
      );
    });
  });
});
