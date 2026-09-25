import { MailWorkspace } from '@/components/mail/mail-workspace';
import { getServerDictionary } from '@/lib/i18n/server';
export async function generateMetadata() { const { t } = await getServerDictionary(); return { title: t.mail.nav, robots: { index: false, follow: false } }; }
export default function GmailPage() { return <MailWorkspace />; }
