const path = require('path');
module.exports = {
  stories: ['../src/ui/stories/**/*.stories.tsx'],
  addons: ['@storybook/addon-actions', '@storybook/addon-links'],

  webpackFinal: async config => {
    config.module.rules.push(
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
        options: {projectReferences: true}
      },
      {
        test: /\.s[ac]ss$/i,
        use: [
          // Creates `style` nodes from JS strings
          'style-loader',
          // Translates CSS into CommonJS
          'css-loader',
          // Compiles Sass to CSS
          'sass-loader'
        ]
      }
    );
    config.resolve.extensions.push('.ts', '.tsx');
    config.resolve.alias = {
      fs: path.resolve(__dirname, 'mock.js'),
      net: path.resolve(__dirname, 'mock.js'),
      child_process: path.resolve(__dirname, 'mock.js')
    };

    // This wires up process.env variables
    // Inspired by https://github.com/storybookjs/storybook/issues/12270#issuecomment-755398949
    // find the DefinePlugin
    const plugin = config.plugins.find(plugin =>
      plugin.definitions ? plugin.definitions['process.env'] : false
    );
    // add my env vars
    Object.keys(process.env).forEach(key => {
      plugin.definitions['process.env'][key] = JSON.stringify(process.env[key]);
    });
    return config;
  }
};
