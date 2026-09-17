import { API_KEY_DEFAULT_DAYS, API_KEY_MAX_DAYS, API_SCOPES, type ApiKeyDto, type ApiScope } from '@webcatt/shared';
import { ApiError } from './api';

export const DEFAULT_API_SCOPES: ApiScope[] = ['catalog:read', 'wallet:read', 'deposits:read', 'orders:read'];

export function buildApiKeyInput(name: string, scopes: ApiScope[] = DEFAULT_API_SCOPES, expiresInDays = API_KEY_DEFAULT_DAYS) {
  if (!name.trim() || name.trim().length > 80 || scopes.length === 0 || scopes.some((scope) => !API_SCOPES.includes(scope)) || !Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > API_KEY_MAX_DAYS) throw new Error('Invalid API key input');
  // Quyền ghi không kéo theo quyền đọc: đọc đơn có thể làm lộ hàng đã giao.
  return { name: name.trim(), scopes: [...new Set(scopes)], expiresInDays };
}

export interface KeyCreationState { phase: 'idle' | 'creating' | 'revealed' | 'uncertain'; secret: string | null }
export type KeyCreationAction = { type: 'start' | 'discard' | 'unknown' | 'failed' | 'metadataReloaded' | 'pageHidden' } | { type: 'created'; secret: string };
export const initialKeyCreation: KeyCreationState = { phase: 'idle', secret: null };

export function keyCreationReducer(state: KeyCreationState, action: KeyCreationAction): KeyCreationState {
  switch (action.type) {
    case 'start': return state.phase === 'idle' ? { phase: 'creating', secret: null } : state;
    case 'created': return state.phase === 'creating' ? { phase: 'revealed', secret: action.secret } : state;
    case 'unknown': return { phase: 'uncertain', secret: null };
    case 'pageHidden': return state.phase === 'creating' || state.phase === 'uncertain' ? { phase: 'uncertain', secret: null } : initialKeyCreation;
    case 'metadataReloaded': return state.phase === 'uncertain' ? initialKeyCreation : state;
    case 'failed':
    case 'discard': return initialKeyCreation;
  }
}

export function isUnknownKeyCreation(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}

export function apiKeyStatus(key: ApiKeyDto, now: number): 'active' | 'expired' | 'revoked' {
  if (key.revokedAt) return 'revoked';
  return Date.parse(key.expiresAt) > now ? 'active' : 'expired';
}

export function partnerPublicBaseUrl(publicApi?: string, publicSite?: string): string {
  const site = publicSite && /^https?:\/\//i.test(publicSite) ? publicSite : undefined;
  const value = publicApi && (/^https?:\/\//i.test(publicApi) || /^\/(?!\/)/.test(publicApi)) ? publicApi : '/api';
  try {
    const url = new URL(value, site);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid public URL');
    return `${url.origin}${url.pathname.replace(/\/$/, '')}/v1`;
  } catch { return '/api/v1'; }
}

export function partnerCodeSamples(base: string) {
  // Không nhận key thật hay URL nội bộ; ví dụ chỉ đọc catalog, tránh log hàng đã giao.
  const safeBase = base.replace(/["'`$\\\r\n]/g, '');
  return {
    curl: `curl --fail-with-body --silent --show-error \\\n  --header "Authorization: Bearer $CATT_API_KEY" \\\n  "${safeBase}/products"`,
    python: `import json, os, urllib.request\n\nbase = "${safeBase}"\nrequest = urllib.request.Request(\n    base + "/products",\n    headers={"Authorization": "Bearer " + os.environ["CATT_API_KEY"]},\n)\nwith urllib.request.urlopen(request, timeout=30) as response:\n    print(json.load(response))`,
    node: `const key = process.env.CATT_API_KEY;\nif (!key) throw new Error("Set CATT_API_KEY in your environment");\nconst response = await fetch("${safeBase}/products", {\n  headers: { Authorization: \`Bearer \${key}\` },\n  signal: AbortSignal.timeout(30_000),\n});\nif (!response.ok) throw new Error(\`HTTP \${response.status}\`);\nconsole.log(await response.json());`,
  };
}
