-- Flag for invited staff whose temp password must be rotated on first
-- login. False by default so existing users (self-seeded super-admin
-- and anyone who set their own password) are unaffected.
ALTER TABLE "User" ADD COLUMN "passwordMustChange" BOOLEAN NOT NULL DEFAULT false;
