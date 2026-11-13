import fs from 'fs-extra';
import path from 'path';
import distPackage from './index';

vi.mock('fs-extra', () => ({
  default: {
    readJsonSync: vi.fn(),
    outputFileSync: vi.fn(),
    readdirSync: vi.fn(),
    existsSync: vi.fn(),
  },
}));

const mockFs = vi.mocked(fs);

/**
 * readdirSync/existsSyncが参照する仮想のディレクトリ構成を設定する
 * @param files ファイルのパスのリスト
 * @param symlinks シンボリックリンクとして扱うディレクトリのパスのリスト
 */
function mockFileTree(files: string[], symlinks: string[] = []) {
  const normalized = new Set(files.map((file) => path.resolve(file)));
  mockFs.existsSync.mockImplementation((filePath) =>
    normalized.has(path.resolve(filePath as string)),
  );
  mockFs.readdirSync.mockImplementation(((dir: string) => {
    const prefix = path.resolve(dir) + path.sep;
    const entries = new Map<string, boolean>();
    for (const file of [
      ...normalized,
      ...symlinks.map((link) => path.resolve(link)),
    ]) {
      if (file.startsWith(prefix)) {
        const rest = file.slice(prefix.length).split(path.sep);
        // split の結果は必ず1つ以上ある
        const name = rest[0]!;
        entries.set(name, entries.get(name) || rest.length > 1);
      }
    }
    return [...entries].map(([name, hasChildren]) => {
      const isSymlink = symlinks
        .map((link) => path.resolve(link))
        .includes(path.join(path.resolve(dir), name));
      return {
        name,
        isDirectory: () => hasChildren && !isSymlink,
      };
    });
  }) as any);
}

const OUTPUT_DIR = '/test/dist';

const context = {
  emitFile: vi.fn(),
  warn: vi.fn(),
};

function getWrittenPackageJson(): Record<string, unknown> {
  const calls = mockFs.outputFileSync.mock.calls;
  return JSON.parse(calls[calls.length - 1]![1] as string);
}

let moduleCount = 0;

function callModuleParsed(
  plugin: ReturnType<typeof distPackage>,
  importedIds: string[],
  dynamicallyImportedIds: string[] = [],
  id = `/project/src/module${moduleCount++}.ts`,
) {
  (plugin.moduleParsed as any).call(context, {
    id,
    importedIds,
    dynamicallyImportedIds,
  });
}

function callWatchChange(
  plugin: ReturnType<typeof distPackage>,
  id: string,
  event: 'create' | 'update' | 'delete',
) {
  (plugin.watchChange as any).call(context, id, { event });
}

async function callGenerateBundle(
  plugin: ReturnType<typeof distPackage>,
  bundle: Record<string, unknown> = {},
) {
  await (plugin.generateBundle as any).handler.call(context, {}, bundle);
}

/**
 * 出力の CSS のアセットを作る
 */
function cssAsset(fileName: string, source: string | Uint8Array) {
  return { [fileName]: { type: 'asset', fileName, source } };
}

