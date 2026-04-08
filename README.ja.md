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
- デフォルト: `['name', 'version', 'description', 'repository', 'bugs', 'homepage', 'author', 'contributors', 'license', 'type', 'engines', 'keywords']`

### `inputDir`

- `string | undefined`
- 元の `package.json` のあるディレクトリを指定します。
- デフォルト: カレントディレクトリ

### `packagesDir`

- `string | undefined`
- ワークスペースのパッケージが格納されているディレクトリのパスを指定します。
- デフォルト: `'..'`

### `outputDir`

- `string | undefined`
- `package.json` の出力先ディレクトリを指定します。
- デフォルト: `rollup` の `output` 設定から取得

### `processor`

- `(packageJson: PackageJson) => PackageJson`
- 最終的に `package.json` を出力する前に加工処理を行います。

## ライセンス

MIT License
