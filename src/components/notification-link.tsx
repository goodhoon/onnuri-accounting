import Link from 'next/link';
import {supabase} from '@/lib/supabase/server';
export default async function NotificationLink(){
 const db=await supabase();const {count,error}=await db.from('notifications').select('id',{count:'exact',head:true}).is('read_at',null).is('resolved_at',null);
 return <Link href="/notifications">알림함{error?'':` · ${count??0}`}</Link>;
}
