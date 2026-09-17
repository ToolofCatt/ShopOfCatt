import { ApiDocs } from '@/components/api-docs';
import { partnerPublicBaseUrl } from '@/lib/api-key';
import { getServerDictionary } from '@/lib/i18n/server';

export default async function ApiDocsPage() {
  const { t } = await getServerDictionary();
  // Tuyệt đối không dùng apiBaseUrl ở SSR: API_URL có thể trỏ vào mạng Docker nội bộ.
  const baseUrl = partnerPublicBaseUrl(process.env.NEXT_PUBLIC_API_URL, process.env.NEXT_PUBLIC_SITE_URL);
  return <ApiDocs copy={t.partnerApi} baseUrl={baseUrl} />;
}
