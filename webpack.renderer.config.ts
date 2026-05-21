import type { Configuration } from 'webpack';
import { AngularWebpackPlugin } from '@ngtools/webpack';
import path from 'path';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

export const rendererConfig: Configuration = {
  target: 'web',
  module: {
    rules: [
      ...rules,
      { test: /\.html$/, loader: 'html-loader' },
      {
        test: /\.css$/,
        exclude: /[\\/]app[\\/]/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.css$/,
        include: /[\\/]app[\\/]/,
        type: 'asset/source',
      },
      {
        test: /\.[cm]?js$/,
        use: {
          loader: 'babel-loader',
          options: {
            plugins: ['@angular/compiler-cli/linker/babel'],
            compact: false,
            cacheDirectory: true,
          },
        },
      },
      {
        test: /\.[cm]?ts$/,
        loader: '@ngtools/webpack',
      },
    ],
  },
  plugins: [
    ...plugins,
    new AngularWebpackPlugin({
      tsconfig: path.resolve(__dirname, 'tsconfig.renderer.json'),
      jitMode: false,
    }),
  ],
  resolve: {
    extensions: ['.ts', '.js', '.mjs'],
  },
};
