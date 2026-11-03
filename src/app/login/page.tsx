import {redirect} from 'next/navigation';
import {isConfigured} from '@/lib/supabase/server';
import LoginForm from './form';
export default function Login(){if(!isConfigured())redirect('/');return <main className="auth"><div className="brand">O<span>온누리 재정</span></div><section className="panel"><div className="eyebrow">WELCOME BACK</div><h1>로그인</h1><p>교회 계정으로 안전하게 시작하세요.</p><LoginForm/></section></main>;}
