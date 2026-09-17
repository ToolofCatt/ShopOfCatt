'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { Copy, RefreshCw } from 'lucide-react';
import type { Paginated, ReconciliationTransferDto } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { Button, Input, Spinner } from '@/components/ui';
import { Pagination } from './pagination';

const LIMIT=20;
const sourceValues=['CRYPTO:BEP20','CRYPTO:TRC20','BINANCE_ID','SEPAY','BINANCE_MERCHANT'];
export interface TransferFilters { q:string; source:string; status:string; amount:string; currency:string; conflicts:boolean; page:number; }
export const DEFAULT_TRANSFER_FILTERS: TransferFilters={q:'',source:'',status:'UNRESOLVED',amount:'',currency:'',conflicts:false,page:1};
export function transferFilterQuery(filters:TransferFilters):string {
  const query=new URLSearchParams({page:String(filters.page),limit:String(LIMIT),status:filters.status});
  for(const key of ['q','source','amount','currency'] as const) if(filters[key])query.set(key,filters[key]);
  if(filters.conflicts)query.set('conflicts','true');
  return query.toString();
}
export function readTransferFilters(query:URLSearchParams):TransferFilters {
  const status=query.get('status')??'UNRESOLVED';
  const source=query.get('source')??'';
  const rawPage=Number(query.get('page')??1);
  return {q:(query.get('q')??'').slice(0,200),source:sourceValues.includes(source)?source:'',status:['UNRESOLVED','OBSERVED','REVIEW','CLAIMED','ALL'].includes(status)?status:'UNRESOLVED',amount:query.get('amount')??'',currency:['USDT','VND'].includes(query.get('currency')??'')?query.get('currency')!:'',conflicts:query.get('conflicts')==='true',page:Number.isInteger(rawPage)&&rawPage>0&&rawPage<=100000?rawPage:1};
}

