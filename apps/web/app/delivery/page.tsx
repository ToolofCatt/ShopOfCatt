import type { Metadata } from 'next';
import { DeliveryPage } from '@/components/delivery-page';

export const metadata:Metadata={title:'Delivery',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function Page(){return <DeliveryPage />;}
