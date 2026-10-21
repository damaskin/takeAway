import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { StaffInviteResult, StaffMember, StaffPasswordReset, StaffRoleName } from '@takeaway/shared-types';
import { generateTempPassword } from '@takeaway/utils';

import { BrandScopeService } from '../../auth/services/brand-scope.service';
import {
  isPinCollision,
  KitchenPinsService,
  kdsPinMultiBrand,
  kdsPinTaken,
} from '../../auth/services/kitchen-pins.service';
import { PasswordService } from '../../auth/services/password.service';
import { TokensService } from '../../auth/services/tokens.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { codedConflict } from '../../common/http/coded-conflict';
import { PrismaService } from '../../prisma/prisma.service';
import { StaffInviteMailer } from './staff-invite-mailer.service';
import { createLoginAccount, loginInUse } from './staff-login';

const STAFF_ROLES: Role[] = [Role.STORE_MANAGER, Role.STAFF, Role.MENU_EDITOR];
/** Who works the kitchen tablet, and so may have a PIN. */
const PIN_ROLES: Role[] = [Role.STORE_MANAGER, Role.STAFF];

/**
 * What a build without KDS_PIN_SECRET stores instead of a PIN hash. Such a
 * row opens nothing, so it is not shown as a PIN.
 */
const UNSET_PIN_PREFIX = 'unset:';

/** Stores the caller manages: id → name and brand. */
type Reach = Map<string, { name: string; brandId: string }>;

const MEMBER_SELECT = {
  id: true,
  email: true,
  login: true,
  phone: true,
  name: true,
  role: true,
  blockedAt: true,
  createdAt: true,
  kdsPinHash: true,
  kdsPinStoreId: true,
  kdsPinBrandId: true,
} satisfies Prisma.UserSelect;

type MemberRow = Prisma.UserGetPayload<{ select: typeof MEMBER_SELECT }> & {
  userStores: { storeId: string; createdAt: Date }[];
};

/** What the invite form sends. */
export interface InviteInput {
  email?: string;
  login?: string;
  name?: string;
  role: StaffRoleName;
  tempPassword?: string;
  pin?: string;
  storeIds: string[];
}

/**
 * Person-centric staff management: an employee is one account with one
 * role, and the stores they work at are a list on that person — the owner
 * opens someone and ticks their stores, instead of opening a store and
 * adding people to it. Same `UserStore` pivot as the store-centric
 * `/admin/stores/:storeId/staff` endpoints, which stay for older clients.
 *
 * Reach — the stores a caller may assign:
 *   - SUPER_ADMIN → every store (of `brandId` when given);
 *   - BRAND_ADMIN → the stores of the brands they own;
 *   - STORE_MANAGER → only the stores they are assigned to.
 *
 * Everything is read and written inside the reach: a person's stores
 * outside it are neither shown nor touched, so a manager re-saving a
 * barista's stores never drops the barista from another manager's café.
 * A store manager also cannot hand out the manager role or edit other
 * managers, and nobody edits their own access here.
 *
 * An account is global (one role, one password, one kitchen PIN), so its
 * role is changed, its PIN set, and stores are added to it, only when every
 * store it works at is within the caller's brands — see
 * {@link BrandScopeService.managesUser}. Taking it off the caller's own
 * stores stays possible.
 *
 * The kitchen PIN lives on the person, one for every store they work at in
 * the brand (KitchenPinsService). Kitchen staff may have nothing else: they
 * are invited with a name, stores and a PIN, and sign in on the tablet only
 * until the owner adds a login.
 */
@Injectable()
export class AdminStaffMembersService {
  private readonly logger = new Logger(AdminStaffMembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly scope: BrandScopeService,
    private readonly inviteMailer: StaffInviteMailer,
    private readonly tokens: TokensService,
    private readonly kitchenPins: KitchenPinsService,
  ) {}

