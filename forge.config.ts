import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';
import { preloadConfig } from './webpack.preload.config';

// Two `electron-forge start` processes cannot share the dev server and logger
// ports, which is what testing a presenter/viewer session needs. Overriding
// these lets a second instance run alongside the first:
//   ELECTRON_UNITY_ALLOW_MULTI=1 FORGE_PORT=3001 FORGE_LOGGER_PORT=9001 npm start
const devPort = Number(process.env.FORGE_PORT) || 3000;
const loggerPort = Number(process.env.FORGE_LOGGER_PORT) || 9000;

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: [
      './resources-staging/unity',
      './node_modules/koffi',
      './node_modules/@koromix',
    ],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      port: devPort,
      loggerPort,
      devContentSecurityPolicy: "default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-eval' 'unsafe-inline' data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:* http://localhost:*",
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/shell.html',
            js: './src/renderer/shell.ts',
            name: 'main_window',
            preload: {
              js: './src/preload/index.ts',
              config: preloadConfig,
            },
          },
          {
            html: './src/renderer/index.html',
            js: './src/renderer/main.ts',
            name: 'overlay_window',
            preload: {
              js: './src/preload/index.ts',
              config: preloadConfig,
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
