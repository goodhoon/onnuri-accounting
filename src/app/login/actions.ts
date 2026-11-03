"use server";
import {redirect} from 'next/navigation';
import {supabase, isConfigured} from '@/lib/supabase/server';
export async function login(_: {error:string}, form:FormData) {
 if(!isConfigured()) return {error:'연결 설정이 필요합니다.'};
 const email=String(form.get('email')??'').trim(), password=String(form.get('password')??'');
 if(!email || !password || email.length>254 || password.length>1024) return {error:'이메일과 비밀번호를 확인해 주세요.'};
 const db=await supabase();
 const {error}=await db.auth.signInWithPassword({email,password});
 if(error) return {error:'로그인하지 못했습니다. 이메일과 비밀번호를 확인하거나 관리자에게 문의해 주세요.'};
 redirect('/dashboard');
}
export async function logout(){const db=await supabase(); await db.auth.signOut();redirect('/login');}
