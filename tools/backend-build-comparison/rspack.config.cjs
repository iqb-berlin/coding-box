const nodeExternals = require('webpack-node-externals');

// Keep Nx's asset, replacement and package generation support. Only the
// compiler/bundler changes; production dependencies remain native Node imports.
module.exports = (config, { options }) => {
  config.watch = Boolean(options.watch);
  // Nx's SWC rule otherwise uses SWC's older default target. Match the actual
  // production TypeScript target rather than generating unnecessary helpers.
  for (const rule of config.module.rules) {
    if (rule.loader === 'builtin:swc-loader') {
      rule.options.jsc.target = 'es2021';
      rule.options.jsc.transform.useDefineForClassFields = false;
    }
  }
  if (options.watch) {
    config.plugins = config.plugins.filter(plugin =>
      !['LicenseWebpackPlugin', 'GeneratePackageJsonPlugin'].includes(plugin.constructor.name));
  }
  config.experiments = { ...config.experiments, outputModule: true };
  config.output = {
    ...config.output, filename: 'main.mjs', chunkFilename: '[name].mjs',
    module: true, library: { type: 'module' }
  };
  delete config.output.libraryTarget;
  config.externals = [nodeExternals({ importType: 'module' })];
  config.externalsType = 'module';
  return config;
};
