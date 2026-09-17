import { describe, expect, it } from 'vitest';
import { createDefaultStorefrontDocument, type StorefrontDraftDto } from '@webcatt/shared';
import { BuilderDraftSession } from './builder-draft';

function draft(version = 4): StorefrontDraftDto {
  return { document: createDefaultStorefrontDocument('Original'), version, updatedAt: '2026-09-17T00:00:00.000Z' };
}
function edit(session: BuilderDraftSession, name: string) {
  const document = structuredClone(session.document!);
  document.brand.name = name;
  session.edit(document);
}

describe('builder draft save lifecycle', () => {
  it('retains a conflicting draft and pauses all automatic and manual saves until explicit reload', () => {
    const session = new BuilderDraftSession(); session.load(draft()); edit(session, 'My draft');
    const ticket = session.beginSave()!;
    session.rejectSave(ticket, 409);
    expect(session.document?.brand.name).toBe('My draft');
    expect(session.version).toBe(4);
    expect(session.dirty).toBe(true);
    expect(session.status).toBe('conflict');
    expect(session.beginSave()).toBeNull();
    expect(session.beginSave(true)).toBeNull();
    edit(session, 'Still mine');
    expect(session.beginSave()).toBeNull();
  });

  it('does not blindly retry transport errors, including after further edits', () => {
    const session = new BuilderDraftSession(); session.load(draft()); edit(session, 'Offline draft');
    session.rejectSave(session.beginSave()!, 0);
    expect(session.beginSave()).toBeNull();
    edit(session, 'More offline edits');
    expect(session.beginSave()).toBeNull();
    const retry = session.beginSave(true)!;
    expect(retry.version).toBe(4);
    expect(retry.document.brand.name).toBe('More offline edits');
  });

  it('advances CAS version without clearing edits made during an outstanding save', () => {
    const session = new BuilderDraftSession(); session.load(draft()); edit(session, 'First');
    const ticket = session.beginSave()!;
    expect(session.beginSave(true)).toBeNull();
    edit(session, 'Newer');
    expect(session.acceptSave(ticket, { ...draft(5), document: ticket.document })).toBe(false);
    expect(session.version).toBe(5);
    expect(session.document?.brand.name).toBe('Newer');
    expect(session.dirty).toBe(true);
    expect(session.beginSave()!.version).toBe(5);
  });

  it('ignores save results from a superseded load and accepts a current sanitized result', () => {
    const session = new BuilderDraftSession(); session.load(draft()); edit(session, 'Old');
    const old = session.beginSave()!;
    session.load(draft(9));
    expect(session.acceptSave(old, draft(5))).toBe(false);
    expect(session.version).toBe(9);
    edit(session, 'New');
    const current = session.beginSave()!;
    const sanitized = draft(10); sanitized.document.brand.name = 'Sanitized';
    expect(session.acceptSave(current, sanitized)).toBe(true);
    expect(session.document?.brand.name).toBe('Sanitized');
    expect(session.dirty).toBe(false);
  });
});
