'use strict';

const EmberApp = require('ember-cli/lib/broccoli/ember-app');

module.exports = function(defaults) {
  const app = new EmberApp(defaults, {
    postcssOptions: {
      compile: {
        plugins: [
          {
            module: require('postcss-import'),
            options: {
              path: ['node_modules']
            }
          },
          require('tailwindcss')('./app/styles/tailwind.js'),
          {
            module: require('@fullhuman/postcss-purgecss'),
            options: {
              content: [
                // add extra paths here for components/controllers which include tailwind classes
                './app/index.html',
                './app/templates/**/*.hbs',
                './app/components/**/*.hbs',
                './app/components/**/*.ts',
                './app/controllers/**/*.ts'
              ],
              defaultExtractor: content => content.match(/[A-Za-z0-9-_:/]+/g) || []
            }
          }
        ]
      }
    },
    autoImport: {
      webpack: {
        node: {
          https: true,
          http: true,
          fs: 'empty',
          crypto: true,
          // eslint-disable-next-line @typescript-eslint/camelcase
          child_process: 'empty'
        }
      }
    }
  });

  // Use `app.import` to add additional libraries to the generated
  // output files.
  //
  // If you need to use different assets in different
  // environments, specify an object as the first parameter. That
  // object's keys should be the environment name and the values
  // should be the asset to use in that environment.
  //
  // If the library that you are including contains AMD or ES6
  // modules that you would like to import into your application
  // please specify an object with the list of modules as keys
  // along with the exports of each module as its value.

  app.import('node_modules/@statechannels/channel-provider/dist/channel-provider.js');
  app.import({
    development: 'node_modules/ethers/dist/ethers.js',
    production: 'node_modules/ethers/dist/ethers.min.js'
  });

  return app.toTree();
};
