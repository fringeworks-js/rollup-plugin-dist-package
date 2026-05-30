import fg from 'fast-glob';
import fs from 'fs-extra';
import path from 'path';
import type { NormalizedOutputOptions, OutputBundle, Plugin } from 'rollup';
import sortPackageJson from 'sort-package-json';
import type { PackageJson } from 'type-fest';

/**
 * オプション
 */
export type DistPackageOptions = {
  /**
   * 元のpackage.jsonから引き継ぐ項目
   * @default ['name', 'version', 'description', 'repository', 'bugs', 'homepage', 'author', 'contributors', 'license', 'type', 'engines', 'keywords']
   */
  inheritProps?: string[];

  /**
   * package.jsonに出力する内容
   */
  content?:
    | Partial<PackageJson>
    | ((packageJson: PackageJson) => Partial<PackageJson>);

  /**
   * 入力元ディレクトリ
   * 未指定の場合はカレントディレクトリ
   */
  inputDir?: string;

  /**
   * 出力先ディレクトリ
   * 未指定の場合はrollupのoutput設定から取得
   */
  outputDir?: string;

  /**
   * ワークスペース内の依存関係を解決しバージョンに置き換えるか
   * @default false
   */
  resolveWorkspaceDeps?: boolean;

  /**
   * ワークスペースの場合
   * パッケージが置かれているディレクトリのパス
   * @default '..'
   */
  packagesDir?: string;

  /**
   * 出力前の加工処理
   */
  processor?: (packageJson: PackageJson) => PackageJson;
};

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
  } = options;
  const imports = new Set<string>();
  const inputDirPath = path.normalize(path.resolve(inputDir));

  return {
    name: 'dist-package',
    moduleParsed: (moduleInfo) => {
      const importedIds = [
        ...(moduleInfo.importedIds || []),
        ...(moduleInfo.dynamicallyImportedIds || []),
      ];
      for (const importedId of importedIds) {
        if (
          !importedId.startsWith(inputDirPath) &&
          !importedId.startsWith('\0')
        ) {
          // バンドルされるモジュール内でimportしている外部ライブラリを全て取得
          imports.add(importedId);
        }
      }
    },
    generateBundle: async (
      outputOptions: NormalizedOutputOptions,
      _: OutputBundle,
    ) => {
      // 開発時用のpackage.jsonを取得
      const orgPackageJson = fs.readJsonSync(
        path.join(inputDir, 'package.json'),
        {
          encoding: 'utf8',
        },
      );
      // ビルドされたパッケージ用のpackage.jsonのベースを取得
      const packageJson =
        typeof content === 'function'
          ? content(orgPackageJson)
          : { ...content };

      // dependencies関連の項目を処理
      const allDeps = new Set<string>();
      for (const { dev, dist, filter } of DEPENDENCIES_PROP_NAMES) {
        const dependencies = _createDependencies(
          orgPackageJson[dev] as Record<string, string>,
          imports,
          packagesDir,
          resolveWorkspaceDeps,
          filter,
        );
        if (dependencies) {
          const pkgs: Record<string, string> = {};
          for (const pkg in dependencies) {
            if (!allDeps.has(pkg)) {
              pkgs[pkg] = dependencies[pkg];
              allDeps.add(pkg);
            }
          }
          if (Object.keys(pkgs).length) {
            packageJson[dist] = {
              ...packageJson[dist],
              ...pkgs,
            };
          }
        }
      }

      // 指定のプロパティが未設定で、開発時用のpackage.jsonにあれば設定
      if (inheritProps) {
        for (const prop of inheritProps) {
          if (!packageJson[prop] && orgPackageJson[prop]) {
            packageJson[prop] = orgPackageJson[prop];
          }
        }
      }

      // ビルド先に出力
      const outputPath =
        outputDir || outputOptions.dir || path.dirname(outputOptions.file!);
      fs.ensureDirSync(outputPath);
      fs.writeJsonSync(
        path.join(outputPath, 'package.json'),
        sortPackageJson(processor(packageJson as PackageJson)),
        {
          encoding: 'utf8',
          spaces: 2,
        },
      );
    },
  };
}

