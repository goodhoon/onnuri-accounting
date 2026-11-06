import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const uid=(n:number)=>`40000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const admin=uid(1),owner=uid(2),leader=uid(3),head=uid(4),vision=uid(5),payer=uid(6),other=uid(7),auditor=uid(8);
async function scalar(db:PGlite,sql:string,args:unknown[]=[]):Promise<any>{return Object.values((await db.query<any>(sql,args)).rows[0])[0];}
async function as(db:PGlite,id:string){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
test('Day 6 amount policy and committee approvals',async t=>{
 const db=new PGlite();try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url),files=(await readdir(dir)).filter(f=>f.endsWith('.sql')).sort();
 for(const f of files.filter(f=>f<'202611050006'))await db.exec(await readFile(new URL(f,dir),'utf8'));
 for(let n=1;n<=10;n++)await db.query('insert into auth.users(id,email) values($1,$2)',[uid(n),`person${n}@example.test`]);
 await db.exec(`update public.profiles set active=true;insert into public.role_assignments(user_id,role) values('${admin}','admin')`);await as(db,admin);
 const org=await scalar(db,"select id from public.org_units where name='새가족팀'"),church=await scalar(db,"select id from public.org_units where kind='church'"),account=await scalar(db,"select id from public.accounts where code='5201'");
 const year=await scalar(db,"select public.save_year(null,'FY2026','2026-01-01','2026-12-31',false)");
 const budget=await scalar(db,"select public.adjust_budget($1,$2,null,$3,'5000','테스트 배정',0)",[year,org,account]);
 for(const [user,role,scope] of [[owner,'applicant',org],[leader,'team_leader',org],[head,'department_head',church],[vision,'vision_member',church],[payer,'payment_officer',null],[auditor,'auditor',org]])await db.query('select public.assign_member_role($1,$2,$3)',[user,role,scope]);
 const revision=async(id:string)=>Number((await db.query<any>('select revision from public.expense_requests where id=$1',[id])).rows[0]?.revision??0);
 async function draft(n:number,amount='10'){const id=uid(n);await as(db,owner);await db.query("select public.save_expense($1,0,$2,'지출 테스트','지출 목적','지급대상','2026-11-04',$3)",[id,budget,amount]);return id;}
 async function attach(id:string){const r=(await db.query<any>("select * from public.prepare_expense_receipt($1,'receipt.pdf','application/pdf',100)",[id])).rows[0];await db.query("insert into storage.objects(bucket_id,name,metadata) values('expense-receipts',$1,$2)",[r.object_path,JSON.stringify({size:100,mimetype:'application/pdf'})]);await db.query('select public.finish_expense_receipt($1)',[r.id]);return r;}
 async function submit(id:string,quorum=false){const c=(await db.query<any>('select * from public.expense_approver_choices($1)',[id])).rows;const stages=[...new Map(c.map(s=>[s.step_id,s])).values()];const people:Record<string,string>={team_leader:leader,department_head:head,vision_member:vision,payment_officer:payer};await db.query('select public.submit_expense($1,$2,$3,$4)',[id,await revision(id),c[0].version_id,JSON.stringify(stages.filter(s=>!quorum||s.role!=='vision_member').map(s=>({step_id:s.step_id,user_id:people[s.role]})))]);}
 async function pending(id:string){return (await db.query<any>("select * from public.expense_steps where expense_id=$1 and decision='pending'",[id])).rows[0];}
 async function decide(id:string,decision='approved',note='확인했습니다',step?:string,rev?:number){return db.query('select public.decide_expense($1,$2,$3,$4,$5)',[id,rev??await revision(id),step??(await pending(id))?.id,decision,note]);}

 const legacy=await draft(101);await attach(legacy);await submit(legacy);
 await db.exec('reset role');for(const f of files.filter(f=>f>='202611050006' && f<'202611050008'))await db.exec(await readFile(new URL(f,dir),'utf8'));

 await db.exec('reset role');await db.exec(await readFile(new URL('202611050008_payments_bank_details.sql',dir),'utf8'));
 const bank=async(id:string,account='01-1234-1234567-00')=>db.query('select public.save_expense_bank($1,$2,$3,$4,$5)',[id,await revision(id),'Test Recipient','Test Bank',account]);

 const v2=uid(9),v3=uid(10);
 await as(db,admin);
 for(const member of [v2,v3])await db.query("select public.assign_member_role($1,'vision_member',$2)",[member,church]);
 await db.exec('reset role');
 await db.exec(await readFile(new URL('202611060009_amount_approval_policy.sql',dir),'utf8'));
 const steps=async(id:string)=>(await db.query<any>('select * from public.expense_steps where expense_id=$1 order by position',[id])).rows;
 const status=(id:string)=>scalar(db,'select status from public.expense_requests where id=$1',[id]);
 async function enter(id:string){
   for(const actor of [leader,head]){await as(db,actor);await decide(id);}
 }
 await t.test('기존 제출 결재선 유지',async()=>{
   await as(db,owner);
   assert.deepEqual((await steps(legacy)).map(s=>s.role),['team_leader','department_head','vision_member','payment_officer']);
   for(const actor of [leader,head,vision]){await as(db,actor);await decide(legacy);}
   assert.equal(await status(legacy),'approved');
 });
 let large:string='';
 await t.test('금액 경계에 맞춰 제출 및 등록 위원 자동 배정',async()=>{
   const cases=[['100',0,0],['100.01',1,0],['300',1,0],['300.01',1,1],['500',1,1],['500.01',1,3]] as const;
   for(const [amount,heads,committee] of cases){
     const id=await draft(200+cases.findIndex(c=>c[0]===amount),amount);
     await bank(id);await attach(id);await submit(id,committee===3);
     const ss=await steps(id);
     assert.deepEqual(ss.map(s=>s.role),['team_leader',...Array(heads).fill('department_head'),...Array(committee).fill('vision_member'),'payment_officer']);
     assert.equal(ss.filter(s=>s.vision_quorum).length,committee===3?3:0);
     if(committee===3)large=id;
   }
 });
 await t.test('위원 동시 알림, 중복 승인 차단, 두 번째 승인 후 지급 대기',async()=>{
   await enter(large);
   for(const actor of [vision,v2,v3]){
     await as(db,actor);
     assert.equal(await scalar(db,"select count(*)::int from public.notifications where expense_id=$1 and kind='approval_required' and resolved_at is null",[large]),1);
   }
   await as(db,vision);
   const mine=(await steps(large)).find(s=>s.assignee_id===vision);
   await decide(large,'approved','확인',mine.id);
   assert.equal(await status(large),'submitted');
   await assert.rejects(()=>decide(large,'approved','다시',mine.id),/not current approver/);
   await as(db,v2);
   await decide(large,'approved','확인',(await steps(large)).find(s=>s.assignee_id===v2).id);
   assert.equal(await status(large),'approved');
   await as(db,v3);
   assert.equal((await steps(large)).find(s=>s.assignee_id===v3).decision,'skipped');
   assert.equal(await scalar(db,"select count(*)::int from public.notifications where expense_id=$1 and resolved_at is null",[large]),0);
   await as(db,payer);
   assert.equal(await scalar(db,'select public.expense_can_pay($1)',[large]),true);
   const result=(await db.query<any>('select * from public.payment_expense_labels($1)',[[large]])).rows;
   assert.match(result[0].organization,/새가족팀/);
   assert.match(result[0].account,/5201/);
   assert.equal(result[0].event,'일반 운영');
   assert.equal('account_number' in result[0],false);
   await as(db,other);
   assert.equal((await db.query('select * from public.payment_expense_labels($1)',[[large]])).rows.length,0);
 });
 await t.test('신청자 위원 제외, 새 위원은 기존 배정에 추가되지 않음',async()=>{
   await as(db,admin);
   await db.query("select public.assign_member_role($1,'vision_member',$2)",[owner,church]);
   const id=await draft(211,'501');await bank(id);await attach(id);await submit(id,true);
   assert.equal((await steps(id)).filter(s=>s.vision_quorum).length,3);
   assert.equal((await steps(id)).some(s=>s.assignee_id===owner),false);
   await as(db,admin);
   await db.query("select public.assign_member_role($1,'vision_member',$2)",[other,church]);
   const next=await draft(212,'501');await bank(next);await attach(next);await submit(next,true);
   assert.equal((await steps(next)).filter(s=>s.vision_quorum).length,4);
   assert.equal((await steps(id)).some(s=>s.assignee_id===other),false);
   await as(db,admin);
   const assignment=await scalar(db,"select id from public.role_assignments where user_id=$1 and role='vision_member'",[other]);
   await db.query('select public.remove_member_role($1)',[assignment]);
 });
 await t.test('위원 한 명의 반려가 나머지 대기와 알림을 닫음',async()=>{
   const id=await draft(210,'501');await bank(id);await attach(id);await submit(id,true);
   await enter(id);await as(db,v3);
   await decide(id,'rejected','보완 필요',(await steps(id)).find(s=>s.assignee_id===v3).id);
   assert.equal(await status(id),'rejected');
   assert.equal((await steps(id)).filter(s=>s.decision==='pending').length,0);
   await as(db,vision);
   assert.equal(await scalar(db,"select count(*)::int from public.notifications where expense_id=$1 and resolved_at is null",[id]),0);
 });
 }finally{await db.close();}
});
