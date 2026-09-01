/** Hợp đồng giao diện cửa hàng. API và web cùng dùng để preview không nói dối. */
export const STOREFRONT_SCHEMA_VERSION = 1 as const;
export const STOREFRONT_REVISION_LIMIT = 20;
export const STOREFRONT_LOCALES = ['vi', 'en', 'zh'] as const;
export type StorefrontLocale = (typeof STOREFRONT_LOCALES)[number];

export type LocalizedText = Record<StorefrontLocale, string>;

export const STOREFRONT_PAGE_KINDS = [
  'home',
  'product',
  'login',
  'register',
  'checkout',
  'orders',
  'orderDetail',
  'account',
  'legal',
  'maintenance',
] as const;
export type StorefrontPageKind = (typeof STOREFRONT_PAGE_KINDS)[number];

export const STOREFRONT_BLOCK_TYPES = [
  'section',
  'container',
  'grid',
  'columns',
  'stack',
  'divider',
  'spacer',
  'heading',
  'richText',
  'image',
  'banner',
  'features',
  'faq',
  'contact',
  'announcement',
  'productBrowser',
  'productDetail',
  'loginForm',
  'registerForm',
  'checkoutPanel',
  'ordersList',
  'orderDetailPanel',
  'accountPanel',
  'legalContent',
  'maintenanceMessage',
] as const;
export type StorefrontBlockType = (typeof STOREFRONT_BLOCK_TYPES)[number];

export const STOREFRONT_BUSINESS_BLOCKS = [
  'productBrowser',
  'productDetail',
  'loginForm',
  'registerForm',
  'checkoutPanel',
  'ordersList',
  'orderDetailPanel',
  'accountPanel',
  'legalContent',
  'maintenanceMessage',
] as const satisfies readonly StorefrontBlockType[];

export type StorefrontFont = 'geist' | 'system-sans' | 'system-serif' | 'system-mono';
export type StorefrontDensity = 'compact' | 'comfortable' | 'spacious';
export type StorefrontButtonStyle = 'solid' | 'outline' | 'soft';

export interface StorefrontTheme {
  preset: 'minimal' | 'commerce' | 'compact';
  colors: {
    background: string;
    surface: string;
    foreground: string;
    muted: string;
    primary: string;
    primaryForeground: string;
    border: string;
    success: string;
    danger: string;
  };
  headingFont: StorefrontFont;
  bodyFont: StorefrontFont;
  radius: number;
  containerWidth: number;
  density: StorefrontDensity;
  buttonStyle: StorefrontButtonStyle;
}

export interface StorefrontBrand {
  name: string;
  shortName: string;
  tagline: LocalizedText;
  logoAssetId: string | null;
  faviconAssetId: string | null;
  defaultLocale: StorefrontLocale;
}

export interface StorefrontBlock {
  id: string;
  type: StorefrontBlockType;
  /** Thuộc tính được renderer của từng block đọc; không bao giờ là CSS/JS thô. */
  props: Record<string, unknown>;
  children?: StorefrontBlock[];
}

export interface StorefrontPage {
  kind: StorefrontPageKind;
  blocks: StorefrontBlock[];
}

export interface StorefrontDocument {
  schemaVersion: typeof STOREFRONT_SCHEMA_VERSION;
  brand: StorefrontBrand;
  theme: StorefrontTheme;
  pages: Record<StorefrontPageKind, StorefrontPage>;
}

export type SetupCheckState = 'pass' | 'warn' | 'fail' | 'stale';
export type SetupStepId = 'system' | 'design' | 'payments' | 'channels' | 'catalog' | 'review';

export interface SetupCheckDto {
  id: string;
  step: SetupStepId;
  state: SetupCheckState;
  title: string;
  detail: string;
  actionHref?: string;
  testedAt: string;
}

export interface SetupStepDto {
  id: SetupStepId;
  passed: number;
  total: number;
  state: SetupCheckState;
}

export interface SetupStatusDto {
  setupVersion: number;
  published: boolean;
  maintenanceMode: boolean;
  publishedAt: string | null;
  currentStep: SetupStepId;
  canPublish: boolean;
  checks: SetupCheckDto[];
  steps: SetupStepDto[];
}

