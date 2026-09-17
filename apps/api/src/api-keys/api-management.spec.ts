import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { SuperAdminGuard } from '../auth/superadmin.guard';
import { AccountApiKeysController } from './account-api-keys.controller';
import { AdminApiKeysController } from './admin-api-keys.controller';
import { CreateApiKeyDto, ApiAccountsQueryDto, SetApiAccessDto } from './dto/api-keys.dto';

const errors = async (data: object) => validate(plainToInstance(CreateApiKeyDto, data), { whitelist: true, forbidNonWhitelisted: true });

describe('API-key management HTTP contract', () => {
  it('requires JWT on all management routes and SUPERADMIN on cross-account mutations', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AccountApiKeysController)).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminApiKeysController)).toEqual(expect.arrayContaining([JwtAuthGuard, AdminGuard]));
    for (const method of ['setAccess', 'revoke'] as const) expect(Reflect.getMetadata(GUARDS_METADATA, AdminApiKeysController.prototype[method])).toContain(SuperAdminGuard);
  });

  it('never caches plaintext creation response or account/key metadata', () => {
    for (const handler of [AccountApiKeysController.prototype.create, AccountApiKeysController.prototype.getAccount, AdminApiKeysController.prototype.listKeys]) {
      expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    }
  });

  it('accepts only finite explicit scopes with strict expiry and bounded names', async () => {
    expect(await errors({ name: 'bot', scopes: ['orders:write'], expiresInDays: 90 })).toHaveLength(0);
    expect(await errors({ name: 'bot' })).toHaveLength(0);
    for (const input of [
      { name: ' ' }, { name: 'a'.repeat(81) }, { name: 'bot', scopes: ['admin'] },
      { name: 'bot', scopes: [] }, { name: 'bot', scopes: ['orders:read', 'orders:read'] },
      { name: 'bot', expiresInDays: 91 }, { name: 'bot', expiresInDays: 0 },
      { name: 'bot', expiresInDays: 1.2 }, { name: 'bot', expiresInDays: '30' },
      { name: 'bot', scopes: null }, { name: 'bot', expiresInDays: null }, { name: 'bot', ownerId: 'other' },
    ]) expect(await errors(input)).not.toHaveLength(0);
  });

  it('strips client-supplied identity/role using the application validation contract', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const dto = await pipe.transform({ name: 'bot', ownerId: 'other', role: 'SUPERADMIN' }, { type: 'body', metatype: CreateApiKeyDto });
    expect(dto.name).toBe('bot');
    expect(dto.ownerId).toBeUndefined();
    expect(dto.role).toBeUndefined();
  });

  it('does not convert approval strings to booleans and bounds pagination', async () => {
    for (const enabled of ['true', 'false', 1, null]) expect(await validate(plainToInstance(SetApiAccessDto, { enabled }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(SetApiAccessDto, { enabled: false }))).toHaveLength(0);
    expect(await validate(plainToInstance(ApiAccountsQueryDto, { page: '2', limit: '20', q: 'bot' }))).toHaveLength(0);
    for (const query of [{ page: 0 }, { limit: 101 }, { q: 'x'.repeat(101) }]) expect(await validate(plainToInstance(ApiAccountsQueryDto, query))).not.toHaveLength(0);
  });
});
