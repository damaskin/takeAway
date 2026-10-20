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
  /**
   * Email and login are both null for kitchen staff invited with a PIN
   * only: they sign in on the kitchen tablet and nowhere else, until the
   * owner adds a login ({@link AddStaffSignInRequest}).
   */
  email: string | null;
  /** The sign-in name of someone invited without an email; null otherwise. */
  login: string | null;
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
  /**
   * An old kitchen PIN (set before 2026-10-20) opens one store only: that
   * store, when it is one of `stores`. Null for the current kind of PIN,
   * which opens every store the person works at in the brand, and when
   * there is no PIN.
   */
  kdsPinStoreId: string | null;
  /** The person has a kitchen PIN that opens the listed stores' tablet (one of them, for an old PIN). */
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

/**
 * A staff login — what someone without an email signs in with. Compared
 * and stored lowercase: latin letters, digits, dot, underscore and hyphen.
 * Never an '@', so a login can't be mistaken for an email or equal one.
 */
export const STAFF_LOGIN_MIN_LENGTH = 3;
export const STAFF_LOGIN_MAX_LENGTH = 32;
export const STAFF_LOGIN_PATTERN = /^[a-z0-9._-]{3,32}$/;

/** A kitchen PIN: 4 to 6 digits, set on the Staff page and typed on the tablet. */
export const KDS_PIN_MIN_LENGTH = 4;
export const KDS_PIN_MAX_LENGTH = 6;
export const KDS_PIN_PATTERN = /^[0-9]{4,6}$/;
/** A PIN set now: exactly 6 digits (and not one digit six times or a straight run — the API checks that too). */
export const KDS_NEW_PIN_PATTERN = /^[0-9]{6}$/;

/**
 * `POST /admin/staff` — at most one of `email` and `login`, each with a
 * temporary password. Someone invited by a login gets no email: the owner
 * hands the login and the temporary password over in person.
 *
 * Kitchen staff (`STAFF`) may come with neither: then `name` and `pin` are
 * required and the person signs in on the kitchen tablet only, with no
 * password at all, until the owner adds a login on their page. `pin` may
 * also come with an email or login, for `STAFF` and `STORE_MANAGER`.
 */
export interface InviteStaffRequest {
  email?: string;
  login?: string;
  name?: string;
  role: StaffRoleName;
  tempPassword?: string;
  /** The kitchen PIN, 6 digits — one for every store of the brand the person works at. */
  pin?: string;
  storeIds: string[];
}

/** `PUT /admin/staff/:userId/kds-pin` — the person's one kitchen PIN for all their stores of the brand. */
export interface SetStaffPinRequest {
  pin: string;
}

/**
 * `PUT /admin/staff/:userId/sign-in` — a way into the cabinet for someone
 * invited with a PIN only: an email or a login (exactly one) and a
 * temporary password, to be changed at the first sign-in.
 */
export interface AddStaffSignInRequest {
  email?: string;
  login?: string;
  tempPassword: string;
}

/**
 * What happened to the invite email:
 * - `SENT` — handed to the mail server;
 * - `NOT_CONFIGURED` — the server has no SMTP (or no ADMIN_APP_URL for the
 *   links), nothing was sent — the owner passes the email and password on;
 * - `FAILED` — the mail server refused it; same advice;
 * - `NO_EMAIL` — the person signs in with a login and has no email, so
 *   there was nobody to write to — the owner passes the login and password on.
 */
export type StaffInviteEmailStatus = 'SENT' | 'NOT_CONFIGURED' | 'FAILED' | 'NO_EMAIL';

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

/**
 * `POST /admin/staff/:userId/reset-password` — «Сбросить пароль», for the
 * brand's owner and platform admins. The person's sessions are ended and
 * the password is replaced by a generated one, to be changed at the next
 * sign-in.
 */
export interface StaffPasswordReset {
  /** The new temporary password. Shown to the owner once; it is not stored or sent anywhere. */
  tempPassword: string;
  /** Whether the person was also emailed a one-time link to set their own password. */
  resetEmail: StaffInviteEmailStatus;
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

/** `GET /auth/kds/device` — the brand a bound tablet belongs to, for its PIN screen. */
export interface KitchenDeviceStores {
  brandId: string;
  brandName: string;
  /**
   * Stores of the brand where at least one employee has a working PIN. The
   * PIN screen shows its keypad only when there is one, and offers these
   * when an old PIN needs its store (409 `KDS_PIN_STORE_REQUIRED`).
   */
  stores: Array<{ id: string; name: string; city: string }>;
}

export interface SetStaffStoresRequest {
  storeIds: string[];
}

export interface ChangeStaffRoleRequest {
  role: StaffRoleName;
}
