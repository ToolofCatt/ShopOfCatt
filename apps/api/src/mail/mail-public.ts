/** Chặn dấu vết nguồn trong metadata có thể đi đến khách, kể cả dữ liệu nguồn đổi tên. */
export function publicMailName(name: string): string {
  return name.replace(/https?:\/\/\S+/gi, '').replace(/\b(?:5mail(?:\.io)?|mailsapi(?:\.com)?)\b/gi, '').replace(/\s+/g, ' ').replace(/^[\s|·:—-]+|[\s|·:—-]+$/g, '') || 'Mail';
}

/** TXT chỉ có dữ liệu dùng tại cửa hàng, không xuất URL/token/cú pháp thô của nguồn. */
export function customerMailExport(rows: { account: string; codes: { code: string }[] }[]): string {
  return rows.map(mailbox => [mailbox.account, mailbox.codes.map(c => c.code).join(',')].join('\t')).join('\n');
}
