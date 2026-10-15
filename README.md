# @fringeworks/rollup-plugin-dist-package

`@fringeworks/rollup-plugin-dist-package` is a plugin some will find handy, generating distribution-specific package.json files to maintain clean import paths.  
`@fringeworks/rollup-plugin-dist-package` edits `package.json` during the Rollup build process and outputs it to the output directory in the appropriate format.  
It was created with the goal of outputting only the minimum required fields in the `package.json` for publishing to npm,  
as well as assisting in publishing the library with a flat directory structure.

**[日本語版READMEはこちら](./README.ja.md)**

## Installation

```sh
npm install @fringeworks/rollup-plugin-dist-package --save-dev
```

## Usage

Configure it in `rollup.config.js` as follows:

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

Creates a plugin that edits `package.json` and outputs it to the build output directory.

| Parameter  | Type                 | Description       |
| ---------- | -------------------- | ----------------- |
| `options?` | `DistPackageOptions` | The options below |

| Option                  | Type                                                                           | Description                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inheritProps?`         | `readonly string[]`                                                            | Properties to inherit from the original `package.json` when not set in `content`. Falsy values such as `sideEffects: false` are inherited as well. Default: see below |
| `content?`              | `Partial<PackageJson> \| ((packageJson: PackageJson) => Partial<PackageJson>)` | Content of the generated `package.json`. Packages listed in its dependency fields take precedence over those collected from the original `package.json`               |
| `inputDir?`             | `string`                                                                       | Directory where the original `package.json` is located. Default: current directory                                                                                    |
| `outputDir?`            | `string`                                                                       | Output directory for `package.json`. If omitted, it is emitted as an asset into Rollup's output directory                                                             |
| `resolveWorkspaceDeps?` | `boolean`                                                                      | Replaces `workspace:` / `portal:` / `link:` / `*` version specifiers with the actual versions of the workspace packages. Default: `false`                             |
| `range?`                | `VersionRange \| null`                                                         | Range prefix added when `resolveWorkspaceDeps` replaces a specifier that has no explicit range                                                                        |
| `packagesDir?`          | `string`                                                                       | Directory containing the workspace packages, relative to `inputDir`. Referenced when `resolveWorkspaceDeps` is `true`. Default: `'..'`                                |
| `processor?`            | `(packageJson: PackageJson) => PackageJson`                                    | Processes the final `package.json` before output                                                                                                                      |

The default of `inheritProps` is `['name', 'version', 'description', 'repository', 'bugs', 'homepage', 'author', 'contributors', 'license', 'type', 'engines', 'keywords', 'sideEffects', 'peerDependenciesMeta']`.

#### Resolving workspace dependencies

With `resolveWorkspaceDeps: true`, specifiers are replaced as follows (e.g. the package version is `1.2.3`).\
An explicit range in the specifier takes precedence over `range`.

| Specifier                             | Result   | With `range: '^'` |
| ------------------------------------- | -------- | ----------------- |
| `workspace:*` / `workspace:` / `*`    | `1.2.3`  | `^1.2.3`          |
| `portal:../path` / `link:../path`     | `1.2.3`  | `^1.2.3`          |
| `workspace:^`                         | `^1.2.3` | `^1.2.3`          |
| `workspace:~`                         | `~1.2.3` | `~1.2.3`          |
| `workspace:^1.0.0` (explicit version) | `^1.0.0` | `^1.0.0`          |

If a package is not found in `packagesDir`, the specifier is output as is and a warning is issued (except for `*`, which is also used for packages outside the workspace).

### Types

| Type                 | Description                             |
| -------------------- | --------------------------------------- |
| `DistPackageOptions` | Options for `distPackage`               |
| `VersionRange`       | Range prefix for `range` (`'^' \| '~'`) |

## How dependencies are processed

Each dependency field is written to dist/package.json according to the following rules:

| Source field           | Dist field             | Included entries                |
| ---------------------- | ---------------------- | ------------------------------- |
| `dependencies`         | `dependencies`         | Only packages actually imported |
| `peerDependencies`     | `peerDependencies`     | All entries (no filtering)      |
| `optionalDependencies` | `optionalDependencies` | Only packages actually imported |
| `devDependencies`      | `dependencies`         | Only packages actually imported |

`peerDependencies` is preserved without filtering because peer dependencies may be used only as type imports (`import type`) or received solely through a plugin API without being directly imported (e.g. a rollup plugin that lists `rollup` itself as a peer dependency).

Imports are detected from module specifiers written as package names (e.g. `react`, `lodash/merge`). Relative and absolute paths are not treated as packages, because bundled modules cannot be distinguished from external ones. When type declarations are built together (e.g. `dts: true` in tsdown), packages imported only as types are also included.

## License

MIT License
