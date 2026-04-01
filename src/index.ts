import fg from 'fast-glob';
import fs from 'fs-extra';
import path from 'path';
import type { NormalizedOutputOptions, OutputBundle, Plugin } from 'rollup';
import sortPackageJson from 'sort-package-json';
import type { PackageJson } from 'type-fest';

/**
 * オプション
 */
export type CreateDistPackageJsonOptions = {
  /**
   * コンテンツ
   */
  content?:
    | Partial<PackageJson>
    | ((packageJson: PackageJson) => Partial<PackageJson>);

  /**
   * 元のpackage.jsonから引き継ぐ項目
   * @default ['name', 'version', 'description', 'repository', 'bugs', 'homepage', 'author', 'contributors', 'license', 'type', 'engines', 'keywords']
   */
  inheritProps?: string[];

  /**
   * 入力元ディレクトリ
   * 未指定の場合はカレントディレクトリ
   */
  inputDir?: string;

  /**
   * ワークスペースの場合
   * パッケージが置かれているディレクトリのパス
   * @default '..'
   */
  packagesDir?: string;

  /**
   * 出力先ディレクトリ
   * 未指定の場合はrollupのoutput設定から取得
   */
  outputDir?: string;

  /**
   * 出力前の加工処理
   */
  processor?: (packageJson: PackageJson) => PackageJson;

  /**
   * ワークスペースの依存関係を保持するかどうか
   * @default false
   */
  keepWorkspaceDeps?: boolean;
};

const WORKSPACE_DEPS = /^(?:\*|workspace:.+|portal:.+)$/;

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
];

/**
 * package.jsonから依存関係として参照するプロパティ
 */
const DEPENDENCIES_PROP_NAMES = [
  { dev: 'dependencies', dist: 'dependencies' },
  { dev: 'peerDependencies', dist: 'peerDependencies' },
  { dev: 'optionalDependencies', dist: 'optionalDependencies' },
  { dev: 'devDependencies', dist: 'dependencies' },
] as const;

/**
 * package.jsonを編集しビルド結果のディレクトリに出力するプラグイン
 */
export default function createDistPackageJson(
  options: CreateDistPackageJsonOptions = {},
): Plugin {
  const {
    content = {},
    inheritProps = INHERIT_PROPS,
    inputDir = process.cwd(),
    packagesDir = '..',
    outputDir,
    processor = (pkgJson) => pkgJson,
    keepWorkspaceDeps = false,
  } = options;
  const imports = new Set<string>();
  const inputDirPath = path.normalize(path.resolve(inputDir));

  return {
    name: 'create-dist-packagejson',
    moduleParsed: (moduleInfo) => {
      const importedIds = moduleInfo.importedIds || [];
      for (const importedId of importedIds) {
        if (
          !importedId.startsWith(inputDirPath) &&
          !inputDirPath.startsWith('_')
        ) {
          // バンドルされるモジュール内でimportしている外部ライブラリを全て取得
          imports.add(importedId);
        }
      }
    },
    generateBundle: async (
      outputOptions: NormalizedOutputOptions,
      bundle: OutputBundle,
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
      for (const { dev, dist } of DEPENDENCIES_PROP_NAMES) {
        const dependencies = _createDependencies(
          orgPackageJson[dev] as Record<string, string>,
          imports,
          packagesDir,
          keepWorkspaceDeps,
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
 * ワークスペース内のパッケージのバージョンを取得する
 * @param packagesDir 他のパッケージが配置されているディレクトリの相対パス
 * @return パッケージ名をキー、バージョンを値としたレコード
 */
function _getPckageVersions(packagesDir: string) {
  const itemPaths = fg.globSync([
    `${packagesDir}/**/package.json`,
    `!${packagesDir}/**/node_modules/**/package.json`,
  ]);
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
 * @param keepWorkspaceDeps ワークスペースの依存関係を保持するかどうか
 * @returns 依存関係
 */
function _createDependencies(
  orgDependencies: Record<string, string>,
  imports: Set<string>,
  packagesDir: string,
  keepWorkspaceDeps: boolean,
) {
  // 全てのimportの中から、開発時用のpackage.jsonのdependenciesに含まれる外部のパッケージを取得
  const dependencies = orgDependencies
    ? _getExternalDependencies(imports, orgDependencies)
    : {};

  if (!keepWorkspaceDeps) {
    // ワークスペース内のdependenciesは実際のバージョンに置き換え
    let versions;
    for (const pkg in dependencies) {
      if (WORKSPACE_DEPS.test(dependencies[pkg])) {
        if (!versions) {
          versions = _getPckageVersions(packagesDir);
        }
        const version = versions[pkg];
        if (version) {
          dependencies[pkg] = version;
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
