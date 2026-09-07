import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { TelegramAdmin } from '@prisma/client';
import { parseStockImport, telegramAdminAllows } from '@webcatt/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { TelegramAdminAccessService, telegramActor } from './access.service';
import {
  TelegramAdminActionsService,
  type PreparedAction,
} from './actions.service';
import { TelegramAdminScreensService } from './screens.service';
import { command, type AdminCommandKind, type AdminField } from './commands';
import {
  adminText as t,
  renderAdminScreen,
  fieldPrompt,
  confirmText,
  type AdminLink,
  type AdminView,
} from './views';
import { botLang, type BotLang } from '../telegram/messages';
import { escapeHtml } from '../telegram/catalog-view';
import {
  tgCall,
  type TgMessage,
  type TgCallbackQuery,
} from '../telegram/telegram-api';
import { AuditService } from '../audit/audit.service';
import { mainMenuKeyboard } from '../telegram/wallet-view';
import { parseMessage, translate } from '../i18n/messages';
import { readAdminDocument, sendAdminDocument } from './transport';

interface Form {
  kind: AdminCommandKind;
  target: string;
  code: string;
  expected: string;
  current: Record<string, unknown>;
  fields: AdminField[];
  index: number;
  payload: Record<string, unknown>;
  verified: boolean;
  action?: PreparedAction;
}
interface Session {
  version: number;
  adminId: string;
  expires: number;
  lang: BotLang;
  messageId?: number;
  links: Map<string, AdminLink>;
  form?: Form;
  search?: string;
  route: string;
}
const SESSION_TTL = 10 * 60_000;
const ownsPrivate = (id: number, chat: { id: number; type: string }) =>
  Number.isSafeInteger(id) &&
  id > 0 &&
  chat.type === 'private' &&
  chat.id === id;

