# @fringeworks/rollup-plugin-dist-package

`@fringeworks/rollup-plugin-dist-package` は、インポートパスを整理するためにディストリビューション固有の `package.json` ファイルを生成する、誰かにとっては便利なプラグインです。  
`@fringeworks/rollup-plugin-dist-package` は、Rollup のビルドプロセス中に `package.json` を編集し、  
出力ディレクトリに適切な形式で出力します。  
npmへ公開する`package.json`に最低限の項目のみ出力すること、  
及びフラットなディレクトリ構成でライブラリを公開することへの補助を目的に作成されました。

**[English README is available here](./README.md)**

## インストール

```sh
npm install @fringeworks/rollup-plugin-dist-package --save-dev
```

## 使い方

`rollup.config.js` に以下のように設定してください。

```js
import distPackage from '@fringeworks/rollup-plugin-dist-package';

export default {
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'esm',
  },
  plugins: [
    distPackage({
      content: {
        main: './index.js',
        types: './index.d.ts',
      },
    }),
  ],
};
```

## API

### `distPackage`

```ts
distPackage(options?: DistPackageOptions): Plugin
```

`package.json` を編集し、ビルド結果のディレクトリに出力するプラグインを作成します。

| 引数       | 型                   | 説明             |
| ---------- | -------------------- | ---------------- |
| `options?` | `DistPackageOptions` | 下記のオプション |

| オプション              | 型                                                                             | 説明                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inheritProps?`         | `readonly string[]`                                                            | `content` で未設定の場合に元の `package.json` から引き継ぐプロパティ。`sideEffects: false` のような偽値も引き継ぐ。デフォルト: 下記                        |
| `content?`              | `Partial<PackageJson> \| ((packageJson: PackageJson) => Partial<PackageJson>)` | 生成する `package.json` の内容。依存関係の項目に指定したパッケージは、元の `package.json` から収集した値より優先する                                       |
| `inputDir?`             | `string`                                                                       | 元の `package.json` のあるディレクトリ。デフォルト: カレントディレクトリ                                                                                   |
| `outputDir?`            | `string`                                                                       | `package.json` の出力先ディレクトリ。未指定の場合は Rollup の出力先にアセットとして出力する                                                                |
| `resolveWorkspaceDeps?` | `boolean`                                                                      | `workspace:` / `portal:` / `link:` / `*` 形式のバージョン指定を、ワークスペース内のパッケージの実際のバージョンに置き換える。デフォルト: `false`           |
| `range?`                | `VersionRange \| null`                                                         | `resolveWorkspaceDeps` で置き換える際、レンジが明示されていない指定に付与する記号                                                                          |
| `packagesDir?`          | `string`                                                                       | ワークスペースのパッケージが格納されているディレクトリ（`inputDir` からの相対パス）。`resolveWorkspaceDeps` が `true` のときに参照する。デフォルト: `'..'` |
| `processor?`            | `(packageJson: PackageJson) => PackageJson`                                    | 最終的に `package.json` を出力する前に行う加工処理                                                                                                         |

`inheritProps` のデフォルトは `['name', 'version', 'description', 'repository', 'bugs', 'homepage', 'author', 'contributors', 'license', 'type', 'engines', 'keywords', 'sideEffects', 'peerDependenciesMeta']` です。

#### ワークスペースの依存関係の解決

`resolveWorkspaceDeps: true` のとき、バージョン指定は以下のように置き換えられます（例: パッケージのバージョンが `1.2.3` の場合）。\
指定にレンジが明示されている場合は、`range` よりもそちらを優先します。

| 指定値                              | 置き換え後 | `range: '^'` の場合 |
| ----------------------------------- | ---------- | ------------------- |
| `workspace:*` / `workspace:` / `*`  | `1.2.3`    | `^1.2.3`            |
| `portal:../path` / `link:../path`   | `1.2.3`    | `^1.2.3`            |
| `workspace:^`                       | `^1.2.3`   | `^1.2.3`            |
| `workspace:~`                       | `~1.2.3`   | `~1.2.3`            |
| `workspace:^1.0.0` (明示バージョン) | `^1.0.0`   | `^1.0.0`            |

`packagesDir` にパッケージが見つからない場合は、指定値をそのまま出力し警告を出します（ワークスペース外のパッケージにも使われる `*` は除く）。

### 型

| 型                   | 説明                                   |
| -------------------- | -------------------------------------- |
| `DistPackageOptions` | `distPackage` のオプション             |
| `VersionRange`       | `range` に指定する記号（`'^' \| '~'`） |

## 依存関係の処理について

各依存関係フィールドは以下のルールで dist/package.json に出力されます。

| 開発用フィールド       | dist フィールド        | 対象                             |
| ---------------------- | ---------------------- | -------------------------------- |
| `dependencies`         | `dependencies`         | 実際に import したパッケージのみ |
| `peerDependencies`     | `peerDependencies`     | 全エントリ（フィルタなし）       |
| `optionalDependencies` | `optionalDependencies` | 実際に import したパッケージのみ |
| `devDependencies`      | `dependencies`         | 実際に import したパッケージのみ |

`peerDependencies` だけフィルタなしで全エントリを保持する理由は、`import type` のような型専用 import や、プラグイン API 経由で受け取るだけで直接 import しないケース（例: rollup プラグインが `rollup` 自体を peer に持つ場合）があるためです。

import の検出は、パッケージ名で指定されたモジュール（`react`、`lodash/merge` など）を対象にします。バンドルされたモジュールと外部モジュールを区別できないため、相対パス・絶対パスはパッケージとして扱いません。型定義を同時にビルドする場合（tsdown の `dts: true` など）は、型としてのみ import しているパッケージも含まれます。

## ライセンス

MIT License
