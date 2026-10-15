import type { Options } from 'prettier';
import base from './prettier.config.ts';

const config: Options = {
  ...base,
  organizeImportsSkipDestructiveCodeActions: false,
};
export default config;
