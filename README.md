# @niche-works/rollup-plugin-dist-package

A niche plugin for generating distribution-specific package.json files to maintain clean import paths.
`@niche-works/rollup-plugin-dist-package` edits `package.json` during the Rollup build process and outputs it to the output directory in the appropriate format.  
It was created with the goal of outputting only the minimum required fields in the `package.json` for publishing to npm,  
as well as assisting in publishing the library with a flat directory structure.

**[日本語版READMEはこちら](./README.ja.md)**

## Installation

```sh
npm install @niche-works/rollup-plugin-dist-package --save-dev
```

## Usage

Configure it in `rollup.config.js` as follows:

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

## Options

### `content`

- `Partial<PackageJson>` or `(packageJson: PackageJson) => Partial<PackageJson>`
- Specifies the content of the generated `package.json`.

### `inheritProps`

- `string[]`
- Specifies properties to inherit from the original `package.json`.
- Default: `['name', 'version', 'description', 'repository', 'bugs', 'homepage', 'author', 'contributors', 'license', 'type', 'engines', 'keywords']`

### `inputDir`

- `string | undefined`
- Specifies the directory where the original `package.json` is located.
- Default: Current directory

### `packagesDir`

- `string | undefined`
- Specifies the path to the directory containing workspace packages.
- Default: `'..'`

### `outputDir`

- `string | undefined`
- Specifies the output directory for `package.json`.
- Default: Retrieved from Rollup's `output` settings

### `processor`

- `(packageJson: PackageJson) => PackageJson`
- Processes the final `package.json` before output.

## License

MIT License
