import { redirect } from 'next/navigation';
import { isConfigured, supabase } from './supabase/server';
export async function requireMember() {
  if (!isConfigured()) redirect('/');
  const db = await supabase();
  const {data:{user},error} = await db.auth.getUser();
  if(error || !user) redirect('/login');
  const {data:profile} = await db.from('profiles').select('id, display_name, active').eq('id',user.id).single();
  if(!profile?.active) redirect('/pending');
  const {data:assignments,error:roleError} = await db.from('role_assignments').select('id, role, org_unit_id').eq('user_id',user.id);
  if(roleError) throw new Error('권한을 불러오지 못했습니다.');
  return {db,user,profile,assignments:assignments ?? [],isAdmin:assignments?.some(a=>a.role==='admin') ?? false};
}