export function IncomingTransferList({value,onChange,onStateChange,disabled=false,reloadKey=0,filters:controlled,onFiltersChange}:{
  value?:string;onChange?:(id:string)=>void;onStateChange?:(rows:ReconciliationTransferDto[],loading:boolean,error:string|null)=>void;
  disabled?:boolean;reloadKey?:number;filters?:TransferFilters;onFiltersChange?:(filters:TransferFilters)=>void;
}) {
  const {token}=useAuth();const {t,formatDate}=useI18n();const copy=t.reconciliationUx;const id=useId();
  const [ownFilters,setOwnFilters]=useState(DEFAULT_TRANSFER_FILTERS);const filters=controlled??ownFilters;
  const [draft,setDraft]=useState(filters);const [result,setResult]=useState<Paginated<ReconciliationTransferDto>>({items:[],total:0});
  const [loading,setLoading]=useState(true);const [error,setError]=useState<string|null>(null);const [reload,setReload]=useState(0);const [clipboard,setClipboard]=useState('');
  const query=transferFilterQuery(filters);
  useEffect(()=>setDraft(filters),[filters]);
  useEffect(()=>{
    if(!token)return;
    let active=true;setLoading(true);setError(null);setResult({items:[],total:0});onChange?.('');onStateChange?.([],true,null);
    apiFetch<Paginated<ReconciliationTransferDto>>(`/admin/reconciliation/incoming-transfers?${query}`,{token})
      .then(data=>{if(active){setResult(data);onStateChange?.(data.items,false,null);}})
      .catch(reason=>{if(active){const message=apiErrorMessage(reason,t.common.connectionError);setError(message);onStateChange?.([],false,message);}})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
    // Callback identities không được biến một lần chọn radio thành một lần tải/xóa lựa chọn mới.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[query,token,reload,reloadKey,t.common.connectionError]);
  const setFilters=(next:TransferFilters)=>{setOwnFilters(next);onFiltersChange?.(next);onChange?.('');};
  const apply=()=>{if(draft.amount&&!/^\d{1,12}(?:\.\d{1,6})?$/.test(draft.amount)){setError(copy.filterAmountError);onChange?.('');onStateChange?.([],false,copy.filterAmountError);return;}setFilters({...draft,q:draft.q.trim(),page:1});setReload(n=>n+1);};
  const copyText=async(text:string)=>{try{await navigator.clipboard.writeText(text);setClipboard(copy.copied);}catch{setClipboard(copy.copyFailed);}};
  return <div className="min-w-0 space-y-4">
    <div role="group" className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={copy.apply} onKeyDown={event=>{if(event.key==='Enter'&&event.target instanceof HTMLInputElement&&event.target.type!=='radio'&&event.target.type!=='checkbox'){event.preventDefault();apply();}}}>
      <div className="sm:col-span-2"><label htmlFor={`${id}-q`} className="mb-1 block text-xs font-medium">{copy.search}</label><Input id={`${id}-q`} type="search" maxLength={200} value={draft.q} onChange={e=>setDraft({...draft,q:e.target.value})} disabled={disabled}/></div>
      <div><label htmlFor={`${id}-source`} className="mb-1 block text-xs font-medium">{copy.source}</label><select id={`${id}-source`} value={draft.source} onChange={e=>setDraft({...draft,source:e.target.value})} disabled={disabled} className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm"><option value="">{copy.all}</option>{sourceValues.map(source=><option key={source} value={source}>{copy.sources[source as keyof typeof copy.sources]}</option>)}</select></div>
      <div><label htmlFor={`${id}-status`} className="mb-1 block text-xs font-medium">{copy.status}</label><select id={`${id}-status`} value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})} disabled={disabled} className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm">{[['UNRESOLVED',copy.unresolved],['OBSERVED',copy.observed],['REVIEW',copy.review],['CLAIMED',copy.claimed],['ALL',copy.all]].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
      <div><label htmlFor={`${id}-amount`} className="mb-1 block text-xs font-medium">{copy.amount}</label><Input id={`${id}-amount`} inputMode="decimal" value={draft.amount} onChange={e=>setDraft({...draft,amount:e.target.value})} disabled={disabled}/></div>
      <div><label htmlFor={`${id}-currency`} className="mb-1 block text-xs font-medium">{copy.currency}</label><select id={`${id}-currency`} value={draft.currency} onChange={e=>setDraft({...draft,currency:e.target.value})} disabled={disabled} className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm"><option value="">{copy.all}</option><option>USDT</option><option>VND</option></select></div>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={draft.conflicts} disabled={disabled} onChange={e=>setDraft({...draft,conflicts:e.target.checked,status:e.target.checked?'ALL':draft.status})}/>{copy.conflictsOnly}</label>
      <div className="flex flex-wrap gap-2 sm:col-span-2"><Button onClick={apply} variant="outline" size="sm" disabled={disabled}>{copy.apply}</Button><Button variant="ghost" size="sm" disabled={disabled} onClick={()=>setFilters(DEFAULT_TRANSFER_FILTERS)}>{copy.reset}</Button><Button variant="ghost" size="sm" disabled={disabled||loading} onClick={()=>setReload(n=>n+1)}><RefreshCw className="h-4 w-4"/>{copy.retry}</Button></div>
    </div>
    <p role="status" className="text-xs text-neutral-600">{clipboard}</p>
    {loading?<p role="status" className="flex items-center gap-2 py-5 text-sm text-neutral-500"><Spinner/>{copy.loading}</p>:error?<p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>:result.items.length===0?<p role="status" className="rounded-md border border-dashed border-neutral-300 p-6 text-sm text-neutral-500">{filters.q||filters.source||filters.amount||filters.status!=='UNRESOLVED'?copy.noResults:copy.empty}</p>:<div role={onChange?'radiogroup':'list'} aria-label={copy.listLabel} className="space-y-3">
      {result.items.map(row=>{
        const canSelect=row.resolvable&&row.reviewReason!=='provider-facts-changed';
        return <article key={row.id} role={onChange?undefined:'listitem'} className="min-w-0 rounded-lg border border-neutral-200 bg-white p-3 sm:p-4">
          <div className="flex items-start gap-3">
            {onChange&&<input type="radio" aria-label={`${copy.choose}: ${row.reference}`} name={`${id}-selected`} value={row.id} checked={value===row.id} disabled={disabled||!canSelect} onChange={()=>onChange(row.id)} className="mt-1.5 h-4 w-4 shrink-0 accent-neutral-950"/>}
            <div className="min-w-0 flex-1"><p className="break-all text-base font-semibold tabular-nums">{row.amount} {row.currency}</p><p className="mt-1 break-words text-xs text-neutral-500">{copy.sources[row.source as keyof typeof copy.sources]??row.source} · {row.status==='CLAIMED'?copy.claimed:row.status==='REVIEW'?copy.review:copy.observed}</p></div>
          </div>
          <dl className="mt-3 grid min-w-0 gap-2 text-xs">
            <div><dt className="text-neutral-500">{copy.reference}</dt><dd className="break-all font-mono">{row.reference}</dd></div>
            <div><dt className="text-neutral-500">{copy.internalId}</dt><dd className="break-all font-mono">{row.id}</dd></div>
            <div><dt className="text-neutral-500">{copy.receiver}</dt><dd className="break-all">{row.receiver??copy.missingReceiver}</dd></div>
            <div><dt className="text-neutral-500">{copy.receivedAt}</dt><dd>{row.receivedAt?formatDate(row.receivedAt):t.common.dash}</dd></div>
            <div><dt className="text-neutral-500">{copy.observedAt}</dt><dd>{formatDate(row.createdAt)}</dd></div>
          </dl>
          {row.reviewReason&&<p className="mt-3 break-words text-xs text-neutral-600">{copy.reasons[row.reviewReason as keyof typeof copy.reasons]??copy.unknownReason}</p>}
          {row.reviewReason==='provider-facts-changed'?<p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900"><strong>{copy.investigate}</strong><br/>{copy.investigateHint}</p>:<p className="mt-2 text-xs text-neutral-500">{canSelect?copy.selectable:copy.readonly}</p>}
          <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={()=>void copyText(row.id)}><Copy className="h-3.5 w-3.5"/>{copy.copyId}</Button><Button variant="ghost" size="sm" onClick={()=>void copyText(row.reference)}>{copy.copyReference}</Button>{row.orderCode&&<Link href={`/admin/orders/${encodeURIComponent(row.orderCode)}`} className="break-all text-sm underline">{copy.relatedOrder}: {row.orderCode}</Link>}</div>
          {row.depositCode&&<p className="mt-2 break-all text-xs">{copy.relatedDeposit}: {row.depositCode}</p>}
        </article>;
      })}
    </div>}
    {!loading&&!error&&<Pagination page={filters.page} total={result.total} limit={LIMIT} onPageChange={page=>{if(!disabled)setFilters({...filters,page});}}/>}
  </div>;
}
