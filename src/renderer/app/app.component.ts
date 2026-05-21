import { Component, OnInit, inject, signal } from '@angular/core';
import { ElectronService } from './core/electron.service';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit {
  private readonly electron = inject(ElectronService);
  readonly version = signal<string>('cargando...');

  async ngOnInit(): Promise<void> {
    this.version.set(await this.electron.getAppVersion());
  }
}
