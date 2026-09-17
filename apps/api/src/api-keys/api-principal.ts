import type { ApiScope } from '@webcatt/shared';
import type { Request } from 'express';

export interface ApiPrincipal {
  ownerId: string;
  keyId: string;
  scopes: ApiScope[];
}

export interface RequestWithApiPrincipal extends Request {
  apiPrincipal: ApiPrincipal;
}