describe('distPackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileTree([]);
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

    it('相対パス・絶対パスのモジュールは収集しない', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { react: '^18.0.0' },
      });
      callModuleParsed(plugin, [
        './react',
        path.resolve('/project/node_modules/react/index.js'),
      ]);
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
  // generateBundle - CSS の @import
  // -------------------------
  describe('generateBundle - CSS の @import', () => {
    it('出力する CSS の @import で参照したパッケージを、importしたものとして数える', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: {
          'material-symbols': '^0.49.0',
          '@scope/font': '^1.0.0',
          'not-imported': '^1.0.0',
        },
      });
      await callGenerateBundle(plugin, {
        ...cssAsset('font.css', "@import 'material-symbols/outlined.css';"),
        ...cssAsset('scoped.css', '@import "@scope/font/index.css";'),
      });

      const result = getWrittenPackageJson();
      expect(result).toMatchObject({
        dependencies: {
          'material-symbols': '^0.49.0',
          '@scope/font': '^1.0.0',
        },
      });
      expect(result.dependencies).not.toHaveProperty('not-imported');
    });

    it('url() の形と、バイト列のソースも読む', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { a: '^1.0.0', b: '^1.0.0' },
      });
      await callGenerateBundle(plugin, {
        ...cssAsset('a.css', '@import url("a/a.css") screen;'),
        ...cssAsset('b.css', new TextEncoder().encode('@import url(b/b.css);')),
      });

      expect(getWrittenPackageJson()).toMatchObject({
        dependencies: { a: '^1.0.0', b: '^1.0.0' },
      });
    });

    it('相対パス・絶対パス・URL・コメントの中の @import は数えない', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { https: '^1.0.0', commented: '^1.0.0' },
      });
      await callGenerateBundle(
        plugin,
        cssAsset(
          'styles.css',
          [
            "@import './local.css';",
            "@import '/root.css';",
            "@import 'https://fonts.googleapis.com/css2?family=x';",
            "@import '//cdn.example.com/x.css';",
            "/* @import 'commented/x.css'; */",
          ].join('\n'),
        ),
      );

      expect(getWrittenPackageJson()).not.toHaveProperty('dependencies');
    });

    it('CSS 以外のアセットは読まない', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { a: '^1.0.0' },
      });
      await callGenerateBundle(plugin, {
        'notes.txt': {
          type: 'asset',
          fileName: 'notes.txt',
          source: "@import 'a/a.css';",
        },
      });

      expect(getWrittenPackageJson()).not.toHaveProperty('dependencies');
    });

    it('前のビルドの CSS の分は、次のビルドに残らない', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { a: '^1.0.0' },
      });
      await callGenerateBundle(plugin, cssAsset('a.css', "@import 'a/a.css';"));
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).not.toHaveProperty('dependencies');
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

    it('sideEffects: falseのような偽値も引き継がれる', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({ sideEffects: false });
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).toMatchObject({ sideEffects: false });
    });

    it('contentで設定した偽値はorgPackageJsonで上書きされない', async () => {
      const plugin = distPackage({
        outputDir: OUTPUT_DIR,
        content: { sideEffects: false },
      });
      mockFs.readJsonSync.mockReturnValue({ sideEffects: ['*.css'] });
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).toMatchObject({ sideEffects: false });
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

    it('Objectのプロトタイプのプロパティ名にはマッチしない', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { react: '^18.0.0' },
      });
      callModuleParsed(plugin, ['toString', 'constructor']);
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson()).not.toHaveProperty('dependencies');
    });

    it('contentで指定した依存は収集した値より優先される', async () => {
      const plugin = distPackage({
        outputDir: OUTPUT_DIR,
        content: { dependencies: { react: '^19.0.0' } },
      });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
      });
      callModuleParsed(plugin, ['react', 'lodash']);
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson().dependencies).toEqual({
        react: '^19.0.0',
        lodash: '^4.0.0',
      });
    });

    it('contentの別の依存関係の項目にあるパッケージは収集しない', async () => {
      const plugin = distPackage({
        outputDir: OUTPUT_DIR,
        content: { peerDependencies: { react: '>=18' } },
      });
      mockFs.readJsonSync.mockReturnValue({
        devDependencies: { react: '^18.0.0' },
      });
      callModuleParsed(plugin, ['react']);
      await callGenerateBundle(plugin);

      const result = getWrittenPackageJson();
      expect(result).toMatchObject({ peerDependencies: { react: '>=18' } });
      expect(result).not.toHaveProperty('dependencies');
    });
  });

  // -------------------------
  // generateBundle - resolveWorkspaceDeps
  // -------------------------
  describe('generateBundle - resolveWorkspaceDeps', () => {
    function makeWorkspacePlugin(
      specifier: string,
      range?: '^' | '~',
    ): ReturnType<typeof distPackage> {
      const plugin = distPackage({
        outputDir: OUTPUT_DIR,
        resolveWorkspaceDeps: true,
        packagesDir: 'packages',
        range,
      });
      mockFileTree(['packages/pkg-a/package.json']);
      mockFs.readJsonSync.mockImplementation((filePath) => {
        if (filePath === path.resolve('packages', 'pkg-a', 'package.json')) {
          return { name: 'pkg-a', version: '1.2.3' };
        }
        return { dependencies: { 'pkg-a': specifier } };
      });
      callModuleParsed(plugin, ['pkg-a']);
      return plugin;
    }

    async function resolveTest(
      specifier: string,
      expected: string,
      range?: '^' | '~',
    ) {
      const plugin = makeWorkspacePlugin(specifier, range);
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

    describe('range', () => {
      it('* → rangeを付与', () => resolveTest('*', '^1.2.3', '^'));
      it('workspace:* → rangeを付与', () =>
        resolveTest('workspace:*', '^1.2.3', '^'));
      it('workspace: → rangeを付与', () =>
        resolveTest('workspace:', '~1.2.3', '~'));
      it('link:./local → rangeを付与', () =>
        resolveTest('link:./local', '^1.2.3', '^'));
      it('portal:./local → rangeを付与', () =>
        resolveTest('portal:./local', '^1.2.3', '^'));
      it('workspace:~ → 明示されたレンジを優先', () =>
        resolveTest('workspace:~', '~1.2.3', '^'));
      it('workspace:^1.0.0 → 明示されたレンジを優先', () =>
        resolveTest('workspace:^1.0.0', '^1.0.0', '~'));
    });

    it('通常のバージョン指定はそのまま', () => resolveTest('^1.0.0', '^1.0.0'));

    it('ワークスペースに見つからない場合はそのまま出力し警告する', async () => {
      const plugin = distPackage({
        outputDir: OUTPUT_DIR,
        resolveWorkspaceDeps: true,
        packagesDir: 'packages',
      });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { 'pkg-x': 'link:../pkg-x', 'pkg-y': '*' },
      });
      callModuleParsed(plugin, ['pkg-x', 'pkg-y']);
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson().dependencies).toEqual({
        'pkg-x': 'link:../pkg-x',
        'pkg-y': '*',
      });
      // '*' はワークスペース外のパッケージにも使われるため警告しない
      expect(context.warn).toHaveBeenCalledTimes(1);
      expect(context.warn.mock.calls[0]![0]).toContain('pkg-x');
    });

    it('packagesDirはinputDirを基準に解決される', async () => {
      const plugin = distPackage({
        outputDir: OUTPUT_DIR,
        resolveWorkspaceDeps: true,
        inputDir: '/ws/packages/main',
      });
      mockFileTree(['/ws/packages/pkg-a/package.json']);
      mockFs.readJsonSync.mockImplementation((filePath) => {
        if (filePath === path.resolve('/ws/packages/pkg-a/package.json')) {
          return { name: 'pkg-a', version: '1.2.3' };
        }
        return { dependencies: { 'pkg-a': 'link:../pkg-a' } };
      });
      callModuleParsed(plugin, ['pkg-a']);
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson().dependencies).toEqual({
        'pkg-a': '1.2.3',
      });
    });

    it('ワークスペースの探索は1回のビルドで1回だけ行う', async () => {
      const plugin = makeWorkspacePlugin('link:../pkg-a');
      const orgImpl = mockFs.readJsonSync.getMockImplementation()!;
      mockFs.readJsonSync.mockImplementation((filePath) =>
        filePath === path.resolve('package.json')
          ? {
              dependencies: { 'pkg-a': 'link:../pkg-a' },
              optionalDependencies: { 'pkg-b': 'link:../pkg-b' },
              devDependencies: { 'pkg-c': 'link:../pkg-c' },
            }
          : orgImpl(filePath),
      );
      callModuleParsed(plugin, ['pkg-b', 'pkg-c']);
      await callGenerateBundle(plugin);

      expect(mockFs.readdirSync).toHaveBeenCalledTimes(1);
    });

    describe('パッケージの探索', () => {
      async function resolveVersions(
        files: Record<string, { name: string; version: string }>,
        symlinks: string[] = [],
      ) {
        const plugin = distPackage({
          outputDir: OUTPUT_DIR,
          resolveWorkspaceDeps: true,
          packagesDir: 'packages',
        });
        mockFileTree(Object.keys(files), symlinks);
        const packageJsons = new Map(
          Object.entries(files).map(([file, json]) => [
            path.resolve(file),
            json,
          ]),
        );
        mockFs.readJsonSync.mockImplementation(
          (filePath) =>
            packageJsons.get(path.resolve(filePath as string)) ?? {
              dependencies: { 'pkg-a': '*', 'pkg-b': '*' },
            },
        );
        callModuleParsed(plugin, ['pkg-a', 'pkg-b']);
        await callGenerateBundle(plugin);
        return getWrittenPackageJson().dependencies as Record<string, string>;
      }

      it('ネストしたディレクトリのパッケージも見つける', async () => {
        const deps = await resolveVersions({
          'packages/pkg-a/package.json': { name: 'pkg-a', version: '1.0.0' },
          'packages/group/pkg-b/package.json': {
            name: 'pkg-b',
            version: '2.0.0',
          },
        });
        expect(deps).toEqual({ 'pkg-a': '1.0.0', 'pkg-b': '2.0.0' });
      });

      it('パッケージの中(dist等)のpackage.jsonは参照しない', async () => {
        const deps = await resolveVersions({
          'packages/pkg-a/package.json': { name: 'pkg-a', version: '1.0.0' },
          'packages/pkg-a/dist/package.json': {
            name: 'pkg-a',
            version: '0.9.0',
          },
        });
        expect(deps['pkg-a']).toBe('1.0.0');
      });

      it('node_modules・ドットで始まるディレクトリ・シンボリックリンクは探索しない', async () => {
        const deps = await resolveVersions(
          {
            'packages/node_modules/pkg-a/package.json': {
              name: 'pkg-a',
              version: '1.0.0',
            },
            'packages/.cache/pkg-a/package.json': {
              name: 'pkg-a',
              version: '1.0.0',
            },
            'packages/linked/pkg-b/package.json': {
              name: 'pkg-b',
              version: '2.0.0',
            },
          },
          ['packages/linked'],
        );
        expect(deps).toEqual({ 'pkg-a': '*', 'pkg-b': '*' });
      });
    });
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
  // generateBundle - 出力先
  // -------------------------
  describe('generateBundle - 出力先', () => {
    it('outputDirが指定された場合はそこに出力される', async () => {
      const plugin = distPackage({ outputDir: '/custom/dist' });
      mockFs.readJsonSync.mockReturnValue({});
      await callGenerateBundle(plugin);

      expect(mockFs.outputFileSync.mock.calls[0]![0]).toBe(
        path.join('/custom/dist', 'package.json'),
      );
      expect(context.emitFile).not.toHaveBeenCalled();
    });

    it('outputDirがない場合はアセットとして出力される', async () => {
      const plugin = distPackage();
      mockFs.readJsonSync.mockReturnValue({ name: 'my-pkg' });
      await callGenerateBundle(plugin);

      expect(mockFs.outputFileSync).not.toHaveBeenCalled();
      expect(context.emitFile).toHaveBeenCalledWith({
        type: 'asset',
        fileName: 'package.json',
        source: `${JSON.stringify({ name: 'my-pkg' }, null, 2)}
`,
      });
    });
  });

  // -------------------------
  // watchモード
  // -------------------------
  describe('watchモード', () => {
    it('再解析されたモジュールのimportは上書きされる', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
      });
      callModuleParsed(plugin, ['react', 'lodash'], [], '/project/src/a.ts');
      callModuleParsed(plugin, ['react'], [], '/project/src/a.ts');
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson().dependencies).toEqual({
        react: '^18.0.0',
      });
    });

    it('削除されたモジュールのimportは除外される', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
      });
      callModuleParsed(plugin, ['react'], [], '/project/src/a.ts');
      callModuleParsed(plugin, ['lodash'], [], '/project/src/b.ts');
      callWatchChange(plugin, '/project/src/b.ts', 'delete');
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson().dependencies).toEqual({
        react: '^18.0.0',
      });
    });

    it('同じモジュールが複数のビルドで解析されても収集結果は変わらない', async () => {
      const plugin = distPackage({ outputDir: OUTPUT_DIR });
      mockFs.readJsonSync.mockReturnValue({
        dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
      });
      callModuleParsed(plugin, ['react'], [], '/project/src/a.ts');
      callModuleParsed(plugin, ['lodash'], [], '/project/src/a.d.ts');
      callModuleParsed(plugin, ['react'], [], '/project/src/a.ts');
      await callGenerateBundle(plugin);

      expect(getWrittenPackageJson().dependencies).toEqual({
        react: '^18.0.0',
        lodash: '^4.0.0',
      });
    });
  });
});
