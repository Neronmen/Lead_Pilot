-- Wrong-password attempts on an invite link. An existing account accepting an
-- invite proves itself with its password; after 5 failures the invite expires,
-- so a leaked link cannot be used to guess that password for 7 days.
ALTER TABLE "Invite" ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;
