const { composePlugins } = require('@nx/webpack');
const production = require('../../apps/backend/webpack.config.js');

module.exports = composePlugins(production, (config, { options }) => {
  if (options.watch) {
    // Dependency manifests and third-party notices belong to complete release
    // builds, not every source edit. Apply the same watch scope to both bundlers.
    config.plugins = config.plugins.filter(plugin =>
      !['LicenseWebpackPlugin', 'GeneratePackageJsonPlugin'].includes(plugin.constructor.name));
  }
  return config;
});
