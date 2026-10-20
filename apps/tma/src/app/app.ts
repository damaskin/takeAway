import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VersionBadgeComponent } from '@takeaway/ui-kit';

import { TmaEdgeSwipeBackComponent } from './shared/edge-swipe-back.component';

/**
 * Root shell. Deliberately empty of lifecycle work: the Telegram handshake
 * (`ready`/`expand`) and the init-data sign-in both run in the app
 * initializer, before this ever renders, so no screen can appear ahead of
 * its session. The left-edge swipe back lives here, over every screen.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, VersionBadgeComponent, TmaEdgeSwipeBackComponent],
  template: `<router-outlet /><app-tma-edge-swipe-back /><lib-version-badge optIn />`,
})
export class App {}
