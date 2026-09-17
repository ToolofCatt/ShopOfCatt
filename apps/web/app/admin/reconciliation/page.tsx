'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/page-header';
import { IncomingTransferList, readTransferFilters, transferFilterQuery, type TransferFilters } from '@/components/admin/incoming-transfer-list';
import { Card, Input, buttonVariants } from '@/components/ui';
import { useI18n } from '@/lib/i18n/client';

export default function ReconciliationPage(){
  const {t}=useI18n();const copy=t.reconciliationUx;
  const router=useRouter(), pathname=usePathname(), search=useSearchParams();
  const filters=useMemo(()=>readTransferFilters(new URLSearchParams(search.toString())),[search]);
  const [orderCode,setOrderCode]=useState('');
  const safeCode=/^[A-Za-z0-9-]{1,80}$/.test(orderCode.trim())?orderCode.trim():'';
  const changeFilters=(next:TransferFilters)=>{
    const query=new URLSearchParams(search.toString());
    for(const key of ['q','source','status','amount','currency','conflicts','page','limit'])query.delete(key);
    for(const [key,value]of new URLSearchParams(transferFilterQuery(next)))query.set(key,value);
    router.replace(`${pathname}?${query}`,{scroll:false});
  };
  return <>
    <PageHeader title={copy.title} description={copy.subtitle}/>
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <Card className="min-w-0 p-4 sm:p-6"><IncomingTransferList filters={filters} onFiltersChange={changeFilters}/></Card>
      <aside className="min-w-0 space-y-4">
        <Card className="space-y-3 p-4"><label htmlFor="reconciliation-order" className="block text-sm font-medium">{copy.order}</label><Input id="reconciliation-order" value={orderCode} onChange={e=>setOrderCode(e.target.value)} maxLength={80} autoComplete="off" spellCheck={false}/><p className="text-xs text-neutral-600">{copy.orderHelp}</p>{safeCode?<Link href={`/admin/orders/${encodeURIComponent(safeCode)}`} className={buttonVariants({variant:'outline',className:'w-full'})}>{copy.openOrder}</Link>:<span aria-disabled="true" className="inline-flex h-10 w-full items-center justify-center rounded-md border border-neutral-200 text-sm text-neutral-400">{copy.openOrder}</span>}</Card>
        <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{copy.walletNotice}</p>
      </aside>
    </div>
  </>;
}
