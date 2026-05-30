# @niche-works/rollup-plugin-dist-package

インポートパスを整理するために、ディストリビューション固有の `package.json` ファイルを生成するニッチなプラグインです。
`@niche-works/rollup-plugin-dist-package` は、Rollup のビルドプロセス中に `package.json` を編集し、  
出力ディレクトリに適切な形式で出力します。  
npmへ公開する`package.json`に最低限の項目のみ出力すること、  
及びフラットなディレクトリ構成でライブラリを公開することへの補助を目的に作成されました。

**[English README is available here](./README.md)**

## インストール

```sh
npm install @niche-works/rollup-plugin-dist-package --save-dev
```

## 使い方

`rollup.config.js` に以下のように設定してください。

```js
import distPackage from '@niche-works/rollup-plugin-dist-package';

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

## オプション

### `content`

- `Partial<PackageJson>` または `(packageJson: PackageJson) => Partial<PackageJson>`
- 生成する `package.json` の内容を指定できます。

### `inheritProps`

- `string[]`
- 元の `package.json` から継承するプロパティを指定します。
- デフォルト: `['name', 'version', 'description', 'repository', 'bugs', 'homepage', 'author', 'contributors', 'license', 'type', 'engines', 'keywords', 'sideEffects', 'peerDependenciesMeta']`

### `inputDir`

- `string | undefined`
- 元の `package.json` のあるディレクトリを指定します。
- デフォルト: カレントディレクトリ

### `packagesDir`

- `string | undefined`
- ワークスペースのパッケージが格納されているディレクトリのパスを指定します。
- `resolveWorkspaceDeps` が `true` のときに参照されます。
- デフォルト: `'..'`

### `outputDir`

- `string | undefined`
- `package.json` の出力先ディレクトリを指定します。
- デフォルト: `rollup` の `output` 設定から取得

### `resolveWorkspaceDeps`

- `boolean`
- `true` にすると、各依存関係フィールド内の `workspace:` / `portal:` / `link:` 形式のバージョン指定を実際のバージョンに置き換えます。
- pnpm ワークスペースを使用しない場合や、ビルド時にバージョンを確定させたい場合に使用します。
- デフォルト: `false`

置き換えのルールは以下の通りです。

| 指定値                              | 置き換え後 (例: `1.2.3`) |
| ----------------------------------- | ------------------------ |
| `workspace:*` / `*`                 | `1.2.3`                  |
| `workspace:^`                       | `^1.2.3`                 |
| `workspace:~`                       | `~1.2.3`                 |
| `workspace:^1.0.0` (明示バージョン) | `^1.0.0`                 |
| `portal:../path` / `link:../path`   | `1.2.3`                  |

### `processor`

- `(packageJson: PackageJson) => PackageJson`
- 最終的に `package.json` を出力する前に加工処理を行います。

## 依存関係の処理について

各依存関係フィールドは以下のルールで dist/package.json に出力されます。

| 開発用フィールド       | dist フィールド        | 対象                             |
| ---------------------- | ---------------------- | -------------------------------- |
| `dependencies`         | `dependencies`         | 実際に import したパッケージのみ |
| `peerDependencies`     | `peerDependencies`     | 全エントリ（フィルタなし）       |
| `optionalDependencies` | `optionalDependencies` | 実際に import したパッケージのみ |
| `devDependencies`      | `dependencies`         | 実際に import したパッケージのみ |

`peerDependencies` だけフィルタなしで全エントリを保持する理由は、`import type` のような型専用 import や、プラグイン API 経由で受け取るだけで直接 import しないケース（例: rollup プラグインが `rollup` 自体を peer に持つ場合）があるためです。

## ライセンス

MIT License
