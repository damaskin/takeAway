import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VersionBadgeComponent } from '@takeaway/ui-kit';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, VersionBadgeComponent],
  template: `<router-outlet /><lib-version-badge />`,
})
export class App {}
