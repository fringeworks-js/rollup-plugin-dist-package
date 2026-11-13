import fs from 'fs-extra';
import path from 'path';
import type { Plugin } from 'rollup';
import sortPackageJson from 'sort-package-json';
import type { PackageJson } from 'type-fest';

/**
 * オプション
 */
export type DistPackageOptions = {
  /**
   * 元のpackage.jsonから引き継ぐ項目
   * @default ['name', 'version', 'description', 'repository', 'bugs', 'homepage', 'author', 'contributors', 'license', 'type', 'engines', 'keywords', 'sideEffects', 'peerDependenciesMeta']
   */
  inheritProps?: readonly string[];

  /**
   * package.jsonに出力する内容
   * 依存関係の項目に指定したパッケージは、元のpackage.jsonから収集した値より優先する
   */
  content?:
    Partial<PackageJson> | ((packageJson: PackageJson) => Partial<PackageJson>);

  /**
   * 入力元ディレクトリ
   * 未指定の場合はカレントディレクトリ
   */
  inputDir?: string;

  /**
   * 出力先ディレクトリ
   * 未指定の場合はrollupの出力先にアセットとして出力
   */
  outputDir?: string;

  /**
   * ワークスペース内の依存関係を解決しバージョンに置き換えるか
   * @default false
   */
  resolveWorkspaceDeps?: boolean;

  /**
   * ワークスペース内の依存関係を解決しバージョンに置き換える際、\
   * レンジが指定されていなかった場合に付与する記号
   */
  range?: VersionRange | null;

  /**
   * ワークスペースの場合
   * パッケージが置かれているディレクトリのパス(inputDirからの相対パス)
   * @default '..'
   */
  packagesDir?: string;

  /**
   * 出力前の加工処理
   */
  processor?: (packageJson: PackageJson) => PackageJson;
};

/**
 * バージョンのレンジを表す記号
 */
export type VersionRange = '^' | '~';

type Dependencies = Partial<Record<string, string>>;

const WORKSPACE_DEP = /^(?:\*|workspace:.*|portal:.*|link:.*)$/;

/**
 * package.jsonから継承するプロパティのリスト
 */
const INHERIT_PROPS = [
  'name',
  'version',
  'description',
  'repository',
  'bugs',
  'homepage',
  'author',
  'contributors',
  'license',
  'type',
  'engines',
  'keywords',
  'sideEffects',
  'peerDependenciesMeta',
] as const;

/**
 * package.jsonから依存関係として参照するプロパティ
 */
const DEPENDENCIES_PROP_NAMES = [
  { dev: 'dependencies', dist: 'dependencies', filter: true },
  { dev: 'peerDependencies', dist: 'peerDependencies', filter: false },
  { dev: 'optionalDependencies', dist: 'optionalDependencies', filter: true },
  { dev: 'devDependencies', dist: 'dependencies', filter: true },
] as const;

/**
 * 出力するpackage.jsonの依存関係のプロパティ
 */
