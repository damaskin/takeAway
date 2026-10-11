/**
 * Person-centric staff management (`/admin/staff`). An employee is one
 * account with one role; the stores they work at are a list on that person.
 */

/** Roles the Staff page hands out. Admin and owner roles are managed elsewhere. */
export type StaffRoleName = 'STORE_MANAGER' | 'STAFF' | 'MENU_EDITOR';

export interface StaffMemberStore {
  id: string;
  name: string;
}

export interface StaffMember {
  userId: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  role: StaffRoleName;
  blocked: boolean;
  /** When the person was first assigned to one of the listed stores. */
  addedAt: string;
  /**
   * Stores of the brand the person works at, limited to the ones the caller
   * manages. Empty after the last one was taken away — the person is no
   * longer on the team.
   */
  stores: StaffMemberStore[];
  /** The store the kitchen PIN opens, when it is one of `stores`. */
  kdsPinStoreId: string | null;
  hasKdsPin: boolean;
  /**
   * The caller may change this person's stores and role. False for the
   * caller themself and, for a store manager, for other managers.
   */
  editable: boolean;
}

/**
 * The rule for a staff password — the temporary one an owner types on the
 * invite form and any password set later. The API enforces exactly this;
 * the admin shows it next to the field and checks it before sending.
 */
export const STAFF_PASSWORD_MIN_LENGTH = 8;
export const STAFF_PASSWORD_MAX_LENGTH = 128;

/** A kitchen PIN: 4 to 6 digits, set on the Staff page and typed on the tablet. */
export const KDS_PIN_MIN_LENGTH = 4;
export const KDS_PIN_MAX_LENGTH = 6;
export const KDS_PIN_PATTERN = /^[0-9]{4,6}$/;

export interface InviteStaffRequest {
  email: string;
  name?: string;
  role: StaffRoleName;
  tempPassword: string;
  storeIds: string[];
}

/**
 * What happened to the invite email:
 * - `SENT` — handed to the mail server;
 * - `NOT_CONFIGURED` — the server has no SMTP (or no ADMIN_APP_URL for the
 *   links), nothing was sent — the owner passes the email and password on;
 * - `FAILED` — the mail server refused it; same advice.
 */
export type StaffInviteEmailStatus = 'SENT' | 'NOT_CONFIGURED' | 'FAILED';

/** `POST /admin/staff` — the person as the list shows them, plus the invite email's fate. */
export interface StaffInviteResult extends StaffMember {
  inviteEmail: StaffInviteEmailStatus;
  /**
   * The invite created the account, so the temporary password is its
   * password. False when the email already had a staff account: that
   * person keeps their own password and the temporary one was not used.
   */
  accountCreated: boolean;
}

/** A kitchen tablet bound to the brand, as the Staff page lists it. */
export interface KitchenDeviceSummary {
  id: string;
  createdAt: string;
  /** Who bound it; null when that account is gone or the link's author is unknown. */
  createdByName: string | null;
  /** Last PIN sign-in from it; null until the first one. */
  lastUsedAt: string | null;
}

/** `POST /admin/kitchen-devices/pairing-code` — a one-time code for the tablet link. */
export interface KitchenPairingCode {
  code: string;
  expiresAt: string;
}

/** A tablet just bound: the token it keeps, and the brand it now belongs to. */
export interface KitchenDeviceBinding {
  deviceToken: string;
  brandId: string;
  brandName: string;
}

/** `GET /auth/kds/device` — the stores a bound tablet's PIN screen offers. */
export interface KitchenDeviceStores {
  brandId: string;
  brandName: string;
  /** Stores of the brand where at least one employee has a working PIN. */
  stores: Array<{ id: string; name: string; city: string }>;
}

export interface SetStaffStoresRequest {
  storeIds: string[];
}

export interface ChangeStaffRoleRequest {
  role: StaffRoleName;
}
