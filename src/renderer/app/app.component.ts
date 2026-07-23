import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { ElectronService } from './core/electron.service';
import { UnityService } from './core/unity.service';
import { OverlayLayoutService } from './core/overlay-layout.service';
import { SidePanelComponent } from './components/side-panel/side-panel.component';
import { SceneControlsComponent } from './components/scene-controls/scene-controls.component';
import { SessionPanelComponent } from './components/session-panel/session-panel.component';
import { WsInspectorComponent } from './components/ws-inspector/ws-inspector.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDividerModule,
    SidePanelComponent,
    SceneControlsComponent,
    SessionPanelComponent,
    WsInspectorComponent,
  ],
  // Styles are global (src/renderer/_panels.scss) — see side-panel for why.
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  private readonly electron = inject(ElectronService);
  readonly unity = inject(UnityService);
  // Instantiated here so the layout is published from the moment the app boots,
  // including the 'modal' state the loading screen depends on.
  private readonly overlayLayout = inject(OverlayLayoutService);

  readonly version = signal<string>('...');

  readonly showLoading = computed(() => !this.unity.ready() && !this.unity.error());
  readonly showError = computed(() => !!this.unity.error());

  async ngOnInit(): Promise<void> {
    this.version.set(await this.electron.getAppVersion());
  }

  async restartUnity(): Promise<void> {
    await this.unity.restart();
  }
}
