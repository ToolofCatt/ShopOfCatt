import { API_SCOPES } from './partner-api';

const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
const money={type:'string',pattern:'^\\d+(\\.\\d{1,6})?$',example:'5.000001'};
const errorResponse={description:'Stable machine error code; message follows Accept-Language.',content:{'application/json':{schema:ref('Error')}}};
const auth=[{PartnerApiKey:[]}];
const paging=[{name:'page',in:'query',schema:{type:'integer',minimum:1,default:1}},{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100,default:20}}];
const idempotency={name:'Idempotency-Key',in:'header',required:true,description:'8–128 ASCII letters, digits, dot, colon, underscore or dash. Reuse for retries; do not reuse with a different body.',schema:{type:'string',minLength:8,maxLength:128,pattern:'^[A-Za-z0-9._:-]+$'},example:'purchase-20260918-001'};
function endpoint(summary:string,scope:string,schema:object,write=false){return {summary,security:auth,'x-required-scope':scope,description:write?'Requires Idempotency-Key. New resource: 201. Replayed request: 200 with Idempotency-Replayed: true. Timeout: retry the same key and body.':'Owner-scoped data only. Money is returned as decimal strings.',responses:{[write?'201':'200']:{description:write?'Resource created':'Success',content:{'application/json':{schema}}},...(write?{'200':{description:'Idempotent replay; current resource state',headers:{'Idempotency-Replayed':{schema:{type:'string',enum:['true']}}},content:{'application/json':{schema}}}}:{}),'400':errorResponse,'401':errorResponse,'403':errorResponse,'404':errorResponse,'409':errorResponse,'422':errorResponse,'429':{...errorResponse,headers:{'Retry-After':{schema:{type:'integer'},description:'Seconds until the rate window resets'}}},'503':errorResponse}};}
const orderItem={type:'object',additionalProperties:false,required:['variantId','quantity'],properties:{variantId:{type:'string'},quantity:{type:'integer',minimum:1,maximum:100}}};
export const PARTNER_OPENAPI={
  openapi:'3.0.3',
  info:{title:'Catt Store Partner API',version:'1.0.0',description:'Approved accounts can create scoped API keys, top up their own wallet, buy digital goods and retrieve API orders. API keys never grant management access. No withdrawals, refunds or outbound partner webhooks.'},
  servers:[{url:'/api/v1'}],
  'x-rate-limits':{readPerKeyPerMinute:120,readPerOwnerPerMinute:240,writePerKeyPerMinute:30,writePerOwnerPerMinute:30},
  'x-scopes':API_SCOPES,
  paths:{
    '/products':{get:{...endpoint('List active products','catalog:read',{type:'array',items:ref('Product')}),parameters:[]}},
    '/products/{slug}':{get:{...endpoint('Get an active product','catalog:read',ref('Product')),parameters:[{name:'slug',in:'path',required:true,schema:{type:'string'}}]}},
    '/wallet':{get:endpoint('Read own wallet balance','wallet:read',ref('Wallet'))},
    '/deposit-methods':{get:endpoint('Read enabled wallet top-up methods','deposits:read',ref('DepositMethods'))},
    '/deposits':{
      get:{...endpoint('List API-created deposits','deposits:read',ref('DepositPage')),parameters:paging},
      post:{...endpoint('Create an idempotent wallet top-up','deposits:write',ref('Deposit'),true),parameters:[idempotency],requestBody:{required:true,content:{'application/json':{schema:ref('CreateDeposit'),example:{method:'sepay',vndAmount:130000}}}}},
    },
    '/deposits/{code}':{get:{...endpoint('Read own API deposit and frozen payment instructions','deposits:read',ref('Deposit')),parameters:[{name:'code',in:'path',required:true,schema:{type:'string'}}]}},
    '/orders':{
      get:{...endpoint('List API-created orders without delivered keys','orders:read',ref('OrderPage')),parameters:paging},
      post:{...endpoint('Purchase with wallet balance atomically','orders:write',ref('Order'),true),description:'At most 20 distinct variants and 100 items. Server recalculates prices and discounts. No external gateway session is created. No deliveredLines in this response, even on replay. Use GET order with orders:read to retrieve delivered goods. PAID can mean delivery is pending; never create another purchase to retry delivery.',parameters:[idempotency],requestBody:{required:true,content:{'application/json':{schema:ref('CreateOrder'),example:{items:[{variantId:'variant-example',quantity:1}],maxTotalUsdt:'5.000000'}}}}},
    },
    '/orders/{code}':{get:{...endpoint('Read own API order and delivered keys','orders:read',ref('OrderDetail')),parameters:[{name:'code',in:'path',required:true,schema:{type:'string'}}]}},
    '/openapi.json':{get:{summary:'Download the public API contract',security:[],responses:{'200':{description:'This OpenAPI document'}}}},
  },
  components:{
    securitySchemes:{PartnerApiKey:{type:'http',scheme:'bearer',bearerFormat:'catt_<key-id>.<random-secret>',description:'Created once in /account/api after approval. Send from your backend only; never put it in a browser bundle, query string or chat message.'}},
    schemas:{
      Error:{type:'object',required:['error','requestId'],properties:{error:{type:'object',required:['code','message'],properties:{code:{type:'string',example:'IDEMPOTENCY_CONFLICT'},message:{type:'string'}}},requestId:{type:'string'}}},
      Wallet:{type:'object',required:['balance','currency'],properties:{balance:money,currency:{type:'string',enum:['USDT']}}},
      Product:{type:'object',properties:{id:{type:'string'},slug:{type:'string'},name:{type:'string'},description:{type:'string',nullable:true},category:{type:'string',nullable:true},variants:{type:'array',items:{type:'object',properties:{id:{type:'string'},name:{type:'string'},price:money,currency:{type:'string',enum:['USDT']},availableStock:{type:'integer'}}}}}},
      CreateOrder:{type:'object',additionalProperties:false,required:['items'],properties:{items:{type:'array',minItems:1,maxItems:20,items:orderItem},couponCode:{type:'string',maxLength:32},maxTotalUsdt:money}},
      CreateDeposit:{type:'object',additionalProperties:false,required:['method','vndAmount'],properties:{method:{type:'string',enum:['sepay','crypto_bep20','crypto_trc20','binance_id']},vndAmount:{type:'integer',minimum:10000,maximum:100000000}}},
      DepositMethods:{type:'object',properties:{methods:{type:'array',items:{type:'string'}},minVnd:{type:'integer'},maxVnd:{type:'integer'},maxPending:{type:'integer',example:3}}},
      Deposit:{type:'object',properties:{code:{type:'string'},status:{type:'string',enum:['PENDING','SUCCESS','EXPIRED','CANCELLED']},method:{type:'string'},amountUsdt:money,vndAmount:money,createdAt:{type:'string',format:'date-time'},expiresAt:{type:'string',format:'date-time'},paidAt:{type:'string',format:'date-time',nullable:true},instructions:{type:'object',properties:{network:{type:'string',nullable:true},address:{type:'string',nullable:true},bank:{type:'string',nullable:true},accountHolder:{type:'string',nullable:true},memo:{type:'string',nullable:true}}}}},
      Order:{type:'object',properties:{code:{type:'string'},status:{type:'string',enum:['PENDING','PAID','DELIVERED','CANCELLED','EXPIRED']},totalAmount:money,currency:{type:'string',enum:['USDT']},createdAt:{type:'string',format:'date-time'},paidAt:{type:'string',format:'date-time',nullable:true},items:{type:'array',items:{type:'object',properties:{variantId:{type:'string',nullable:true},productName:{type:'string'},variantName:{type:'string'},unitPrice:money,quantity:{type:'integer'}}}}}},
      OrderDetail:{allOf:[ref('Order'),{type:'object',properties:{items:{type:'array',items:{type:'object',properties:{deliveredLines:{type:'array',items:{type:'string'},description:'SOLD lines for this owner only, when PAID or DELIVERED.'}}}}}}]},
      OrderPage:{type:'object',properties:{items:{type:'array',items:ref('Order')},total:{type:'integer'}}},
      DepositPage:{type:'object',properties:{items:{type:'array',items:ref('Deposit')},total:{type:'integer'}}},
    },
  },
} as const;
