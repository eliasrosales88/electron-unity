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
        // Global stylesheet (styles.scss) — the custom M3 theme lives here.
        // Component styles stay .css (loaded as asset/source above) and just
        // consume the theme's --mat-sys-* tokens, so no .scss rule for app/.
        test: /\.scss$/,
        use: [
          'style-loader',
          'css-loader',
          {
            loader: 'sass-loader',
            options: {
              // Let `@use '@angular/material'` resolve from node_modules
              // (there is no Angular CLI here to wire up include paths).
              sassOptions: {
                loadPaths: [path.resolve(__dirname, 'node_modules')],
                // Angular Material 19 still uses legacy Sass if() internally;
                // silence those deprecation warnings from the dependency.
                quietDeps: true,
              },
            },
          },
        ],
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
