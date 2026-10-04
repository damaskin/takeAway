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

export interface InviteStaffRequest {
  email: string;
  name?: string;
  role: StaffRoleName;
  tempPassword: string;
  storeIds: string[];
}

export interface SetStaffStoresRequest {
  storeIds: string[];
}

export interface ChangeStaffRoleRequest {
  role: StaffRoleName;
}
