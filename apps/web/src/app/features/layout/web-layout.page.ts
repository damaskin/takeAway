import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-web-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="min-h-screen flex flex-col" style="background: var(--color-cream); color: var(--color-espresso)">
      <header
        class="border-b sticky top-0 z-10 backdrop-blur"
        style="border-color: var(--color-latte); background: rgba(248, 243, 235, 0.85)"
      >
        <div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <a routerLink="/" class="flex items-center gap-2">
            <span class="text-2xl" style="font-family: var(--font-display)">takeAway</span>
          </a>
          <nav class="flex items-center gap-6 text-sm">
            <a routerLink="/stores" routerLinkActive="opacity-100" class="opacity-60 hover:opacity-100">Stores</a>
            <a routerLink="/menu" routerLinkActive="opacity-100" class="opacity-60 hover:opacity-100">Menu</a>
            @if (isAuthed()) {
              <a routerLink="/profile" routerLinkActive="opacity-100" class="opacity-60 hover:opacity-100">
                {{ userName() }}
              </a>
              <button type="button" (click)="logout()" class="opacity-60 hover:opacity-100">Sign out</button>
            } @else {
              <a
                routerLink="/login"
                class="px-4 py-2 font-medium"
                style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
              >
                Sign in
              </a>
            }
          </nav>
        </div>
      </header>

      <main class="flex-1">
        <router-outlet />
      </main>

      <footer class="border-t mt-16" style="border-color: var(--color-latte)">
        <div class="max-w-6xl mx-auto px-4 py-8 text-sm flex items-center justify-between" style="opacity: 0.6">
          <span>© takeAway</span>
          <span>Pre-order. Skip the queue. Pick it up.</span>
        </div>
      </footer>
    </div>
  `,
})
export class WebLayoutPage {
  private readonly store = inject(AuthStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  isAuthed(): boolean {
    return this.store.isAuthenticated();
  }

  userName(): string {
    const u = this.store.user();
    return u?.name ?? u?.phone ?? 'Account';
  }

  logout(): void {
    this.auth.logout().subscribe({
      complete: () => void this.router.navigate(['/']),
    });
  }
}