  async list(user: AuthenticatedUser, brandId?: string): Promise<StaffMember[]> {
    const reach = await this.reach(user, brandId);
    if (reach.size === 0) return [];
    const storeIds = [...reach.keys()];
    const rows = await this.prisma.user.findMany({
      where: { role: { in: STAFF_ROLES }, userStores: { some: { storeId: { in: storeIds } } } },
      select: {
        ...MEMBER_SELECT,
        userStores: { where: { storeId: { in: storeIds } }, select: { storeId: true, createdAt: true } },
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }, { login: 'asc' }],
    });
    return rows.map((row) => this.toMember(row, reach, user));
  }

  async get(userId: string, user: AuthenticatedUser, brandId?: string): Promise<StaffMember> {
    const reach = await this.reach(user, brandId);
    const row = await this.findOnTeam(userId, reach);
    return this.toMember(row, reach, user);
  }

  /**
   * Replaces the person's stores within the caller's reach. Taking away the
   * last one takes the person off the team. A kitchen PIN that no longer
   * opens any of the person's stores — a brand PIN with no store of its
   * brand left, an old PIN whose store went — is reset, and the person's
   * tablet sessions end with it.
   */
  async setStores(userId: string, storeIds: string[], user: AuthenticatedUser, brandId?: string): Promise<StaffMember> {
    const reach = await this.reach(user, brandId);
    this.assertWithinReach(storeIds, reach);
    const row = await this.findOnTeam(userId, reach);
    this.assertEditable(row, user);

    const current = row.userStores.map((s) => s.storeId);
    const wanted = new Set(storeIds);
    const toRemove = current.filter((id) => !wanted.has(id));
    const toAdd = storeIds.filter((id) => !current.includes(id));
    if (toAdd.length > 0) await this.assertManaged(userId, user);

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (toRemove.length > 0) {
      ops.push(this.prisma.userStore.deleteMany({ where: { userId, storeId: { in: toRemove } } }));
    }
    if (toAdd.length > 0) {
      ops.push(
        this.prisma.userStore.createMany({
          data: toAdd.map((storeId) => ({ userId, storeId })),
          skipDuplicates: true,
        }),
      );
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);
    if (toRemove.length > 0) await this.dropOrphanPin(userId);

    return this.reload(userId, reach, user);
  }

  async changeRole(
    userId: string,
    role: StaffRoleName,
    user: AuthenticatedUser,
    brandId?: string,
  ): Promise<StaffMember> {
    const reach = await this.reach(user, brandId);
    this.assertRoleAllowed(role, user);
    const row = await this.findOnTeam(userId, reach);
    this.assertEditable(row, user);
    await this.assertManaged(userId, user);
    if (row.role !== role) {
      await this.prisma.user.update({ where: { id: userId }, data: { role } });
    }
    return this.reload(userId, reach, user);
  }

  /**
   * Invites someone to one or more stores. A new email gets an account with
   * a temporary password to rotate on first sign-in; an existing staff
   * account of the caller's brands (e.g. from a store outside a manager's
   * reach) joins with the requested role. Someone already on the team is
   * changed on their own page instead. Any other existing account — a
   * customer, an admin, staff of another brand — gets the same neutral 409.
   *
   * With a login instead of an email it is always a new account (see
   * {@link createLoginAccount}): a taken login is 409 LOGIN_IN_USE, whoever
   * has it. Nobody is mailed — the owner hands over the login and password.
   *
   * Kitchen staff may come with neither: a name, stores and a PIN make an
   * account that only unlocks the kitchen tablet ({@link inviteWithPinOnly}).
   * A PIN may come with an email or a login too; it is checked (format,
   * free at the brand) before anybody is created or linked.
   */
  async invite(input: InviteInput, user: AuthenticatedUser, brandId?: string): Promise<StaffInviteResult> {
    const reach = await this.reach(user, brandId);
    this.assertWithinReach(input.storeIds, reach);
    this.assertRoleAllowed(input.role, user);
    if (input.email !== undefined && input.login !== undefined) {
      throw new BadRequestException('Send either email or login');
    }
    const pinBrand = input.pin !== undefined ? this.pinBrandFor(input.storeIds, reach, input.role) : null;
    if (input.email === undefined && input.login === undefined) {
      return this.inviteWithPinOnly(input, pinBrand, reach, user);
    }
    if (input.tempPassword === undefined) {
      throw new BadRequestException('tempPassword is required with an email or a login');
    }
    const withPassword = { ...input, tempPassword: input.tempPassword };
    if (input.login !== undefined) {
      if (pinBrand && input.pin) await this.kitchenPins.newPinData(pinBrand, input.pin);
      return this.inviteByLogin({ ...withPassword, login: input.login }, pinBrand, reach, user);
    }
    const email = (input.email as string).toLowerCase();

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, userStores: { select: { storeId: true } } },
    });

    if (pinBrand && input.pin) {
      // A PIN belongs to one brand; an existing account must not work for another.
      if (existing && ![null, pinBrand].includes(await this.kitchenPins.brandOf(existing.id))) throw kdsPinMultiBrand();
      await this.kitchenPins.newPinData(pinBrand, input.pin, existing?.id);
    }

    let userId: string;
    if (!existing) {
      const passwordHash = await this.passwords.hash(withPassword.tempPassword);
      const created = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          passwordMustChange: true,
          name: input.name ?? null,
          role: input.role,
        },
        select: { id: true },
      });
      userId = created.id;
    } else {
      if (!STAFF_ROLES.includes(existing.role)) throw emailInUse();
      if (existing.userStores.some((s) => reach.has(s.storeId))) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: 'STAFF_ALREADY_ON_TEAM',
          userId: existing.id,
          message: 'This person already works here — change their stores on their page',
        });
      }
      if (!(await this.scope.managesUser(user, existing.id))) throw emailInUse();
      if (existing.role !== input.role) {
        // A manager inviting someone who manages another café would demote them.
        if (user.role === Role.STORE_MANAGER && existing.role === Role.STORE_MANAGER) {
          throw this.forbidden('STAFF_ROLE_NOT_ALLOWED', 'A store manager cannot change the role of another manager');
        }
        await this.prisma.user.update({ where: { id: existing.id }, data: { role: input.role } });
      }
      userId = existing.id;
    }

    await this.prisma.userStore.createMany({
      data: input.storeIds.map((storeId) => ({ userId, storeId })),
      skipDuplicates: true,
    });
    if (pinBrand && input.pin) await this.kitchenPins.assign(userId, pinBrand, input.pin);
    const member = await this.reload(userId, reach, user);
    // The person is on the team either way; the email only tells them so.
    const inviteEmail = await this.inviteMailer.send({
      userId,
      email,
      name: input.name ?? null,
      role: input.role,
      storeIds: input.storeIds,
      newAccount: !existing,
    });
    return { ...member, inviteEmail, accountCreated: !existing };
  }

  private async inviteByLogin(
    input: {
      login: string;
      name?: string;
      role: StaffRoleName;
      tempPassword: string;
      pin?: string;
      storeIds: string[];
    },
    pinBrand: string | null,
    reach: Reach,
    user: AuthenticatedUser,
  ): Promise<StaffInviteResult> {
    const { id: userId } = await createLoginAccount(this.prisma, {
      login: input.login.trim().toLowerCase(),
      passwordHash: await this.passwords.hash(input.tempPassword),
      name: input.name ?? null,
      role: input.role,
    });
    await this.prisma.userStore.createMany({
      data: input.storeIds.map((storeId) => ({ userId, storeId })),
      skipDuplicates: true,
    });
    if (pinBrand && input.pin) await this.kitchenPins.assign(userId, pinBrand, input.pin);
    const member = await this.reload(userId, reach, user);
    return { ...member, inviteEmail: 'NO_EMAIL', accountCreated: true };
  }

  /**
   * Kitchen staff with no email and no login: a name, stores and a PIN.
   * There is no password at all — the account cannot sign in to the
   * cabinet, only unlock the kitchen tablet of its stores — until the owner
   * adds a login ({@link addSignIn}). The account and its PIN are created in
   * one write, so a PIN taken in the meantime leaves nothing behind.
   */
  private async inviteWithPinOnly(
    input: InviteInput,
    pinBrand: string | null,
    reach: Reach,
    user: AuthenticatedUser,
  ): Promise<StaffInviteResult> {
    if (input.role !== Role.STAFF) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        code: 'STAFF_SIGN_IN_REQUIRED',
        message: 'Only kitchen staff can be invited without an email or a login',
      });
    }
    const name = input.name?.trim();
    if (!name || !input.pin || !pinBrand) {
      throw new BadRequestException('Someone invited without an email or a login needs a name and a PIN');
    }
    const pin = await this.kitchenPins.newPinData(pinBrand, input.pin);
    let userId: string;
    try {
      ({ id: userId } = await this.prisma.user.create({
        data: { name, role: Role.STAFF, ...pin },
        select: { id: true },
      }));
    } catch (err) {
      throw isPinCollision(err) ? kdsPinTaken() : err;
    }
    await this.prisma.userStore.createMany({
      data: input.storeIds.map((storeId) => ({ userId, storeId })),
      skipDuplicates: true,
    });
    const member = await this.reload(userId, reach, user);
    this.logger.log(`Kitchen staff ${userId} invited with a PIN only by ${user.id} (${user.role})`);
    return { ...member, inviteEmail: 'NO_EMAIL', accountCreated: true };
  }

  /**
   * Sets (or replaces) the person's kitchen PIN: one for every store they
   * work at in the brand. 409 `KDS_PIN_TAKEN` when somebody else at the
   * brand has it, `KDS_PIN_MULTI_BRAND` for someone who also works for
   * another brand. The person's tablet sessions end.
   */
  async setKdsPin(userId: string, pin: string, user: AuthenticatedUser, brandId?: string): Promise<StaffMember> {
    const reach = await this.reach(user, brandId);
    const row = await this.findOnTeam(userId, reach);
    this.assertEditable(row, user);
    if (!PIN_ROLES.includes(row.role)) throw new NotFoundException('User is not eligible for a KDS PIN');
    // A PIN signs in as the account: never for one that also works elsewhere.
    await this.assertManaged(userId, user);
    const pinBrand = await this.kitchenPins.brandOf(userId);
    if (!pinBrand) throw new NotFoundException('Staff member not found');
    await this.kitchenPins.assign(userId, pinBrand, pin);
    this.logger.log(`Kitchen PIN set: user ${userId} by ${user.id} (${user.role})`);
    return this.reload(userId, reach, user);
  }

  /** «Сбросить PIN»: the person can no longer unlock the tablet; their tablet sessions end. */
  async clearKdsPin(userId: string, user: AuthenticatedUser, brandId?: string): Promise<StaffMember> {
    const reach = await this.reach(user, brandId);
    const row = await this.findOnTeam(userId, reach);
    this.assertEditable(row, user);
    // Only a PIN of the caller's own: a brand PIN of a brand in reach, an
    // old PIN at a store in reach.
    const brands = new Set([...reach.values()].map((s) => s.brandId));
    const ours = row.kdsPinBrandId
      ? brands.has(row.kdsPinBrandId)
      : !!row.kdsPinStoreId && reach.has(row.kdsPinStoreId);
    if (row.kdsPinHash && ours) {
      await this.kitchenPins.clear(userId);
      this.logger.log(`Kitchen PIN reset: user ${userId} by ${user.id} (${user.role})`);
    }
    return this.reload(userId, reach, user);
  }

  /**
   * A way into the cabinet for someone invited with a PIN only: an email or
   * a login and a temporary password, changed at the first sign-in. Owners
   * and platform admins (the controller). Someone who already has an email
   * or a login gets their password reset instead (409 `STAFF_HAS_SIGN_IN`).
   * An email is also sent the invite letter with a link to set a password.
   */
  async addSignIn(
    userId: string,
    input: { email?: string; login?: string; tempPassword: string },
    user: AuthenticatedUser,
    brandId?: string,
  ): Promise<StaffInviteResult> {
    const reach = await this.reach(user, brandId);
    const row = await this.findOnTeam(userId, reach);
    this.assertEditable(row, user);
    await this.assertManaged(userId, user);
    if (row.email || row.login) {
      throw codedConflict(
        'STAFF_HAS_SIGN_IN',
        'This person already signs in with an email or a login — reset the password instead',
      );
    }
    const passwordHash = await this.passwords.hash(input.tempPassword);
    if (input.login !== undefined) {
      const login = input.login.trim().toLowerCase();
      const taken = await this.prisma.user.findFirst({
        where: { OR: [{ login }, { email: login }] },
        select: { id: true },
      });
      if (taken) throw loginInUse();
      await this.writeSignIn(userId, { login, passwordHash, passwordMustChange: true }, loginInUse);
    } else if (input.email !== undefined) {
      const email = input.email.toLowerCase();
      const taken = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (taken) throw emailInUse();
      await this.writeSignIn(userId, { email, passwordHash, passwordMustChange: true }, emailInUse);
    } else {
      throw new BadRequestException('Send either email or login');
    }
    this.logger.log(`Sign-in added: user ${userId} by ${user.id} (${user.role})`);

    const member = await this.reload(userId, reach, user);
    const inviteEmail =
      input.email !== undefined
        ? await this.inviteMailer.send({
            userId,
            email: input.email.toLowerCase(),
            name: row.name,
            role: row.role as StaffRoleName,
            storeIds: row.userStores.map((s) => s.storeId),
            newAccount: true,
          })
        : 'NO_EMAIL';
    return { ...member, inviteEmail, accountCreated: true };
  }

  private async writeSignIn(
    userId: string,
    data: Prisma.UserUpdateInput,
    taken: () => ConflictException,
  ): Promise<void> {
    try {
      await this.prisma.user.update({ where: { id: userId }, data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw taken();
      throw err;
    }
  }

  /**
   * «Сбросить пароль» on the person's page, for an employee who forgot it
   * and has no access to their email, or one who left with it. Owners and
   * platform admins only (the controller), and only for someone whose every
   * store is within the caller's brands — an account is global, and its
   * password opens the other brands' cabinets too. Someone invited with a
   * PIN only has no password to reset (409 `STAFF_NO_SIGN_IN`): add a login.
   *
   * The new password is generated here and answered once; it is never
   * stored in the clear, logged or mailed. It has to be changed at the next
   * sign-in. Every session of the person ends — the cabinet and the kitchen
   * tablet alike — and set-password links mailed before stop working. When
   * the server can send email the person also gets a fresh one-time link to
   * set their own password.
   */
  async resetPassword(userId: string, user: AuthenticatedUser, brandId?: string): Promise<StaffPasswordReset> {
    if (user.role !== Role.BRAND_ADMIN && user.role !== Role.SUPER_ADMIN) {
      throw this.forbidden('STAFF_NOT_EDITABLE', 'Only the owner can reset a password');
    }
    const reach = await this.reach(user, brandId);
    const row = await this.findOnTeam(userId, reach);
    this.assertEditable(row, user);
    await this.assertManaged(userId, user);
    if (!row.email && !row.login) {
      throw codedConflict('STAFF_NO_SIGN_IN', 'This person signs in with a kitchen PIN only — add a login first');
    }

    const { tempPassword, sessions } = await this.replacePassword(userId);
    const resetEmail = await this.mailReset(row);
    // Who did it to whom, for the audit trail — ids only, no password, no address.
    this.logger.log(
      `Staff password reset: user ${userId} by ${user.id} (${user.role}); sessions ended: ${sessions}; email: ${resetEmail}`,
    );
    return { tempPassword, resetEmail };
  }

  /**
   * «Сбросить пароль» on the brand owner's page, for the platform team: an
   * owner locked out of their cabinet on a server without mail has no other
   * way back. Platform admins only (the controller). The same as an
   * employee's reset — a temporary password answered once, to be changed at
   * the next sign-in; every session of the owner ends; a link to set their
   * own when the server can send mail.
   */
  async resetOwnerPassword(brandId: string, user: AuthenticatedUser): Promise<StaffPasswordReset> {
    if (user.role !== Role.SUPER_ADMIN) {
      throw this.forbidden('STAFF_NOT_EDITABLE', 'Only the platform team can reset an owner’s password');
    }
    const brand = await this.prisma.brand.findUnique({
      where: { id: brandId },
      select: {
        owner: { select: { id: true, role: true, email: true, name: true } },
        stores: { select: { id: true } },
      },
    });
    if (!brand) throw new NotFoundException('Brand not found');
    const owner = brand.owner;
    if (!owner) throw new NotFoundException('The brand has no owner');
    // A platform admin set as somebody's owner is still a platform admin:
    // their password is not the brand page's to change.
    if (owner.role !== Role.BRAND_ADMIN || owner.id === user.id) {
      throw this.forbidden('STAFF_NOT_EDITABLE', 'This account’s password cannot be reset here');
    }

    const { tempPassword, sessions } = await this.replacePassword(owner.id);
    let resetEmail: StaffPasswordReset['resetEmail'] = 'NO_EMAIL';
    if (owner.email) {
      try {
        resetEmail = await this.inviteMailer.sendPasswordReset({
          userId: owner.id,
          email: owner.email,
          name: owner.name,
          storeIds: brand.stores.map((s) => s.id),
        });
      } catch (err) {
        this.logger.error(`Password reset email for owner ${owner.id} failed: ${(err as Error).message}`);
        resetEmail = 'FAILED';
      }
    }
    this.logger.log(
      `Owner password reset: user ${owner.id} of brand ${brandId} by ${user.id}; sessions ended: ${sessions}; email: ${resetEmail}`,
    );
    return { tempPassword, resetEmail };
  }

  /**
   * Ends every session, then sets a generated temporary password to be
   * changed at the next sign-in and voids set-password links mailed before.
   * Sessions first: if that fails nothing has changed and the caller tries
   * again, rather than the password changing to one nobody was shown.
   * Access tokens already issued run out within minutes, as on any reset.
   */
  private async replacePassword(userId: string): Promise<{ tempPassword: string; sessions: number }> {
    const sessions = await this.tokens.revokeAll(userId);
    const tempPassword = generateTempPassword();
    const passwordHash = await this.passwords.hash(tempPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordMustChange: true } }),
      this.prisma.passwordResetToken.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
    ]);
    return { tempPassword, sessions };
  }

  /** The set-password link after a reset. The password has changed by now, so a failure here only says so. */
  private async mailReset(row: MemberRow): Promise<StaffPasswordReset['resetEmail']> {
    // Someone who signs in with a login has nowhere to get a link: the
    // temporary password on the owner's screen is the only way back in.
    if (!row.email) return 'NO_EMAIL';
    try {
      return await this.inviteMailer.sendPasswordReset({
        userId: row.id,
        email: row.email,
        name: row.name,
        storeIds: row.userStores.map((s) => s.storeId),
      });
    } catch (err) {
      this.logger.error(`Password reset email for user ${row.id} failed: ${(err as Error).message}`);
      return 'FAILED';
    }
  }

  /**
   * The brand a PIN given on the invite form belongs to: that of the
   * chosen stores. Only kitchen staff and managers work the tablet (400
   * `KDS_PIN_ROLE`), and a PIN belongs to one brand (409
   * `KDS_PIN_MULTI_BRAND` for stores of two — a platform admin's view).
   */
  private pinBrandFor(storeIds: string[], reach: Reach, role: StaffRoleName): string {
    if (!PIN_ROLES.includes(role)) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        code: 'KDS_PIN_ROLE',
        message: 'A kitchen PIN is for kitchen staff and store managers',
      });
    }
    const brands = new Set(storeIds.map((id) => reach.get(id)?.brandId));
    const [only] = [...brands];
    if (brands.size !== 1 || !only) throw kdsPinMultiBrand();
    return only;
  }

  /** Resets a PIN that opens none of the person's stores any more. */
  private async dropOrphanPin(userId: string): Promise<void> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kdsPinHash: true, kdsPinBrandId: true, kdsPinStoreId: true },
    });
    if (!row?.kdsPinHash) return;
    const where: Prisma.UserStoreWhereInput = row.kdsPinBrandId
      ? { userId, store: { brandId: row.kdsPinBrandId } }
      : row.kdsPinStoreId
        ? { userId, storeId: row.kdsPinStoreId }
        : { userId, storeId: '' };
    if ((await this.prisma.userStore.count({ where })) === 0) await this.kitchenPins.clear(userId);
  }

  private async reach(user: AuthenticatedUser, brandId?: string): Promise<Reach> {
    const brandIds = await this.scope.resolveBrandIds(user);
    if (brandId && brandIds !== null && !brandIds.includes(brandId)) {
      throw new ForbiddenException('Brand is outside your scope');
    }
    const where: Prisma.StoreWhereInput = {};
    if (brandId) where.brandId = brandId;
    else if (brandIds !== null) where.brandId = { in: brandIds };
    if (user.role === Role.STORE_MANAGER) where.userStores = { some: { userId: user.id } };
    const stores = await this.prisma.store.findMany({
      where,
      select: { id: true, name: true, brandId: true },
      orderBy: { name: 'asc' },
    });
    return new Map(stores.map((s) => [s.id, { name: s.name, brandId: s.brandId }]));
  }

  /** The person, with their stores inside the reach; 404 unless they work at one of them. */
  private async findOnTeam(userId: string, reach: Reach): Promise<MemberRow> {
    const row = await this.load(userId, reach);
    if (!row || !STAFF_ROLES.includes(row.role) || row.userStores.length === 0) {
      throw new NotFoundException('Staff member not found');
    }
    return row;
  }

  private async reload(userId: string, reach: Reach, user: AuthenticatedUser): Promise<StaffMember> {
    const row = await this.load(userId, reach);
    if (!row) throw new NotFoundException('Staff member not found');
    return this.toMember(row, reach, user);
  }

  private load(userId: string, reach: Reach): Promise<MemberRow | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...MEMBER_SELECT,
        userStores: { where: { storeId: { in: [...reach.keys()] } }, select: { storeId: true, createdAt: true } },
      },
    });
  }

  private assertWithinReach(storeIds: string[], reach: Reach): void {
    const outside = storeIds.filter((id) => !reach.has(id));
    if (outside.length > 0) {
      throw this.forbidden('STAFF_STORE_OUT_OF_SCOPE', 'One or more stores are outside your scope');
    }
  }

  private async assertManaged(userId: string, user: AuthenticatedUser): Promise<void> {
    if (!(await this.scope.managesUser(user, userId))) {
      throw this.forbidden('STAFF_NOT_EDITABLE', 'You cannot change this person’s access');
    }
  }

  private assertRoleAllowed(role: StaffRoleName, user: AuthenticatedUser): void {
    if (user.role === Role.STORE_MANAGER && role === Role.STORE_MANAGER) {
      throw this.forbidden('STAFF_ROLE_NOT_ALLOWED', 'A store manager cannot appoint managers');
    }
  }

  private assertEditable(row: MemberRow, user: AuthenticatedUser): void {
    if (!this.isEditable(row, user)) {
      throw this.forbidden('STAFF_NOT_EDITABLE', 'You cannot change this person’s access');
    }
  }

  private isEditable(row: { id: string; role: Role }, user: AuthenticatedUser): boolean {
    if (row.id === user.id) return false;
    return !(user.role === Role.STORE_MANAGER && row.role === Role.STORE_MANAGER);
  }

  private forbidden(code: string, message: string): ForbiddenException {
    return new ForbiddenException({ statusCode: 403, error: 'Forbidden', code, message });
  }

  private toMember(row: MemberRow, reach: Reach, user: AuthenticatedUser): StaffMember {
    const stores = row.userStores
      .map((s) => ({ id: s.storeId, name: reach.get(s.storeId)?.name ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const since = row.userStores.reduce<Date | null>(
      (earliest, s) => (earliest === null || s.createdAt < earliest ? s.createdAt : earliest),
      null,
    );
    const pinUsable = !!row.kdsPinHash && !row.kdsPinHash.startsWith(UNSET_PIN_PREFIX);
    // A brand PIN opens every listed store of its brand; an old PIN its one store.
    const brands = new Set(row.userStores.map((s) => reach.get(s.storeId)?.brandId));
    const brandPin = pinUsable && row.kdsPinBrandId !== null && brands.has(row.kdsPinBrandId);
    const legacyStore =
      pinUsable && row.kdsPinBrandId === null && row.kdsPinStoreId && stores.some((s) => s.id === row.kdsPinStoreId)
        ? row.kdsPinStoreId
        : null;
    return {
      userId: row.id,
      email: row.email,
      login: row.login,
      phone: row.phone,
      name: row.name,
      role: row.role as StaffRoleName,
      blocked: row.blockedAt !== null,
      addedAt: (since ?? row.createdAt).toISOString(),
      stores,
      kdsPinStoreId: legacyStore,
      hasKdsPin: brandPin || legacyStore !== null,
      editable: this.isEditable(row, user),
    };
  }
}

/** Same answer whatever the existing account is: no role, no name. */
function emailInUse(): ConflictException {
  return codedConflict(
    'STAFF_EMAIL_TAKEN',
    'This email is already in use. Ask the employee to use a different email.',
    'email',
  );
}
