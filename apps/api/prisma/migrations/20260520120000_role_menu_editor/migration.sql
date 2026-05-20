-- Adds MENU_EDITOR to the Role enum.
--
-- MENU_EDITOR is a brand-scoped staff role that can edit menu (categories,
-- products, variations, modifiers) for the brands they're assigned to via
-- the UserStore pivot. Unlike STORE_MANAGER they cannot touch store hours,
-- staff roster, or orders.
--
-- Postgres requires ALTER TYPE ... ADD VALUE to run outside a transaction;
-- Prisma applies this migration in its own transaction-free wrapper.

-- AlterEnum — Role
ALTER TYPE "Role" ADD VALUE 'MENU_EDITOR';