export interface StorefrontDraftDto {
  document: StorefrontDocument;
  version: number;
  updatedAt: string;
}

export interface StorefrontRevisionDto {
  id: string;
  version: number;
  publishedAt: string;
  publishedBy: string;
}

export interface StoreMediaAssetDto {
  id: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: number;
  width: number;
  height: number;
  url: string;
  createdAt: string;
}

export interface PublicStorefrontDto {
  published: boolean;
  maintenanceMode: boolean;
  document: StorefrontDocument;
  revision: number;
}

const REQUIRED_BLOCK: Record<StorefrontPageKind, StorefrontBlockType> = {
  home: 'productBrowser',
  product: 'productDetail',
  login: 'loginForm',
  register: 'registerForm',
  checkout: 'checkoutPanel',
  orders: 'ordersList',
  orderDetail: 'orderDetailPanel',
  account: 'accountPanel',
  legal: 'legalContent',
  maintenance: 'maintenanceMessage',
};

const BLOCK_TYPES = new Set<string>(STOREFRONT_BLOCK_TYPES);
const PAGE_KINDS = new Set<string>(STOREFRONT_PAGE_KINDS);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const BLOCK_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const MEDIA_ID = /^[a-z0-9]{10,40}$/;
const BLOCK_PROPS: Record<StorefrontBlockType, readonly string[]> = {
  section: ['paddingY', 'background'], container: ['maxWidth'], grid: ['columns', 'gap'], columns: ['gap'], stack: ['gap', 'align'], divider: ['space'], spacer: ['height'],
  heading: ['text', 'level', 'align'], richText: ['html'], image: ['assetId', 'alt'], banner: ['eyebrow', 'title', 'body'], features: ['title', 'body'], faq: ['title', 'body'], contact: ['title', 'body'],
  announcement: [], productBrowser: [], productDetail: [], loginForm: [], registerForm: [], checkoutPanel: [], ordersList: [], orderDetailPanel: [], accountPanel: [], legalContent: [], maintenanceMessage: [],
};
const THEME_COLOR_KEYS = [
  'background',
  'surface',
  'foreground',
  'muted',
  'primary',
  'primaryForeground',
  'border',
  'success',
  'danger',
] as const satisfies readonly (keyof StorefrontTheme['colors'])[];

export interface StorefrontValidationResult {
  ok: boolean;
  errors: string[];
}

/** Parser chặt: dữ liệu JSON từ admin không được chảy thẳng vào renderer. */
export function parseStorefrontDocument(value: unknown): StorefrontDocument {
  const result = validateStorefrontDocument(value);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return value as StorefrontDocument;
}

