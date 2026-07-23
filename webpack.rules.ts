import type { ModuleOptions } from 'webpack';

export const rules: Required<ModuleOptions>['rules'] = [
  {
    test: /native_modules[/\\].+\.node$/,
    use: 'node-loader',
  },
  {
    test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
    parser: { amd: false },
    use: {
      loader: '@vercel/webpack-asset-relocator-loader',
      options: {
        outputAssetBase: 'native_modules',
      },
    },
  },
  {
    // Webfonts bundled via @fontsource/roboto and material-symbols so the
    // custom M3 theme and icons work fully offline (no Google Fonts <link>).
    test: /\.(woff2?|ttf|eot)$/,
    type: 'asset/resource',
  },
];
