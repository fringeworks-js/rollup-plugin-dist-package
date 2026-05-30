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

### `inheritProps`

- `string[]`
- Specifies properties to inherit from the original `package.json`.
- Default: `['name', 'version', 'description', 'repository', 'bugs', 'homepage', 'author', 'contributors', 'license', 'type', 'engines', 'keywords', 'sideEffects', 'peerDependenciesMeta']`

### `content`

- `Partial<PackageJson>` or `(packageJson: PackageJson) => Partial<PackageJson>`
- Specifies the content of the generated `package.json`.

### `inputDir`

- `string | undefined`
- Specifies the directory where the original `package.json` is located.
- Default: Current directory

### `outputDir`

- `string | undefined`
- Specifies the output directory for `package.json`.
- Default: Retrieved from Rollup's `output` settings

### `resolveWorkspaceDeps`

- `boolean`
- When `true`, replaces `workspace:` / `portal:` / `link:` version specifiers in each dependency field with the actual resolved versions.
- Use this when not using pnpm workspaces, or when you want versions to be resolved at build time.
- Default: `false`

Replacement rules are as follows:

| Specifier                             | Result (e.g. `1.2.3`) |
| ------------------------------------- | --------------------- |
| `workspace:*` / `*`                   | `1.2.3`               |
| `workspace:^`                         | `^1.2.3`              |
| `workspace:~`                         | `~1.2.3`              |
| `workspace:^1.0.0` (explicit version) | `^1.0.0`              |
| `portal:../path` / `link:../path`     | `1.2.3`               |

### `packagesDir`

- `string | undefined`
- Specifies the path to the directory containing workspace packages.
- Referenced when `resolveWorkspaceDeps` is `true`.
- Default: `'..'`

### `processor`

- `(packageJson: PackageJson) => PackageJson`
- Processes the final `package.json` before output.

## How dependencies are processed

Each dependency field is written to dist/package.json according to the following rules:

| Source field           | Dist field             | Included entries                |
| ---------------------- | ---------------------- | ------------------------------- |
| `dependencies`         | `dependencies`         | Only packages actually imported |
| `peerDependencies`     | `peerDependencies`     | All entries (no filtering)      |
| `optionalDependencies` | `optionalDependencies` | Only packages actually imported |
| `devDependencies`      | `dependencies`         | Only packages actually imported |

`peerDependencies` is preserved without filtering because peer dependencies may be used only as type imports (`import type`) or received solely through a plugin API without being directly imported (e.g. a rollup plugin that lists `rollup` itself as a peer dependency).

## License

MIT License