const DIST_DEPENDENCIES_PROP_NAMES = [
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/**
 * package.jsonを編集しビルド結果のディレクトリに出力するプラグイン
 */
export default function distPackage(options: DistPackageOptions = {}): Plugin {
  const {
    content = {},
    inheritProps = INHERIT_PROPS,
    inputDir = process.cwd(),
    packagesDir = '..',
    outputDir,
    processor = (pkgJson) => pkgJson,
    resolveWorkspaceDeps = false,
    range,
  } = options;
  const inputDirPath = path.resolve(inputDir);
  const packagesDirPath = path.resolve(inputDirPath, packagesDir);
  // モジュールごとのimportしている外部パッケージ名
  // tsdownは複数のビルドでプラグインを共有し並列に実行するため、ビルド開始時にはクリアせず、
  // 再解析されたモジュールは上書き、削除されたモジュールは除去する
  const importsByModule = new Map<string, string[]>();

  return {
    name: 'dist-package',
    moduleParsed(moduleInfo) {
      const packageNames: string[] = [];
      for (const importedId of [
        ...(moduleInfo.importedIds || []),
        ...(moduleInfo.dynamicallyImportedIds || []),
      ]) {
        const packageName = _getPackageName(importedId);
        if (packageName) {
          packageNames.push(packageName);
        }
      }
      importsByModule.set(moduleInfo.id, packageNames);
    },
    watchChange(id, { event }) {
      if (event === 'delete') {
        importsByModule.delete(id);
      }
    },
    // CSS のプラグイン(tsdown の @tsdown/css など)が generateBundle で CSS を出力した後に読むため、後ろで動かす
    generateBundle: {
      order: 'post',
      handler(_outputOptions, bundle) {
        // 出力する CSS の @import も、importしている外部パッケージとして数える
        // (フォントなどのリソースを、利用者のバンドラーに解決させるために残した @import)
        // 削除された CSS が残らないよう、前のビルドの CSS の分を消してから集め直す(同期的に行うので、並列のビルドと混ざらない)
        for (const key of importsByModule.keys()) {
          if (key.startsWith(CSS_ASSET_KEY_PREFIX)) {
            importsByModule.delete(key);
          }
        }
        for (const output of Object.values(bundle)) {
          if (output.type === 'asset' && output.fileName.endsWith('.css')) {
            importsByModule.set(
              `${CSS_ASSET_KEY_PREFIX}${output.fileName}`,
              _getCssImportPackageNames(output.source),
            );
          }
        }

        const imports = new Set<string>();
        for (const packageNames of importsByModule.values()) {
          for (const packageName of packageNames) {
            imports.add(packageName);
          }
        }

        // 開発時用のpackage.jsonを取得
        const orgPackageJson: PackageJson = fs.readJsonSync(
          path.join(inputDirPath, 'package.json'),
          {
            encoding: 'utf8',
          },
        );
        // ビルドされたパッケージ用のpackage.jsonのベースを取得
        const packageJson =
          typeof content === 'function'
            ? content(orgPackageJson)
            : { ...content };

        // ワークスペース内のパッケージのバージョン(必要になった時点で1回だけ取得する)
        let versions: Record<string, string> | undefined;
        const getVersions = () =>
          (versions ??= _getPackageVersions(packagesDirPath));

        // dependencies関連の項目を処理
        // contentで指定したパッケージは収集の対象外にする
        const allDeps = new Set<string>();
        for (const dist of DIST_DEPENDENCIES_PROP_NAMES) {
          for (const pkg of Object.keys(packageJson[dist] ?? {})) {
            allDeps.add(pkg);
          }
        }
        for (const { dev, dist, filter } of DEPENDENCIES_PROP_NAMES) {
          const dependencies = _createDependencies(
            orgPackageJson[dev],
            imports,
            filter,
          );
          const pkgs: Record<string, string> = {};
          for (const [pkg, specifier] of dependencies) {
            if (allDeps.has(pkg)) {
              continue;
            }
            allDeps.add(pkg);
            pkgs[pkg] = resolveWorkspaceDeps
              ? _resolveWorkspaceDependency(
                  pkg,
                  specifier,
                  getVersions,
                  range,
                  (message) => this.warn(message),
                )
              : specifier;
          }
          if (Object.keys(pkgs).length) {
            packageJson[dist] = {
              ...packageJson[dist],
              ...pkgs,
            };
          }
        }

        // 指定のプロパティが未設定で、開発時用のpackage.jsonにあれば設定
        // sideEffects: false などの偽値も引き継ぐため、undefinedかどうかで判定する
        for (const prop of inheritProps) {
          if (
            packageJson[prop] === undefined &&
            orgPackageJson[prop] !== undefined
          ) {
            packageJson[prop] = orgPackageJson[prop];
          }
        }

        const source = `${JSON.stringify(
          sortPackageJson(processor(packageJson as PackageJson)),
          null,
          2,
        )}\n`;

        if (outputDir) {
          // 指定されたディレクトリに出力
          fs.outputFileSync(path.join(outputDir, 'package.json'), source, {
            encoding: 'utf8',
          });
        } else {
          // rollupの出力先にアセットとして出力
          // output.fileの場合もそのディレクトリに出力される
          this.emitFile({ type: 'asset', fileName: 'package.json', source });
        }
      },
    },
  };
}

/**
 * 出力する CSS のimportを、モジュールのimportと同じ表に入れるときのキーの接頭辞
 * (モジュールのIDとぶつからないよう、\0 で始める)
 */
const CSS_ASSET_KEY_PREFIX = '\0css-asset:';

/**
 * URL(スキームで始まるもの・プロトコル相対のもの)
 * Windows のドライブ文字(`C:`)は path.isAbsolute で先に除くので、スキームとして扱ってよい
 */
const URL_LIKE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * CSS の @import の参照先(`@import 'x';`・`@import "x";`・`@import url(x);`・`@import url("x");`)
 */
const CSS_IMPORT = /@import\s+(?:url\(\s*)?(['"]?)([^'"()\s;]+)\1/g;

/**
 * CSS のコメント
 */
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;

/**
 * CSS の @import から、参照しているパッケージ名を取得する
 * パッケージ名で指定されたものだけを対象とする(相対パス・絶対パス・URL は対象外)
 * @param source CSS のソース
 * @returns パッケージ名のリスト
 */
function _getCssImportPackageNames(source: string | Uint8Array): string[] {
  const css = (
    typeof source === 'string' ? source : new TextDecoder().decode(source)
  ).replace(CSS_COMMENT, '');
  const packageNames: string[] = [];
  for (const match of css.matchAll(CSS_IMPORT)) {
    // マッチしたときは必ずグループがある
    const packageName = _getPackageName(match[2]!);
    if (packageName) {
      packageNames.push(packageName);
    }
  }
  return packageNames;
}

/**
 * importしたモジュールのIDからパッケージ名を取得する
 * パッケージ名で指定されたもの(bare specifier)のみを対象とし、
 * 相対パス・絶対パス・\0始まりの仮想モジュールは対象外とする
 * (バンドルされたモジュールと外部モジュールを区別できないため)
 * @param id モジュールのID
 * @returns パッケージ名
 */
function _getPackageName(id: string): string | undefined {
  if (
    id.startsWith('\0') ||
    id.startsWith('.') ||
    path.isAbsolute(id) ||
    // URL(https:・data: など)・プロトコル相対のURL
    URL_LIKE.test(id)
  ) {
    return undefined;
  }
  const tokens = id.split('/');
  return id.startsWith('@') ? tokens.slice(0, 2).join('/') : tokens[0];
}

/**
 * ワークスペース内の依存関係のバージョン指定子を実バージョンに解決する
 * ワークスペース内の依存関係でない場合、パッケージが見つからない場合はそのまま返す
 * @param pkg パッケージ名
 * @param specifier 元のバージョン指定子
 * @param getVersions ワークスペース内のパッケージのバージョンを取得する関数
 * @param range レンジが指定されていなかった場合に付与する記号
 * @param warn 警告を出力する関数
 * @returns 解決後のバージョン文字列
 */
function _resolveWorkspaceDependency(
  pkg: string,
  specifier: string,
  getVersions: () => Record<string, string>,
  range: VersionRange | null | undefined,
  warn: (message: string) => void,
): string {
  if (!WORKSPACE_DEP.test(specifier)) {
    return specifier;
  }
  const version = getVersions()[pkg];
  if (!version) {
    // '*' はワークスペース外のパッケージにも使われるため警告しない
    if (specifier !== '*') {
      warn(
        `"${pkg}": "${specifier}" was not found in the workspace and is output as is.`,
      );
    }
    return specifier;
  }
  return _resolveWorkspaceVersion(specifier, version, range);
}

/**
 * workspace:/portal:/link: のバージョン指定子を実バージョンに解決する
 * 指定子に明示されたレンジを優先し、明示されていない場合のみrangeを付与する
 * @param specifier 元のバージョン指定子
 * @param packageVersion パッケージの実バージョン
 * @param range レンジが指定されていなかった場合に付与する記号
 * @returns 解決後のバージョン文字列
 */
function _resolveWorkspaceVersion(
  specifier: string,
  packageVersion: string,
  range: VersionRange | null | undefined,
): string {
  const wsMatch = specifier.match(/^workspace:(.*)$/);
  // (.*) は必ずマッチする
  const explicitRange = wsMatch ? wsMatch[1]! : '';
  if (explicitRange === '^' || explicitRange === '~') {
    return `${explicitRange}${packageVersion}`;
  }
  if (explicitRange !== '' && explicitRange !== '*') {
    return explicitRange;
  }
  // *, workspace:*, workspace:, portal:, link:
  return `${range ?? ''}${packageVersion}`;
}

/**
 * ディレクトリ配下のパッケージのpackage.jsonのパスを収集する
 * package.jsonがあるディレクトリをパッケージとみなし、その中には潜らない(dist等の出力物を拾わないため)
 * node_modules・ドットで始まるディレクトリ・シンボリックリンクは対象外
 * @param dir 探索するディレクトリのパス
 * @returns package.jsonのパスのリスト
 */
function _findPackageJsonPaths(dir: string): string[] {
  const paths: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.name === 'node_modules' ||
      entry.name.startsWith('.')
    ) {
      continue;
    }
    const subDir = path.join(dir, entry.name);
    const packageJsonPath = path.join(subDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      paths.push(packageJsonPath);
    } else {
      paths.push(..._findPackageJsonPaths(subDir));
    }
  }
  return paths;
}

/**
 * ワークスペース内のパッケージのバージョンを取得する
 * @param packagesDir 他のパッケージが配置されているディレクトリのパス
 * @return パッケージ名をキー、バージョンを値としたレコード
 */
function _getPackageVersions(packagesDir: string) {
  const versions: Record<string, string> = {};
  for (const itemPath of _findPackageJsonPaths(packagesDir)) {
    const { name, version }: PackageJson = fs.readJsonSync(itemPath);
    if (typeof name === 'string' && typeof version === 'string') {
      versions[name] = version;
    }
  }
  return versions;
}

/**
 * パッケージの依存関係を定義した項目を作成する
 * @param orgDependencies 元のpackage.jsonの依存関係
 * @param imports 全ソースのimportしている外部パッケージ名
 * @param filter importしているパッケージのみに絞り込むかどうか
 * @returns パッケージ名とバージョン指定子の組のリスト
 */
function _createDependencies(
  orgDependencies: Dependencies | undefined,
  imports: Set<string>,
  filter: boolean,
): [string, string][] {
  // peerDependenciesはimportフィルタをかけず全て含める(型のみのimportやAPI経由利用のケースがあるため)
  // それ以外はimportしているパッケージのみに絞り込む
  const dependencies: [string, string][] = [];
  for (const [pkg, specifier] of Object.entries(orgDependencies ?? {})) {
    if (specifier !== undefined && (!filter || imports.has(pkg))) {
      dependencies.push([pkg, specifier]);
    }
  }
  return dependencies;
}
