const { transformSync } = require('esbuild');

// Nest's BullMQ 12 adapter is ESM. The backend/Jest suite still runs on Node 22
// with CommonJS, so transform only this adapter and its shared Nest helpers.
module.exports = {
  process(source, file) {
    return {
      code: transformSync(source, {
        format: 'cjs', target: 'node22', sourcefile: file, sourcemap: 'inline'
      }).code
    };
  }
};
