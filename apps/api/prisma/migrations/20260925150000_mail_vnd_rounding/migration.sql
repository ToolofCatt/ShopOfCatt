ALTER TABLE "MailProviderSetting" ADD COLUMN "vndRounding" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MailProviderSetting" ADD CONSTRAINT "MailProviderSetting_vndRounding_check" CHECK ("vndRounding" IN (0, 1000));