export function validateStorefrontDocument(value: unknown): StorefrontValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ['document must be an object'] };
  if (value.schemaVersion !== STOREFRONT_SCHEMA_VERSION) errors.push('unsupported schemaVersion');
  validateBrand(value.brand, errors);
  validateTheme(value.theme, errors);

  if (!isRecord(value.pages)) {
    errors.push('pages must be an object');
  } else {
    for (const kind of STOREFRONT_PAGE_KINDS) {
      const page = value.pages[kind];
      if (!isRecord(page) || page.kind !== kind || !Array.isArray(page.blocks)) {
        errors.push(`page ${kind} is invalid`);
        continue;
      }
      const ids = new Set<string>();
      let count = 0;
      const businessCounts = new Map<string, number>();
      const walk = (blocks: unknown[], depth: number) => {
        if (depth > 5) {
          errors.push(`page ${kind} exceeds maximum nesting`);
          return;
        }
        for (const raw of blocks) {
          count += 1;
          if (count > 120) {
            errors.push(`page ${kind} has too many blocks`);
            return;
          }
          if (!isRecord(raw) || typeof raw.id !== 'string' || !BLOCK_ID.test(raw.id)) {
            errors.push(`page ${kind} contains an invalid block id`);
            continue;
          }
          if (ids.has(raw.id)) errors.push(`page ${kind} contains duplicate id ${raw.id}`);
          ids.add(raw.id);
          if (typeof raw.type !== 'string' || !BLOCK_TYPES.has(raw.type)) {
            errors.push(`page ${kind} contains unknown block type`);
            continue;
          }
          if (!isRecord(raw.props)) errors.push(`block ${raw.id} props must be an object`);
          else validateBlockProps(raw.id, raw.type as StorefrontBlockType, raw.props, errors);
          if ((STOREFRONT_BUSINESS_BLOCKS as readonly string[]).includes(raw.type)) {
            businessCounts.set(raw.type, (businessCounts.get(raw.type) ?? 0) + 1);
          }
          if (raw.children !== undefined) {
            if (!Array.isArray(raw.children)) errors.push(`block ${raw.id} children must be an array`);
            else if (!['section', 'container', 'grid', 'columns', 'stack'].includes(raw.type)) errors.push(`block ${raw.id} cannot contain children`);
            else walk(raw.children, depth + 1);
          }
        }
      };
      walk(page.blocks, 0);
      const required = REQUIRED_BLOCK[kind];
      if (businessCounts.get(required) !== 1) {
        errors.push(`page ${kind} must contain exactly one ${required}`);
      }
      for (const [type, amount] of businessCounts) {
        if (type !== required && amount > 0) errors.push(`page ${kind} cannot contain ${type}`);
      }
    }
    for (const key of Object.keys(value.pages)) {
      if (!PAGE_KINDS.has(key)) errors.push(`unknown page ${key}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateBrand(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('brand must be an object');
    return;
  }
  if (typeof value.name !== 'string' || value.name.trim().length < 2 || value.name.length > 80) {
    errors.push('brand.name is invalid');
  }
  if (typeof value.shortName !== 'string' || value.shortName.trim().length < 1 || value.shortName.length > 24) {
    errors.push('brand.shortName is invalid');
  }
  if (!isLocalizedText(value.tagline)) errors.push('brand.tagline is invalid');
  if (!STOREFRONT_LOCALES.includes(value.defaultLocale as StorefrontLocale)) {
    errors.push('brand.defaultLocale is invalid');
  }
  for (const field of ['logoAssetId', 'faviconAssetId'] as const) {
    if (value[field] !== null && typeof value[field] !== 'string') errors.push(`brand.${field} is invalid`);
  }
}

function validateTheme(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('theme must be an object');
    return;
  }
  if (!['minimal', 'commerce', 'compact'].includes(String(value.preset))) errors.push('theme.preset is invalid');
  if (!isRecord(value.colors)) errors.push('theme.colors is invalid');
  else {
    for (const key of THEME_COLOR_KEYS) {
      const color = value.colors[key];
      if (typeof color !== 'string' || !HEX_COLOR.test(color)) errors.push(`theme color ${key} is invalid`);
    }
    for (const key of Object.keys(value.colors)) {
      if (!(THEME_COLOR_KEYS as readonly string[]).includes(key)) errors.push(`unknown theme color ${key}`);
    }
  }
  if (!['geist', 'system-sans', 'system-serif', 'system-mono'].includes(String(value.headingFont))) errors.push('theme.headingFont is invalid');
  if (!['geist', 'system-sans', 'system-serif', 'system-mono'].includes(String(value.bodyFont))) errors.push('theme.bodyFont is invalid');
  if (typeof value.radius !== 'number' || value.radius < 0 || value.radius > 16) errors.push('theme.radius is invalid');
  if (typeof value.containerWidth !== 'number' || value.containerWidth < 960 || value.containerWidth > 1600) errors.push('theme.containerWidth is invalid');
  if (!['compact', 'comfortable', 'spacious'].includes(String(value.density))) errors.push('theme.density is invalid');
  if (!['solid', 'outline', 'soft'].includes(String(value.buttonStyle))) errors.push('theme.buttonStyle is invalid');
}

function validateBlockProps(id: string, type: StorefrontBlockType, props: Record<string, unknown>, errors: string[]): void {
  const allowed = BLOCK_PROPS[type];
  for (const key of Object.keys(props)) if (!allowed.includes(key)) errors.push(`block ${id} contains unknown prop ${key}`);
  const numberInRange = (key: string, min: number, max: number) => {
    if (props[key] !== undefined && (typeof props[key] !== 'number' || !Number.isFinite(props[key]) || props[key] < min || props[key] > max)) errors.push(`block ${id} prop ${key} is invalid`);
  };
  if (type === 'section') {
    numberInRange('paddingY', 0, 160);
    if (props.background !== undefined && (typeof props.background !== 'string' || !HEX_COLOR.test(props.background))) errors.push(`block ${id} prop background is invalid`);
  }
  if (type === 'container') numberInRange('maxWidth', 320, 1600);
  if (type === 'grid') { numberInRange('columns', 1, 4); numberInRange('gap', 0, 160); }
  if (type === 'columns' || type === 'stack') numberInRange('gap', 0, 160);
  if (type === 'stack' && props.align !== undefined && !['start', 'center', 'end'].includes(String(props.align))) errors.push(`block ${id} prop align is invalid`);
  if (type === 'divider') numberInRange('space', 0, 160);
  if (type === 'spacer') numberInRange('height', 0, 160);
  if (type === 'heading') {
    if (props.text !== undefined && !isLocalizedText(props.text)) errors.push(`block ${id} prop text is invalid`);
    numberInRange('level', 1, 4);
    if (props.align !== undefined && !['left', 'center', 'right'].includes(String(props.align))) errors.push(`block ${id} prop align is invalid`);
  }
  if (type === 'richText' && props.html !== undefined && !isLocalizedText(props.html, 50_000)) errors.push(`block ${id} prop html is invalid`);
  if (type === 'image') {
    if (props.assetId !== undefined && props.assetId !== null && (typeof props.assetId !== 'string' || !MEDIA_ID.test(props.assetId))) errors.push(`block ${id} prop assetId is invalid`);
    if (props.alt !== undefined && !isLocalizedText(props.alt)) errors.push(`block ${id} prop alt is invalid`);
  }
  if (['banner', 'features', 'faq', 'contact'].includes(type)) {
    for (const key of ['eyebrow', 'title', 'body']) if (props[key] !== undefined && !isLocalizedText(props[key])) errors.push(`block ${id} prop ${key} is invalid`);
  }
}

function isLocalizedText(value: unknown, maxLength = 500): value is LocalizedText {
  return isRecord(value) && Object.keys(value).every((key) => STOREFRONT_LOCALES.includes(key as StorefrontLocale)) && STOREFRONT_LOCALES.every((locale) => typeof value[locale] === 'string' && (value[locale] as string).length <= maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function block(id: string, type: StorefrontBlockType, props: Record<string, unknown> = {}): StorefrontBlock {
  return { id, type, props };
}

export function createDefaultStorefrontDocument(name = 'Digital Store'): StorefrontDocument {
  const pages = {} as Record<StorefrontPageKind, StorefrontPage>;
  const required = REQUIRED_BLOCK;
  for (const kind of STOREFRONT_PAGE_KINDS) {
    pages[kind] = { kind, blocks: [block(`${kind}-main`, required[kind])] };
  }
  pages.home.blocks = [
    block('home-announcement', 'announcement'),
    block('home-products', 'productBrowser'),
  ];
  return {
    schemaVersion: STOREFRONT_SCHEMA_VERSION,
    brand: {
      name,
      shortName: name,
      tagline: {
        vi: 'Sản phẩm số, giao hàng tự động.',
        en: 'Digital products, delivered automatically.',
        zh: '数字商品，自动发货。',
      },
      logoAssetId: null,
      faviconAssetId: null,
      defaultLocale: 'vi',
    },
    theme: {
      preset: 'minimal',
      colors: {
        background: '#ffffff',
        surface: '#ffffff',
        foreground: '#0a0a0a',
        muted: '#737373',
        primary: '#0a0a0a',
        primaryForeground: '#ffffff',
        border: '#e5e5e5',
        success: '#059669',
        danger: '#dc2626',
      },
      headingFont: 'geist',
      bodyFont: 'geist',
      radius: 8,
      containerWidth: 1152,
      density: 'comfortable',
      buttonStyle: 'solid',
    },
    pages,
  };
}
