import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { FeatureFlagsStore } from './core/config/feature-flags.store';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class App implements OnInit {
  private readonly flags = inject(FeatureFlagsStore);

  ngOnInit(): void {
    // One-shot on startup — the admin shell is long-lived and ops toggles
    // are rare, so polling would be overkill.
    this.flags.load();
  }
}
