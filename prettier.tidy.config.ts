import type { Options } from 'prettier';
import base from './prettier.config.ts';

export const config: Options = {
  ...base,
  organizeImportsSkipDestructiveCodeActions: false,
};
