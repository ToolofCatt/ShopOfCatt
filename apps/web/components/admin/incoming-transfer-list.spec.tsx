import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { vi as dictionary } from '@/lib/i18n/dictionaries/vi';
vi.mock('@/lib/auth',()=>({useAuth:()=>({token:null})}));
vi.mock('@/lib/i18n/client',()=>({useI18n:()=>({t:dictionary,formatDate:(raw:string)=>raw})}));
import { IncomingTransferList, readTransferFilters, transferFilterQuery } from './incoming-transfer-list';

describe('reconciliation list filters',()=>{
  it('roundtrips an exact decimal filter and page beyond the old 100-row cap',()=>{
    const input={q:'tx-ref',source:'SEPAY',status:'REVIEW',currency:'VND',amount:'100000.000001',conflicts:true,page:7};
    const output=readTransferFilters(new URLSearchParams(transferFilterQuery(input)));
    expect(output).toEqual(input);
  });
  it('rejects invalid page/source/status before requesting API',()=>{
    expect(readTransferFilters(new URLSearchParams('page=-3&source=bad&status=bad'))).toMatchObject({page:1,source:'',status:'UNRESOLVED'});
  });
  it('does not create a nested form inside the order confirmation form',()=>{
    const html=renderToStaticMarkup(createElement(IncomingTransferList,{onChange:()=>{}}));
    expect(html).not.toContain('<form');
    expect(html).toContain('role="group"');
    expect(html).toContain('Đang tải khoản tiền');
    expect(html).not.toContain('type="submit"');
  });
});
