'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Download, Check } from 'lucide-react';
import type { DeliveryViewDto } from '@webcatt/shared';
import { useI18n } from '@/lib/i18n/client';
import { Button, Card, Spinner } from '@/components/ui';
import { apiBaseUrl } from '@/lib/api';

const copy={
  vi:{title:'Sản phẩm đã nhận',hint:'Lưu nội dung trước khi đóng trang. Link có hiệu lực 15 phút, không chia sẻ với người khác.',error:'Link không hợp lệ, đã hết hạn hoặc không còn quyền xem. Quay lại bot, mở đơn rồi bấm “Xem trên web” để lấy link mới.',copy:'Sao chép tất cả',item:'Sao chép món',copied:'Đã sao chép',download:'Tải .txt',failed:'Không sao chép được. Hãy tải file .txt hoặc chọn nội dung để sao chép.'},
  en:{title:'Delivered products',hint:'Save the content before closing this page. The link expires in 15 minutes; do not share it.',error:'This link is invalid, expired or no longer accessible. Return to the bot, open the order and tap “View on web” for a new link.',copy:'Copy all',item:'Copy item',copied:'Copied',download:'Download .txt',failed:'Could not copy. Download the .txt file or select the text to copy it.'},
  zh:{title:'已交付商品',hint:'关闭页面前请保存内容。链接15分钟后失效，请勿分享。',error:'链接无效、已过期或无权访问。请返回机器人打开订单，点击网页查看获取新链接。',copy:'复制全部',item:'复制商品',copied:'已复制',download:'下载 .txt',failed:'无法复制。请下载 .txt 文件或选中文字复制。'},
};

export function DeliveryPage(){
 const {locale}=useI18n();const t=copy[locale];
 const grant=useRef<string|null>(null);
 const [data,setData]=useState<DeliveryViewDto|null>(null);const [error,setError]=useState(false);const [copied,setCopied]=useState<string|null>(null);const [copyError,setCopyError]=useState(false);
 useEffect(()=>{
  if(grant.current===null){grant.current=window.location.hash.slice(1);window.history.replaceState(null,'',window.location.pathname);}
  const controller=new AbortController();
  if(!grant.current){setError(true);return;}
  fetch(apiBaseUrl().replace(/\/$/,'')+'/delivery/view',{method:'POST',headers:{Authorization:'Delivery '+grant.current},cache:'no-store',signal:controller.signal})
   .then(async response=>{if(!response.ok)throw new Error('unavailable');return response.json() as Promise<DeliveryViewDto>;})
   .then(result=>{if(!controller.signal.aborted)setData(result);})
   .catch(()=>{if(!controller.signal.aborted)setError(true);});
  return()=>controller.abort();
 },[]);
 const lines=data?.items.flatMap(item=>item.lines)??[];
 const clipboard=async(text:string,id:string)=>{
  try{await navigator.clipboard.writeText(text);setCopied(id);setCopyError(false);}catch{setCopyError(true);}
 };
 const download=()=>{
  if(!data)return;const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`${data.code}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 return <section className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8">
  <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
  <p className="text-sm text-neutral-600">{t.hint}</p>
  {error?<p role="alert" className="rounded-lg border border-red-200 p-4 text-sm text-red-700">{t.error}</p>:!data?<Spinner className="h-6 w-6"/>:<>
   <div className="flex flex-wrap items-center justify-between gap-3"><strong>{data.code}</strong><div className="flex flex-wrap gap-2">
    <Button variant="outline" onClick={()=>void clipboard(lines.join('\n'),'all')}><Copy className="h-4 w-4"/>{copied==='all'?t.copied:t.copy}</Button>
    <Button onClick={download}><Download className="h-4 w-4"/>{t.download}</Button>
   </div></div>
   {copyError&&<p role="alert" className="text-sm text-red-700">{t.failed}</p>}
   {data.items.map((item,index)=><Card key={index} className="min-w-0 space-y-3 p-4">
    <h2 className="font-semibold">{item.name}{item.variant?` · ${item.variant}`:''}</h2>
    {item.lines.map((line,i)=><div key={i} className="flex min-w-0 items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
     <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-sm">{line}</pre>
     <button type="button" aria-label={`${t.item} ${i+1}`} title={t.item} onClick={()=>void clipboard(line,`${index}:${i}`)} className="shrink-0 rounded p-2 text-neutral-700 hover:bg-neutral-200 focus-visible:ring-2">
      {copied===`${index}:${i}`?<Check className="h-4 w-4 text-emerald-700"/>:<Copy className="h-4 w-4"/>}
     </button>
    </div>)}
   </Card>)}
  </>}
 </section>;
}
