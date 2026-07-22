import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { SessionService } from '../../core/session.service';

@Component({
  selector: 'app-session-panel',
  standalone: true,
  imports: [MatButtonModule, MatDividerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-panel.component.html',
  styleUrls: ['./session-panel.component.css'],
})
export class SessionPanelComponent {
  readonly session = inject(SessionService);

  readonly title = signal('Panel session');
  readonly codeInput = signal('');
  readonly busy = signal(false);
  readonly copied = signal(false);

  readonly connectionLabel = computed(() => {
    switch (this.session.connection()) {
      case 'unconfigured': return 'Not configured';
      case 'disconnected': return 'Disconnected';
      case 'connecting': return 'Connecting…';
      case 'connected': return 'Connected';
      case 'reconnecting': return 'Reconnecting…';
      case 'error': return 'Error';
    }
  });

  readonly joinDisabled = computed(
    () => this.busy() || !this.session.canAct() || this.codeInput().trim().length !== 6,
  );

  onTitleInput(value: string): void {
    this.title.set(value);
  }

  onCodeInput(value: string): void {
    this.codeInput.set(value.toUpperCase());
  }

  async present(): Promise<void> {
    await this.run(() => this.session.create(this.title()));
  }

  async join(code?: string): Promise<void> {
    const target = code ?? this.codeInput();
    await this.run(async () => {
      await this.session.join(target);
      this.codeInput.set('');
    });
  }

  async leave(): Promise<void> {
    await this.run(() => this.session.leave());
  }

  async copyCode(): Promise<void> {
    const code = this.session.code();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Clipboard can be denied; the code is on screen either way.
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await action();
    } catch (err) {
      console.warn('[SessionPanel] action failed', err);
    } finally {
      this.busy.set(false);
    }
  }
}
