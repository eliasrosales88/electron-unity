import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

export const mainConfig: Configuration = {
  entry: './src/main/index.ts',
  module: {
    rules: [
      ...rules,
      {
        test: /\.tsx?$/,
        exclude: /(node_modules|\.webpack)/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            configFile: 'tsconfig.main.json',
          },
        },
      },
    ],
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
  externals: {
    // koffi is a native .node addon loaded from resourcesPath at runtime (see
    // unity/win32.ts), so it must stay external — webpack can't bundle a binary.
    koffi: 'commonjs koffi',
    // @microsoft/signalr and ws MUST be bundled, not externalized: the packaged
    // app.asar ships only the webpack output, with no node_modules for a bare
    // `require('ws')` to resolve against. Both target Node builds (signalr's
    // main/module point at dist/cjs|esm, and it has no `browser` field), so
    // webpack bundles them and their Node transports cleanly.
  },
};