/**
 * workspace:/portal:/link: のバージョン指定子を実バージョンに解決する
 * @param specifier 元のバージョン指定子
 * @param packageVersion パッケージの実バージョン
 * @returns 解決後のバージョン文字列
 */
function _resolveWorkspaceVersion(
  specifier: string,
  packageVersion: string,
): string {
  if (specifier === '*') {
    return packageVersion;
  }

  const wsMatch = specifier.match(/^workspace:(.*)$/);
  if (wsMatch) {
    const range = wsMatch[1];
    if (range === '*' || range === '') {
      return packageVersion;
    }
    if (range === '^' || range === '~') {
      return `${range}${packageVersion}`;
    }
    return range;
  }

  // portal:, link:
  return packageVersion;
}

/**
 * ワークスペース内のパッケージのバージョンを取得する
 * @param packagesDir 他のパッケージが配置されているディレクトリの相対パス
 * @return パッケージ名をキー、バージョンを値としたレコード
 */
function _getPckageVersions(packagesDir: string) {
  const itemPaths = fg.globSync(`${packagesDir}/**/package.json`, {
    ignore: ['**/node_modules/**'],
  });
  const versions: Record<string, string> = {};
  for (const itemPath of itemPaths) {
    const packageJson = fs.readJsonSync(itemPath);
    versions[packageJson.name] = packageJson.version;
  }
  return versions;
}

/**
 * パッケージの依存関係を定義した項目を作成する
 * @param orgDependencies 元のpackage.jsonの依存関係
 * @param imports 全ソースの外部ライブラリへのimport情報
 * @param packagesDir ワークスページのパッケージの保存先ディレクトリ
 * @param resolveWorkspaceDeps ワークスペースの依存関係を解決するかどうか
 * @returns 依存関係
 */
function _createDependencies(
  orgDependencies: Record<string, string>,
  imports: Set<string>,
  packagesDir: string,
  resolveWorkspaceDeps: boolean,
  filter: boolean,
) {
  // peerDependenciesはimportフィルタをかけず全て含める(型のみのimportやAPI経由利用のケースがあるため)
  // それ以外はimportしているパッケージのみに絞り込む
  const dependencies = orgDependencies
    ? filter
      ? _getExternalDependencies(imports, orgDependencies)
      : { ...orgDependencies }
    : {};

  if (resolveWorkspaceDeps) {
    // ワークスペース内のdependenciesは実際のバージョンに置き換え
    let versions;
    for (const pkg in dependencies) {
      if (WORKSPACE_DEP.test(dependencies[pkg])) {
        if (!versions) {
          versions = _getPckageVersions(packagesDir);
        }
        const version = versions[pkg];
        if (version) {
          dependencies[pkg] = _resolveWorkspaceVersion(
            dependencies[pkg],
            version,
          );
        }
      }
    }
  }

  // dependenciesを返す
  if (Object.keys(dependencies).length) {
    return dependencies;
  } else {
    return undefined;
  }
}

/**
 * 各ソースコードのimportの情報を基に\
 * 外部パッケージのみのdependenciesを取得する
 * @param imports importの情報
 * @param orgDependencies 元のpackage.jsonのdependencies
 * @return 外部パッケージのみのdependencies
 */
function _getExternalDependencies(
  imports: Set<string>,
  orgDependencies: Record<string, string>,
) {
  const dependencies: Record<string, string> = {};
  imports.forEach((item) => {
    const tokens = item.split(/[/\\]/);
    for (let i = tokens.length; 0 < i; i--) {
      const pkg = tokens.slice(0, i).join('/');
      if (pkg in orgDependencies) {
        dependencies[pkg] = orgDependencies[pkg];
        break;
      }
    }
  });
  return dependencies;
}
