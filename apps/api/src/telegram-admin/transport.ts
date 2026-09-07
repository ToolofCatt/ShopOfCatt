import { BadRequestException } from '@nestjs/common';
import { tgCall, type TgMessage } from '../telegram/telegram-api';
import { K } from '../i18n/messages';

export async function readAdminDocument(
  token: string,
  doc: NonNullable<TgMessage['document']>,
  stop: AbortSignal,
): Promise<string> {
  if (
    !/\.(json|txt)$/i.test(doc.file_name ?? '') ||
    !doc.file_size ||
    doc.file_size > 1_000_000
  )
    throw new BadRequestException(K.adminStockContentInvalid);
  const file = await tgCall<{ file_path: string; file_size?: number }>(
    token,
    'getFile',
    { file_id: doc.file_id },
    10000,
    stop,
  );
  if (
    (file.file_size && file.file_size > 1_000_000) ||
    !/^[a-zA-Z0-9_./-]+$/.test(file.file_path) ||
    file.file_path.includes('..')
  )
    throw new BadRequestException(K.adminStockContentInvalid);
  const response = await fetch(
    `https://api.telegram.org/file/bot${token}/${file.file_path}`,
    {
      signal: AbortSignal.any([stop, AbortSignal.timeout(15000)]),
      redirect: 'error',
    },
  );
  if (!response.ok || !response.body)
    throw new BadRequestException(K.adminStockContentInvalid);
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1_000_000)
        throw new BadRequestException(K.adminStockContentInvalid);
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    throw new BadRequestException(K.adminStockContentInvalid);
  }
}

export async function sendAdminDocument(
  token: string,
  chatId: number,
  file: { name: string; text: string },
  stop: AbortSignal,
): Promise<void> {
  if (Buffer.byteLength(file.text) > 10_000_000)
    throw new BadRequestException(K.adminLimitInvalid);
  const form = new FormData();
  form.set('chat_id', String(chatId));
  form.set(
    'document',
    new Blob([file.text], { type: 'text/plain;charset=utf-8' }),
    file.name,
  );
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendDocument`,
    {
      method: 'POST',
      body: form,
      signal: AbortSignal.any([stop, AbortSignal.timeout(20000)]),
    },
  );
  const body = (await response.json()) as { ok?: boolean };
  if (!body.ok) throw new Error('Telegram document delivery failed');
}
