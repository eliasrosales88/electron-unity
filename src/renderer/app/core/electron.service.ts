import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ElectronService {
  getAppVersion(): Promise<string> {
    return window.electronAPI.getAppVersion();
  }
}
