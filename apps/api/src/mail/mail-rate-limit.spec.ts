import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { RateLimitGuard } from '../security/rate-limit.guard';
import { RateLimitService } from '../security/rate-limit.service';
import { MailController } from './mail.controller';

describe('Mail public catalog admission', () => {
  it('registers the real guard and rejects request 101', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, MailController.prototype.list) as unknown[];
    expect(guards).toContain(RateLimitGuard);
    const guard = new RateLimitGuard(new Reflector(), new RateLimitService());
    const context = {
      getHandler: () => MailController.prototype.list,
      getClass: () => MailController,
      switchToHttp: () => ({ getRequest: () => ({ method: 'GET', route: { path: '/mail/catalog' }, ip: '127.0.0.1' }) }),
    } as unknown as ExecutionContext;
    for (let i = 0; i < 100; i++) expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow();
  });
});
