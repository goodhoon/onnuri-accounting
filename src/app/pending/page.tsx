import {redirect} from 'next/navigation';
import {supabase,isConfigured} from '@/lib/supabase/server';
import {logout} from '../login/actions';
export default async function Pending(){if(!isConfigured())redirect('/');const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect('/login');const {data}=await db.from('profiles').select('active').eq('id',user.id).single();if(data?.active)redirect('/dashboard');return <main className="auth"><section className="panel"><span className="badge">등록 확인 중</span><h1>관리자 승인이 필요합니다</h1><p>계정 활성화와 소속·역할 등록을 관리자에게 요청해 주세요.</p><form action={logout}><button>로그아웃</button></form></section></main>;}
