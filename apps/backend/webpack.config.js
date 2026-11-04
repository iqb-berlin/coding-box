// eslint-disable-next-line @typescript-eslint/no-var-requires
const { composePlugins, withNx } = require('@nx/webpack');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const nodeExternals = require('webpack-node-externals');

module.exports = composePlugins(
  withNx(),
  config => {
    config.experiments = { ...config.experiments, outputModule: true };
    config.output = {
      ...config.output,
      filename: 'main.mjs',
      chunkFilename: '[name].mjs',
      module: true,
      library: { type: 'module' }
    };
    delete config.output.libraryTarget;
    // Native Node imports preserve the package's ESM/CJS export conditions.
    config.externals = [nodeExternals({ importType: 'module' })];
    config.externalsType = 'module';
    return config;
  }
);
