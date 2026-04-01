import fs from 'fs-extra';
import path from 'path';

const CJS_PATH = 'dist/cjs';
const REGEXP = /^exports.default = (.+);$/m;

if (fs.existsSync(CJS_PATH)) {
  const items = fs.readdirSync(CJS_PATH);
  for (const item of items) {
    if (item.endsWith('.js')) {
      const itemPath = path.join(CJS_PATH, item);
      // 内容の修正
      let source = fs.readFileSync(itemPath, { encoding: 'utf8' });
      const match = REGEXP.exec(source);
      if (match) {
        fs.writeFileSync(
          itemPath,
          source +
            `
exports.${match[1]} = ${match[1]};
module.exports = Object.assign(exports.default, exports);`,
          { encoding: 'utf8' },
        );
      }
      // 拡張子の変更
      const { name } = path.parse(itemPath);
      fs.renameSync(itemPath, path.join(CJS_PATH, `${name}.cjs`));
    }
  }
}
