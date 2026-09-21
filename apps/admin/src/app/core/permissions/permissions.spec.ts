import { ADMIN_ROLES, type AdminRole, type NavKey, canAccess, defaultLandingFor, navLink } from './permissions';

const ALL_KEYS = Object.keys(ADMIN_ROLES) as NavKey[];

describe('permissions map', () => {
  describe('canAccess', () => {
    it('grants SUPER_ADMIN every section except the per-brand telegram link', () => {
      // telegramLink binds a brand staff account to Telegram for order
      // pushes — a global SUPER_ADMIN has no brand of their own to link.
      for (const key of ALL_KEYS) {
        expect(canAccess('SUPER_ADMIN', key)).toBe(key !== 'telegramLink');
      }
    });

    it('denies an unauthenticated (null/undefined) role everywhere', () => {
      for (const key of ALL_KEYS) {
        expect(canAccess(null, key)).toBe(false);
        expect(canAccess(undefined, key)).toBe(false);
      }
    });

    it('keeps brand moderation SUPER_ADMIN-only', () => {
      expect(canAccess('BRAND_ADMIN', 'brands')).toBe(false);
      expect(canAccess('STORE_MANAGER', 'brands')).toBe(false);
      expect(canAccess('SUPER_ADMIN', 'brands')).toBe(true);
    });

    it('hides financial sections from kitchen STAFF', () => {
      expect(canAccess('STAFF', 'dashboard')).toBe(false);
      expect(canAccess('STAFF', 'analytics')).toBe(false);
      expect(canAccess('STAFF', 'promo')).toBe(false);
    });

    it('lets STAFF reach the operational sections', () => {
      expect(canAccess('STAFF', 'orders')).toBe(true);
      expect(canAccess('STAFF', 'stores')).toBe(true);
    });

    it('limits MENU_EDITOR to menu (+ telegram link is excluded)', () => {
      expect(canAccess('MENU_EDITOR', 'menu')).toBe(true);
      expect(canAccess('MENU_EDITOR', 'orders')).toBe(false);
      expect(canAccess('MENU_EDITOR', 'stores')).toBe(false);
      expect(canAccess('MENU_EDITOR', 'telegramLink')).toBe(false);
    });

    it('denies RIDER the admin panel entirely', () => {
      for (const key of ALL_KEYS) {
        expect(canAccess('RIDER', key)).toBe(false);
      }
    });
  });

  describe('defaultLandingFor', () => {
    it('sends SUPER_ADMIN / BRAND_ADMIN / STORE_MANAGER to the dashboard', () => {
      expect(defaultLandingFor('SUPER_ADMIN')).toBe('/dashboard');
      expect(defaultLandingFor('BRAND_ADMIN')).toBe('/dashboard');
      expect(defaultLandingFor('STORE_MANAGER')).toBe('/dashboard');
    });

    it('sends STAFF to orders (no dashboard access)', () => {
      expect(defaultLandingFor('STAFF')).toBe('/orders');
    });

    it('sends MENU_EDITOR to the menu', () => {
      expect(defaultLandingFor('MENU_EDITOR')).toBe('/menu');
    });

    it('falls back to change-password for a role with no landing section', () => {
      expect(defaultLandingFor('RIDER')).toBe('/change-password');
    });

    it('returns the login route for an unknown role', () => {
      expect(defaultLandingFor(null)).toBe('/login');
    });

    it('always points at a section the role can actually access', () => {
      const roles: AdminRole[] = ['SUPER_ADMIN', 'BRAND_ADMIN', 'STORE_MANAGER', 'MENU_EDITOR', 'STAFF'];
      for (const role of roles) {
        const landing = defaultLandingFor(role);
        const key = ALL_KEYS.find((k) => navLink(k) === landing);
        expect(key).toBeDefined();
        expect(canAccess(role, key as NavKey)).toBe(true);
      }
    });
  });

  describe('matrix integrity', () => {
    it('gives every section at least one role', () => {
      for (const key of ALL_KEYS) {
        expect(ADMIN_ROLES[key].length).toBeGreaterThan(0);
      }
    });

    it('exposes a distinct nav link for every key', () => {
      const links = ALL_KEYS.map((k) => navLink(k));
      expect(new Set(links).size).toBe(links.length);
    });
  });
});
