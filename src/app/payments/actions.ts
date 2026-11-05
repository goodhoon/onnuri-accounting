 'use server';
import {requireMember} from '@/lib/session';
import {expenseError} from '@/lib/expenses';
import {revalidatePath} from 'next/cache';
export type PaymentState={error:string;success:string};
export async function recordPayments(_:PaymentState,form:FormData):Promise<PaymentState>{
 const s=await requireMember();if(form.get('confirmed')!=='yes')return {error:'실제 지급을 완료했는지 확인해 주세요.',success:''};
 let items;try{items=JSON.parse(String(form.get('items')??'[]'));}catch{return {error:'선택한 신청서를 확인하세요.',success:''};}
 const {data,error}=await s.db.rpc('record_expense_payments',{p_batch:String(form.get('batch')??''),p_items:items,p_date:String(form.get('paid_on')??''),p_method:String(form.get('method')??''),p_reference:String(form.get('reference')??''),p_note:String(form.get('note')??'')});
 if(error)return {error:expenseError(error.message),success:''};
 revalidatePath('/','layout');return {error:'',success:`지급 기록을 저장했습니다. 앱 지급 묶음 ID: ${data}`};
}
