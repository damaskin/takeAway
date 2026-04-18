import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { TmaAuthService } from './core/auth/tma-auth.service';
import { TelegramBridgeService } from './core/telegram/telegram-bridge.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class App implements OnInit {
  private readonly tg = inject(TelegramBridgeService);
  private readonly auth = inject(TmaAuthService);

  ngOnInit(): void {
    this.tg.ready();
    this.tg.expand();
    this.auth.autoSignIn();
  }
}
