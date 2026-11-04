 'use server';
import {requireMember} from '@/lib/session';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
export async function openNotification(form:FormData){const s=await requireMember();const {data,error}=await s.db.rpc('read_notification',{p_id:String(form.get('id')??'')});if(error)throw new Error('알림을 열 수 없습니다. 접근 권한을 확인하세요.');revalidatePath('/','layout');redirect(`/expenses/${data}`);}
export async function readAll(){const s=await requireMember();const {error}=await s.db.rpc('read_all_notifications');if(error)throw new Error('읽음 처리 실패');revalidatePath('/','layout');}
