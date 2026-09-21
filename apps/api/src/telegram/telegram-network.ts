import { ProxyAgent } from 'undici';

let current: {url:string;agent:ProxyAgent} | undefined;
/** Proxy CONNECT chỉ cho Telegram; TLS vẫn xác minh api.telegram.org đầu cuối.
 * Không đổi dispatcher toàn cục vì sẽ ảnh hưởng Binance/SePay và API khác. */
export function telegramFetch(url:string,init:RequestInit):Promise<Response>{
  const proxy=process.env.TELEGRAM_PROXY_URL?.trim();
  if(!proxy)return fetch(url,init);
  if(new URL(url).hostname!=='api.telegram.org')throw new Error('Unexpected Telegram host');
  if(current?.url!==proxy){
    if(current)void current.agent.close();
    current={url:proxy,agent:new ProxyAgent(proxy)};
  }
  return fetch(url,{...init,dispatcher:current.agent} as RequestInit);
}
