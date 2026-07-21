import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ElectronService } from './core/electron.service';
import { UnityService } from './core/unity.service';
import { OverlayBoundsService } from './core/overlay-bounds.service';
import { SidePanelComponent } from './components/side-panel/side-panel.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [SidePanelComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  private readonly electron = inject(ElectronService);
  readonly unity = inject(UnityService);
  private readonly overlayBounds = inject(OverlayBoundsService);

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
