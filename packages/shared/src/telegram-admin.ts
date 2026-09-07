export const TELEGRAM_ADMIN_PERMISSIONS = [
  'VIEWER',
  'OPERATOR',
  'FULL',
] as const;
export type TelegramAdminPermission =
  (typeof TELEGRAM_ADMIN_PERMISSIONS)[number];

export interface TelegramAdminDto {
  id: string;
  telegramUserId: string;
  name: string;
  permission: TelegramAdminPermission;
  enabled: boolean;
  version: number;
  lastSeenAt: string | null;
}

export interface TelegramAdminSettingsDto {
  enabled: boolean;
  admins: TelegramAdminDto[];
  pendingActions: {
    id: string;
    telegramUserId: string;
    kind: string;
    targetId: string;
    status: string;
    updatedAt: string;
  }[];
}

export function validTelegramAdminId(value: string): boolean {
  return (
    /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value))
  );
}

export function telegramAdminAllows(
  actual: TelegramAdminPermission,
  required: TelegramAdminPermission,
): boolean {
  const actualRank = TELEGRAM_ADMIN_PERMISSIONS.indexOf(actual);
  const requiredRank = TELEGRAM_ADMIN_PERMISSIONS.indexOf(required);
  return actualRank >= 0 && requiredRank >= 0 && actualRank >= requiredRank;
}
