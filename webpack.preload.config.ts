import type { Configuration } from 'webpack';
import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

export const preloadConfig: Configuration = {
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
    extensions: ['.js', '.ts', '.json'],
  },
};
