-- LeadEvent.data -> payload: `data` is a Prisma argument keyword, and the
-- workspace scope must be able to tell field names and keywords apart.
ALTER TABLE "LeadEvent" RENAME COLUMN "data" TO "payload";