@Injectable()
export class TelegramAdminBotService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramAdminBotService.name);
  private readonly sessions = new Map<number, Session>();
  private readonly running = new Set<number>();
  private readonly cleanup = setInterval(() => {
    for (const [id, s] of this.sessions)
      if (s.expires < Date.now()) {
        this.sessions.delete(id);
      }
  }, 60000);
  constructor(
    private readonly access: TelegramAdminAccessService,
    private readonly actions: TelegramAdminActionsService,
    private readonly screens: TelegramAdminScreensService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {
    this.cleanup.unref();
  }
  onModuleDestroy() {
    clearInterval(this.cleanup);
    this.sessions.clear();
  }

  async message(
    token: string,
    message: TgMessage,
    stop: AbortSignal,
  ): Promise<boolean> {
    const text = message.text?.trim() ?? '',
      id = message.from?.id;
    const opening = /^\/admin(?:@\w+)?$/i.test(text),
      who = /^\/whoami(?:@\w+)?$/i.test(text);
    const current = id ? this.sessions.get(id) : undefined;
    if (!opening && !who && !current) {
      if (id && ownsPrivate(id, message.chat)) {
        const previous = await this.prisma.telegramAdmin.findUnique({ where: { telegramUserId: String(id) }, select: { inAdminMode: true } });
        if (previous?.inAdminMode) {
          if (text === '/start') { await this.prisma.telegramAdmin.updateMany({ where: { telegramUserId: String(id) }, data: { inAdminMode: false } }); return false; }
          await this.send(token, id, {text:t(botLang(message.from?.language_code),'expired'),keyboard:[]}, undefined, stop);
          return true;
        }
      }
      return false;
    }
    if (!id || !ownsPrivate(id, message.chat) || message.from?.is_bot)
      return true;
    const lang = current?.lang ?? botLang(message.from?.language_code);
    if (who) {
      await this.send(
        token,
        id,
        { text: `User ID: <code>${id}</code>`, keyboard: [] },
        undefined,
        stop,
      );
      return true;
    }
    if (this.running.has(id)) return true;
    this.running.add(id);
    try {
      const actor = await this.access.resolve(id);
      if (!actor) {
        this.sessions.delete(id);
        await this.send(
          token,
          id,
          { text: t(lang, 'forbidden'), keyboard: [] },
          undefined,
          stop,
        );
        return true;
      }
      if (opening) {
        const session: Session = {
          version: actor.version,
          adminId: actor.id,
          lang,
          expires: Date.now() + SESSION_TTL,
          links: new Map(),
          route: 'home',
        };
        this.sessions.set(id, session);
        await this.prisma.telegramAdmin.updateMany({
          where: { id: actor.id },
          data: { lastSeenAt: new Date(), inAdminMode: true },
        });
        await this.navigate(token, id, actor, session, 'home', stop);
        return true;
      }
      if (
        !current ||
        current.expires < Date.now() ||
        current.adminId !== actor.id ||
        current.version !== actor.version
      ) {
        this.sessions.delete(id);
        await this.send(
          token,
          id,
          { text: t(lang, 'expired'), keyboard: [] },
          undefined,
          stop,
        );
        return true;
      }
      if (text === '/start') {
        await this.prisma.telegramAdmin.updateMany({ where: { id: actor.id }, data: { inAdminMode: false } });
        this.sessions.delete(id);
        return false;
      }
      if (text === '/cancel') {
        current.form = undefined;
        current.search = undefined;
        await this.navigate(token, id, actor, current, 'home', stop);
        return true;
      }
      if (current.search) {
        const route = `${current.search}||1|ALL|${text.slice(0, 100)}`;
        current.search = undefined;
        await this.navigate(token, id, actor, current, route, stop);
        return true;
      }
      const form = current.form;
      if (!form) {
        await this.navigate(token, id, actor, current, 'home', stop);
        return true;
      }
      const spec = command(form.kind)!;
      if (!telegramAdminAllows(actor.permission, spec.permission))
        throw Error('permission');
      if (form.index < form.fields.length) {
        const field = form.fields[form.index]!;
        const value =
          message.document && field.type === 'stock'
            ? await readAdminDocument(token, message.document, stop)
            : text;
        form.payload[field.key] = this.value(field, value);
        if (field.secret)
          await tgCall(
            token,
            'deleteMessage',
            { chat_id: id, message_id: message.message_id },
            5000,
            stop,
          ).catch(() => undefined);
        form.index++;
      } else if (spec.sensitive && !form.verified) {
        if (text !== form.code) {
          await this.send(
            token,
            id,
            { text: t(lang, 'invalid'), keyboard: [] },
            undefined,
            stop,
          );
          return true;
        }
        form.verified = true;
      }
      await this.advance(token, id, actor, current, stop);
      return true;
    } catch (error) {
      this.logger.warn('Telegram admin input failed');
      await this.send(
        token,
        id,
        { text: this.errorText(error, lang), keyboard: [] },
        undefined,
        stop,
      ).catch(() => undefined);
      return true;
    } finally {
      this.running.delete(id);
    }
  }

  async callback(
    token: string,
    cb: TgCallbackQuery,
    stop: AbortSignal,
  ): Promise<boolean> {
    if (!cb.data?.startsWith('adm:')) return false;
    // Luôn tắt spinner, kể cả callback hết hạn hoặc người không có quyền.
    await tgCall(
      token,
      'answerCallbackQuery',
      { callback_query_id: cb.id },
      5000,
      stop,
    ).catch(() => undefined);
    const id = cb.from.id,
      message = cb.message;
    if (
      !message ||
      !ownsPrivate(id, message.chat) ||
      cb.from.is_bot ||
      this.running.has(id)
    )
      return true;
    this.running.add(id);
    let session = this.sessions.get(id);
    try {
      const actor = await this.access.resolve(id);
      if (
        !actor ||
        !session ||
        session.expires < Date.now() ||
        session.version !== actor.version ||
        session.adminId !== actor.id ||
        session.messageId !== message.message_id
      ) {
        this.sessions.delete(id);
        await this.send(
          token,
          id,
          {
            text: t(session?.lang ?? botLang(cb.from.language_code), 'expired'),
            keyboard: [],
          },
          undefined,
          stop,
        );
        return true;
      }
      const link = session.links.get(cb.data);
      if (!link) return true;
      if (link.command) {
        await this.startForm(token, id, actor, session, link, stop);
        return true;
      }
      const route = link.route ?? 'home';
      if (route === 'exit') {
        await this.prisma.telegramAdmin.updateMany({ where: { id: actor.id }, data: { inAdminMode: false } });
        this.sessions.delete(id);
        await tgCall(
          token,
          'sendMessage',
          {
            chat_id: id,
            text: t(session.lang, 'store'),
            reply_markup: mainMenuKeyboard(session.lang),
          },
          10000,
          stop,
        );
        return true;
      }
      if (route === 'form:confirm') {
        const action = session.form?.action;
        if (!action) return true;
        if (command(action.kind)?.sensitive && !session.form?.verified)
          return true;
        const result = await this.actions.execute(actor, action);
        // Sau commit, không giữ secret hoặc file trong bản nháp.
        session.form = undefined;
        await this.send(
          token,
          id,
          {
            text: escapeHtml(
              `${t(session.lang, result.state === 'done' ? 'done' : 'processing')}\n${result.summary ?? ''}`,
            ),
            keyboard: this.keyboard(session, [
              ...(action.kind === 'stock.withdraw'
                ? [
                    {
                      label: t(session.lang, 'export'),
                      route: `result|${action.id}`,
                    },
                  ]
                : []),
              { label: t(session.lang, 'back'), route: 'home' },
            ]),
          },
          session,
          stop,
        );
        if (result.file) {
          await sendAdminDocument(token, id, result.file, stop);
          await this.audit.log(
            telegramActor(actor),
            'settings.update',
            { type: 'telegram-export', id: action.targetId },
            { kind: action.kind },
          );
        }
        return true;
      }
      if (route.startsWith('result|')) {
        const result = await this.actions.receipt(actor, route.slice(7));
        if (result.file) await sendAdminDocument(token, id, result.file, stop);
        return true;
      }
      if (route.startsWith('field:')) {
        const form = session.form;
        if (!form) return true;
        const field = form.fields[form.index];
        if (!field) return true;
        const selected = route.slice(6);
        if (selected === 'skip') {
          if (!field.optional) return true;
        } else if (selected === 'clear') {
          if (!field.optional || field.secret) return true;
          form.payload[field.key] = '';
        } else {
          form.payload[field.key] = this.value(field, selected);
        }
        form.index++;
        await this.advance(token, id, actor, session, stop);
        return true;
      }
      if (route.startsWith('export-')) {
        if (!telegramAdminAllows(actor.permission, 'FULL'))
          throw Error('permission');
        const file = await this.screens.export(route, actor);
        await sendAdminDocument(token, id, file, stop);
        await this.audit.log(
          telegramActor(actor),
          'settings.update',
          { type: 'telegram-export', id: route.split('|')[1]! },
          { kind: route.split('|')[0] },
        );
        return true;
      }
      session.form = undefined;
      if (route.startsWith('search|')) {
        session.search = route.split('|')[1];
        await this.send(
          token,
          id,
          {
            text: t(session.lang, 'search'),
            keyboard: this.keyboard(session, [
              { label: t(session.lang, 'cancel'), route: 'home' },
            ]),
          },
          session,
          stop,
        );
        return true;
      }
      await this.navigate(token, id, actor, session, route, stop);
      return true;
    } catch (error) {
      this.logger.warn('Telegram admin action failed');
      await this.send(
        token,
        id,
        { text: this.errorText(error, session?.lang ?? 'vi'), keyboard: [] },
        undefined,
        stop,
      ).catch(() => undefined);
      return true;
    } finally {
      this.running.delete(id);
    }
  }

  private async navigate(
    token: string,
    id: number,
    actor: TelegramAdmin,
    session: Session,
    route: string,
    stop: AbortSignal,
  ) {
    session.expires = Date.now() + SESSION_TTL;
    session.route = route;
    const data = await this.screens.load(route, actor, session.lang);
    session.links.clear();
    const view = renderAdminScreen(
      data.title,
      data.lines,
      data.links,
      actor.permission,
      (l) => this.link(session, l),
    );
    await this.send(token, id, view, session, stop);
  }
  private link(session: Session, link: AdminLink) {
    const code = `adm:${randomBytes(12).toString('hex')}`;
    session.links.set(code, link);
    return code;
  }
  private keyboard(session: Session, links: AdminLink[]) {
    session.links.clear();
    return links.map((l) => [
      { text: l.label, callback_data: this.link(session, l) },
    ]);
  }
  private async startForm(
    token: string,
    id: number,
    actor: TelegramAdmin,
    session: Session,
    link: AdminLink,
    stop: AbortSignal,
  ) {
    const spec = command(link.command!);
    if (!spec || !telegramAdminAllows(actor.permission, spec.permission))
      throw Error('permission');
    const target = link.target ?? 'main',
      snapshot = await this.actions.snapshot(link.command!, target);
    let current = snapshot.current;
    if (link.command?.startsWith('settings.'))
      current = (await this.settings.getAdmin()) as unknown as Record<
        string,
        unknown
      >;
    if (link.command?.startsWith('variant.'))
      current = { ...current, price: current.priceAmount };
    const initial: Record<string, unknown> = {};
    const editing =
      link.command?.endsWith('.edit') || link.command?.startsWith('settings.');
    const fields = spec.fields.map((field) => {
      const value = current[field.key];
      if (!editing || field.secret || value === undefined || value === null)
        return field;
      initial[field.key] =
        field.type === 'number'
          ? Number(value)
          : value instanceof Date
            ? value.toISOString()
            : value;
      return { ...field, optional: true };
    });
    session.form = {
      kind: link.command as AdminCommandKind,
      target,
      code: snapshot.label,
      expected: snapshot.hash,
      current,
      fields,
      index: 0,
      payload: initial,
      verified: false,
    };
    await this.advance(token, id, actor, session, stop);
  }
  private async advance(
    token: string,
    id: number,
    actor: TelegramAdmin,
    session: Session,
    stop: AbortSignal,
  ) {
    const form = session.form!;
    const spec = command(form.kind)!;
    const field = form.fields[form.index];
    const links: AdminLink[] = [
      { label: t(session.lang, 'cancel'), route: 'home' },
    ];
    if (field) {
      if (field.choices)
        links.unshift(
          ...field.choices.map((value) => ({
            label: value,
            route: `field:${value}`,
          })),
        );
      if (field.optional)
        links.unshift({ label: t(session.lang, 'skip'), route: 'field:skip' });
      if (field.optional && !field.secret && field.type === 'text')
        links.unshift({
          label: t(session.lang, 'clear'),
          route: 'field:clear',
        });
      await this.send(
        token,
        id,
        {
          text: fieldPrompt(
            field,
            form.current[field.key],
            form.index,
            form.fields.length,
            session.lang,
          ),
          keyboard: this.keyboard(session, links),
        },
        session,
        stop,
      );
      return;
    }
    const text = confirmText(
      t(session.lang, spec.title),
      form.code,
      form.current,
      form.payload,
      form.fields,
      session.lang,
    );
    if (spec.sensitive && !form.verified) {
      await this.send(
        token,
        id,
        {
          text: `${text}\n\n${t(session.lang, 'verifyTarget')}: <code>${escapeHtml(form.code)}</code>`,
          keyboard: this.keyboard(session, links),
        },
        session,
        stop,
      );
      return;
    }
    form.action = await this.actions.prepare(
      actor,
      form.kind,
      form.target,
      form.payload,
      form.expected,
      form.code,
    );
    links.unshift({ label: t(session.lang, 'confirm'), route: 'form:confirm' });
    await this.send(
      token,
      id,
      { text, keyboard: this.keyboard(session, links) },
      session,
      stop,
    );
  }
  private value(field: AdminField, raw: string): unknown {
    if (!raw || raw.length > (field.type === 'stock' ? 1_000_000 : 10000))
      throw Error('invalid');
    if (field.choices && !field.choices.includes(raw)) throw Error('invalid');
    if (field.type === 'boolean') return raw === 'true';
    if (field.type === 'number') {
      if (!/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw)))
        throw Error('invalid');
      return Number(raw);
    }
    if (field.type === 'json') return JSON.parse(raw);
    if (field.type === 'stock') {
      const items = parseStockImport(raw).items;
      if (!items.length || items.length > 1000) throw Error('invalid');
      return items.join('\n');
    }
    return raw;
  }
  private errorText(error: unknown, lang: BotLang): string {
    const response =
      typeof (error as { getResponse?: unknown })?.getResponse === 'function'
        ? (error as { getResponse(): unknown }).getResponse()
        : null;
    const value =
      typeof response === 'object' && response !== null && 'message' in response
        ? (response as { message: unknown }).message
        : response;
    const parsed = typeof value === 'string' ? parseMessage(value) : null;
    return escapeHtml(
      parsed ? translate(parsed.key, lang, parsed.params) : t(lang, 'invalid'),
    );
  }
  private async send(
    token: string,
    id: number,
    view: AdminView,
    session: Session | undefined,
    stop: AbortSignal,
  ) {
    const payload = {
      chat_id: id,
      text: view.text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: view.keyboard },
      link_preview_options: { is_disabled: true },
      protect_content: true,
    };
    if (session?.messageId) {
      try {
        await tgCall(
          token,
          'editMessageText',
          { ...payload, message_id: session.messageId },
          10000,
          stop,
        );
        return;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('message is not modified')
        )
          return;
      }
    }
    const message = await tgCall<TgMessage>(
      token,
      'sendMessage',
      payload,
      10000,
      stop,
    );
    if (session) session.messageId = message.message_id;
  }
}
