import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="flex min-h-screen" style="background: var(--color-foam); color: var(--color-espresso)">
      <aside class="w-60 shrink-0 p-4 border-r flex flex-col gap-2" style="border-color: var(--color-latte)">
        <div class="px-2 mb-4">
          <span class="text-2xl" style="font-family: var(--font-display)">takeAway</span>
          <span class="block text-xs uppercase tracking-widest" style="opacity: 0.5">admin</span>
        </div>
        <a
          routerLink="/dashboard"
          routerLinkActive="bg-[var(--color-latte)]"
          class="px-3 py-2 rounded-lg hover:bg-[var(--color-latte)]/50"
          >Dashboard</a
        >
        <a
          routerLink="/menu"
          routerLinkActive="bg-[var(--color-latte)]"
          class="px-3 py-2 rounded-lg hover:bg-[var(--color-latte)]/50"
          >Menu</a
        >
        <a
          routerLink="/stores"
          routerLinkActive="bg-[var(--color-latte)]"
          class="px-3 py-2 rounded-lg hover:bg-[var(--color-latte)]/50"
          >Stores</a
        >
      </aside>

      <div class="flex-1 flex flex-col">
        <header class="h-14 flex items-center justify-between px-6 border-b" style="border-color: var(--color-latte)">
          <span class="text-sm" style="opacity: 0.6">{{ userName() }} · {{ userRole() }}</span>
          <button type="button" (click)="logout()" class="text-sm hover:underline">Sign out</button>
        </header>
        <main class="p-8 flex-1 overflow-auto">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class AdminLayoutPage {
  private readonly auth = inject(AuthService);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);

  userName(): string {
    const user = this.store.user();
    return user?.name ?? user?.phone ?? 'User';
  }

  userRole(): string {
    return this.store.user()?.role ?? '';
  }

  logout(): void {
    this.auth.logout().subscribe({
      complete: () => void this.router.navigate(['/login']),
    });
  }
}
