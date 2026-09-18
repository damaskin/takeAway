import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VersionBadgeComponent } from '@takeaway/ui-kit';

/**
 * Root shell. Deliberately empty of lifecycle work: the Telegram handshake
 * (`ready`/`expand`) and the init-data sign-in both run in the app
 * initializer, before this ever renders, so no screen can appear ahead of
 * its session.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, VersionBadgeComponent],
  template: `<router-outlet /><lib-version-badge />`,
})
export class App {}
