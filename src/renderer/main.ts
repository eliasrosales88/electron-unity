import './polyfills';
// Bundled webfonts (offline): Roboto for the M3 type scale + Material Symbols
// for <mat-icon>. Imported here so webpack resolves them from node_modules and
// inlines their @font-face rules ahead of the theme.
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import 'material-symbols/outlined.css';
import './styles.scss';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((err) =>
  console.error('Error bootstrapping Angular:', err),
);
