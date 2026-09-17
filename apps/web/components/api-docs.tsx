import Link from 'next/link';
import type { ReactNode } from 'react';
import { PARTNER_OPENAPI } from '@webcatt/shared';
import { partnerCodeSamples } from '@/lib/api-key';
import type { PartnerUx } from '@/lib/i18n/dictionaries/partner-ux';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-4 border-t border-neutral-200 pt-7"><h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">{title}</h2>{children}</section>;
}
function Code({ children }: { children: string }) {
  return <pre className="max-w-full whitespace-pre-wrap break-all rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-xs leading-6 text-neutral-800 sm:text-sm"><code>{children}</code></pre>;
}
function Json({ value }: { value: unknown }) { return <Code>{JSON.stringify(value, null, 2)}</Code>; }
interface Operation { summary?: string; description?: string; security?: unknown; 'x-required-scope'?: string; parameters?: unknown; requestBody?: unknown; responses?: unknown }

export function ApiDocs({ copy: p, baseUrl }: { copy: PartnerUx; baseUrl: string }) {
  const samples = partnerCodeSamples(baseUrl);
  const paths = PARTNER_OPENAPI.paths as Record<string, Record<string, Operation>>;
  const nav = [['start', p.docsPrerequisites], ['auth', p.docsAuth], ['quickstart', p.docsQuickstart], ['workflow', p.docsWorkflow], ['idempotency', p.docsIdempotency], ['limits', p.docsMoney], ['errors', p.docsErrors], ['reference', p.docsReference]];
  return <article className="mx-auto min-w-0 max-w-6xl px-4 py-8 sm:py-12">
    <header className="mb-8 max-w-3xl"><p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">API / v1</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{p.docsTitle}</h1><p className="mt-4 text-base leading-7 text-neutral-600">{p.docsIntro}</p><div className="mt-4 flex flex-wrap gap-x-6"><Link href="/account/api" className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{p.nav}</Link><a href={`${baseUrl}/openapi.json`} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{p.docsOpenApi}</a></div></header>
    <div className="grid min-w-0 gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="min-w-0"><nav aria-label={p.docsNav} className="flex flex-wrap gap-x-4 lg:sticky lg:top-24 lg:flex-col lg:gap-1">{nav.map(([id, title]) => <a key={id} href={`#${id}`} className="inline-flex min-h-11 items-center text-sm text-neutral-600 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-neutral-950">{title}</a>)}</nav></aside>
      <div className="min-w-0 space-y-8 text-sm leading-7 text-neutral-700">
        <Section id="start" title={p.docsPrerequisites}><p>{p.docsPrerequisitesBody}</p><h3 className="font-semibold text-neutral-950">{p.docsBase}</h3><Code>{baseUrl}</Code><p>{p.docsBaseHint}</p></Section>
        <Section id="auth" title={p.docsAuth}><p>{p.docsAuthBody}</p><Json value={PARTNER_OPENAPI.components.securitySchemes} /></Section>
        <Section id="quickstart" title={p.docsQuickstart}><p>{p.docsExamplesHint}</p>{Object.entries(samples).map(([language, sample]) => <div key={language} className="space-y-2"><h3 className="font-medium text-neutral-950">{language === 'node' ? 'Node.js / fetch' : language === 'python' ? 'Python / urllib' : 'cURL / shell'}</h3><Code>{sample}</Code></div>)}</Section>
        <Section id="workflow" title={p.docsWorkflow}><ol className="list-decimal space-y-4 pl-5"><li>{p.docsFunding}</li><li>{p.docsBuying}</li><li>{p.docsDelivery}</li></ol></Section>
        <Section id="idempotency" title={p.docsIdempotency}><p>{p.docsIdempotencyBody}</p><Code>{'Idempotency-Key: purchase-20260918-001\nContent-Type: application/json\n\n{"items":[{"variantId":"variant-example","quantity":1}],"maxTotalUsdt":"5.000000"}'}</Code></Section>
        <Section id="limits" title={p.docsMoney}><p>{p.docsMoneyBody}</p><Json value={PARTNER_OPENAPI['x-rate-limits']} /></Section>
        <Section id="errors" title={p.docsErrors}><p>{p.docsErrorsBody}</p><Json value={PARTNER_OPENAPI.components.schemas.Error} /></Section>
        <Section id="reference" title={p.docsReference}><p>{p.docsReferenceHint}</p><div className="space-y-3">{Object.entries(paths).flatMap(([path, methods]) => Object.entries(methods).filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method)).map(([method, operation]) => <details key={`${method}:${path}`} className="min-w-0 rounded-lg border border-neutral-200">
          <summary className="min-h-11 cursor-pointer break-all p-4 font-mono text-sm text-neutral-950 focus-visible:outline-2 focus-visible:outline-neutral-950"><span className="mr-3 font-bold">{method.toUpperCase()}</span>/api/v1{path}</summary>
          <div className="min-w-0 space-y-4 border-t border-neutral-200 p-4"><p className="font-semibold text-neutral-950">{operation.summary}</p>{operation.description && <p>{operation.description}</p>}<div className="space-y-2"><h3 className="font-medium text-neutral-950">{p.docsSecurity}</h3><Json value={{ security: operation.security, ...(operation['x-required-scope'] ? { scope: operation['x-required-scope'] } : {}) }} /></div>
            {operation.parameters !== undefined && <div className="space-y-2"><h3 className="font-medium text-neutral-950">{p.docsParameters}</h3><Json value={operation.parameters} /></div>}
            {operation.requestBody !== undefined && <div className="space-y-2"><h3 className="font-medium text-neutral-950">{p.docsBody}</h3><Json value={operation.requestBody} /></div>}
            <div className="space-y-2"><h3 className="font-medium text-neutral-950">{p.docsResponses}</h3><Json value={operation.responses} /></div>
          </div></details>))}</div></Section>
        <Section id="schemas" title={p.docsSchemas}>{Object.entries(PARTNER_OPENAPI.components.schemas).map(([name, schema]) => <details key={name} className="min-w-0 rounded-lg border border-neutral-200"><summary className="min-h-11 cursor-pointer break-all p-4 font-mono font-medium text-neutral-950 focus-visible:outline-2 focus-visible:outline-neutral-950">{name}</summary><div className="min-w-0 border-t border-neutral-200 p-4"><Json value={schema} /></div></details>)}</Section>
      </div>
    </div>
  </article>;
}
