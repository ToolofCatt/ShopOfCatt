import type { StorefrontDocument, StorefrontDraftDto } from '@webcatt/shared';

export type BuilderSaveStatus = 'saved' | 'saving' | 'dirty' | 'error' | 'conflict';
export interface BuilderSaveTicket { document: StorefrontDocument; version: number; generation: number; edit: number }

export class BuilderDraftSession {
  document: StorefrontDocument | null = null;
  version = 1;
  dirty = false;
  status: BuilderSaveStatus = 'saved';
  private generation = 0;
  private edits = 0;
  private active: BuilderSaveTicket | null = null;

  load(draft: StorefrontDraftDto) {
    this.document = draft.document; this.version = draft.version;
    this.dirty = false; this.status = 'saved'; this.active = null; this.generation++;
  }
  edit(document: StorefrontDocument) {
    this.document = document; this.edits++; this.dirty = true;
    if (this.status !== 'error' && this.status !== 'conflict' && this.status !== 'saving') this.status = 'dirty';
  }
  beginSave(manual = false): BuilderSaveTicket | null {
    // Lỗi mạng có thể đã ghi thành công ở server; không tự gửi lại khi chưa biết kết quả.
    if (!this.document || !this.dirty || this.active || this.status === 'conflict' || (!manual && this.status === 'error')) return null;
    const ticket = { document: structuredClone(this.document), version: this.version, generation: this.generation, edit: this.edits };
    this.active = ticket; this.status = 'saving'; return ticket;
  }
  acceptSave(ticket: BuilderSaveTicket, result: StorefrontDraftDto): boolean {
    if (ticket !== this.active || ticket.generation !== this.generation) return false;
    this.active = null; this.version = result.version;
    const unchanged = ticket.edit === this.edits;
    if (unchanged) { this.document = result.document; this.dirty = false; }
    this.status = unchanged ? 'saved' : 'dirty'; return unchanged;
  }
  rejectSave(ticket: BuilderSaveTicket, status: number) {
    if (ticket !== this.active || ticket.generation !== this.generation) return;
    this.active = null; this.status = status === 409 ? 'conflict' : 'error';
  }
}
