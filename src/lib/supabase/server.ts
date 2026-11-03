import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
export function isConfigured() { return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY); }
export async function supabase() {
  if (!isConfigured()) throw new Error('Supabase 연결 설정이 필요합니다.');
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: { getAll: () => jar.getAll(), setAll: values => { try { values.forEach(({name,value,options})=>jar.set(name,value,options)); } catch { /* Server Components cannot write; proxy refreshes. */ } } },
  });
}
