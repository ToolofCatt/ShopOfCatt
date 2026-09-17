import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { ApiScope } from '@webcatt/shared';

export const API_SCOPES_METADATA = 'catt:api-scopes';

export function ApiScopes(...scopes: ApiScope[]): CustomDecorator<string> {
  return SetMetadata(API_SCOPES_METADATA, scopes);
}
