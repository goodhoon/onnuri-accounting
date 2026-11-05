import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const uid=(n:number)=>`40000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const admin=uid(1),owner=uid(2),leader=uid(3),head=uid(4),vision=uid(5),payer=uid(6),other=uid(7),auditor=uid(8);
async function scalar(db:PGlite,sql:string,args:unknown[]=[]):Promise<any>{return Object.values((await db.query<any>(sql,args)).rows[0])[0];}
async function as(db:PGlite,id:string){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
test('Day 5 private bank details, payments and budget accounting',async t=>{
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
 for(let n=1;n<=8;n++)await db.query('insert into auth.users(id,email) values($1,$2)',[uid(n),`person${n}@example.test`]);
 await db.exec(`update public.profiles set active=true;insert into public.role_assignments(user_id,role) values('${admin}','admin')`);await as(db,admin);
 const org=await scalar(db,"select id from public.org_units where name='새가족팀'"),church=await scalar(db,"select id from public.org_units where kind='church'"),account=await scalar(db,"select id from public.accounts where code='5201'");
 const year=await scalar(db,"select public.save_year(null,'FY2026','2026-01-01','2026-12-31',false)");
 const budget=await scalar(db,"select public.adjust_budget($1,$2,null,$3,'1000','테스트 배정',0)",[year,org,account]);
 for(const [user,role,scope] of [[owner,'applicant',org],[leader,'team_leader',org],[head,'department_head',church],[vision,'vision_member',church],[payer,'payment_officer',null],[auditor,'auditor',org]])await db.query('select public.assign_member_role($1,$2,$3)',[user,role,scope]);
 const revision=async(id:string)=>Number((await db.query<any>('select revision from public.expense_requests where id=$1',[id])).rows[0]?.revision??0);
 async function draft(n:number,amount='10'){const id=uid(n);await as(db,owner);await db.query("select public.save_expense($1,0,$2,'지출 테스트','지출 목적','지급대상','2026-11-04',$3)",[id,budget,amount]);return id;}
 async function attach(id:string){const r=(await db.query<any>("select * from public.prepare_expense_receipt($1,'receipt.pdf','application/pdf',100)",[id])).rows[0];await db.query("insert into storage.objects(bucket_id,name,metadata) values('expense-receipts',$1,$2)",[r.object_path,JSON.stringify({size:100,mimetype:'application/pdf'})]);await db.query('select public.finish_expense_receipt($1)',[r.id]);return r;}
 async function submit(id:string,same?:string){const c=(await db.query<any>('select * from public.expense_approver_choices($1)',[id])).rows;const stages=[...new Map(c.map(s=>[s.step_id,s])).values()];const people:Record<string,string>={team_leader:leader,department_head:head,vision_member:vision,payment_officer:payer};await db.query('select public.submit_expense($1,$2,$3,$4)',[id,await revision(id),c[0].version_id,JSON.stringify(stages.map(s=>({step_id:s.step_id,user_id:same??people[s.role]})))]);}
 async function pending(id:string){return (await db.query<any>("select * from public.expense_steps where expense_id=$1 and decision='pending'",[id])).rows[0];}
 async function decide(id:string,decision='approved',note='확인했습니다',step?:string,rev?:number){return db.query('select public.decide_expense($1,$2,$3,$4,$5)',[id,rev??await revision(id),step??(await pending(id))?.id,decision,note]);}
 async function held(){return String((await db.query<any>('select * from public.expense_budget_status($1)',[budget])).rows[0].reserved);}

 const legacy=await draft(101);await attach(legacy);await submit(legacy);
 await db.exec('reset role');for(const f of files.filter(f=>f>='202611050006' && f<'202611050008'))await db.exec(await readFile(new URL(f,dir),'utf8'));
 for(const u of [leader,head,vision]){await as(db,u);await decide(legacy);}
 await db.exec('reset role');await db.exec(await readFile(new URL('202611050008_payments_bank_details.sql',dir),'utf8'));
 const bank=async(id:string,account='01-1234-1234567-00')=>db.query('select public.save_expense_bank($1,$2,$3,$4,$5)',[id,await revision(id),'Test Recipient','Test Bank',account]);
 async function ready(n:number,amount='10'){const id=await draft(n,amount);await bank(id);await attach(id);await submit(id);for(const u of [leader,head,vision]){await as(db,u);await decide(id);}return id;}
 async function balance(){await as(db,admin);return (await db.query<any>('select * from public.expense_budget_status($1)',[budget])).rows[0];}
 async function record(ids:string[],batch=uid(900),date='2026-11-04',method='bank_transfer',ref=''){
  const items=[];for(const id of ids)items.push({id,revision:await revision(id)});
  return scalar(db,'select public.record_expense_payments($1,$2,$3,$4,$5,$6)',[batch,JSON.stringify(items),date,method,ref,'Test payment']);
 }
 await t.test('기존 승인 건 계좌 최초 보완은 신청자만, 두 번째 변경 잠금',async()=>{
  await as(db,payer);assert.equal(await scalar(db,'select public.expense_can_pay($1)',[legacy]),true);assert.equal((await db.query<any>('select * from public.payable_expenses()')).rows[0].account_number,null);
  await assert.rejects(async()=>record([legacy]),/bank details required/);
  await assert.rejects(async()=>bank(legacy),/forbidden/);
  await as(db,owner);await bank(legacy);assert.equal(await scalar(db,'select account_number from public.expense_bank_details where expense_id=$1',[legacy]),'01-1234-1234567-000');await assert.rejects(async()=>bank(legacy),/bank locked/);
 });
 await t.test('계좌는 신청자와 지정 지급담당만, 관리자·승인자·감사자 조회 차단',async()=>{
  for(const u of [admin,leader,head,vision,auditor,other]){await as(db,u);assert.equal(await scalar(db,'select count(*)::int from public.expense_bank_details'),0);}
  await as(db,admin);await db.query("select public.assign_member_role($1,'payment_officer',$2)",[other,org]);await as(db,other);assert.equal(await scalar(db,'select count(*)::int from public.expense_bank_details'),0);assert.equal(await scalar(db,'select count(*)::int from public.payable_expenses()'),0);
  await as(db,payer);assert.equal(await scalar(db,'select count(*)::int from public.expense_bank_details'),1);assert.equal((await db.query<any>('select * from public.payable_expenses()')).rows[0].account_number,'01-1234-1234567-000');
  await assert.rejects(async()=>db.exec("update public.expense_bank_details set holder='forged'"),/permission denied/);
 });
 await t.test('잘못된 계좌 입력·미입력 제출 차단과 신청서+계좌 원자 저장',async()=>{
  const id=await draft(102);await attach(id);await assert.rejects(async()=>submit(id),/bank details required/);
  for(const a of ['bad','01-1','01x1234123456700'])await assert.rejects(async()=>bank(id,a),/invalid bank account/);
  const fresh=uid(103);await assert.rejects(async()=>db.query("select public.save_expense_with_bank($1,0,$2,'제목','내용','대상','2026-11-04','10','이름','은행','bad')",[fresh,budget]),/invalid bank account/);
  assert.equal(await scalar(db,'select count(*)::int from public.expense_requests where id=$1',[fresh]),0);
  await db.query("select public.save_expense_with_bank($1,0,$2,'제목','내용','대상','2026-11-04','10','이름','은행','011234123456700')",[fresh,budget]);assert.equal(await scalar(db,'select count(*)::int from public.expense_bank_details where expense_id=$1',[fresh]),1);
 });
 let second:string,third:string;
 await t.test('제출 후 계좌 변경 잠금과 다른 지급담당·신청자·관리자의 지급 차단',async()=>{
  second=await ready(104,'20');third=await ready(105,'30');
  await as(db,owner);await assert.rejects(async()=>bank(second),/bank locked/);
  for(const u of [owner,admin,head,other]){await as(db,u);await assert.rejects(async()=>record([second]),/not payment officer/);}
 });
 await t.test('날짜·방법·중복 선택·수정 충돌 검증, 실패 시 기록 없음',async()=>{
  await as(db,payer);for(const date of ['2099-01-01','2026-11-03'])await assert.rejects(async()=>record([second],uid(901),date),/invalid payment date/);
  await assert.rejects(async()=>record([second],uid(901),'2026-11-04','invalid'),/invalid payment details/);
  await assert.rejects(async()=>record([second,second],uid(901)),/invalid payment selection/);
  await assert.rejects(async()=>db.query("select public.record_expense_payments($1,$2,'2026-11-04','bank_transfer','','')",[uid(901),JSON.stringify([{id:second,revision:0}])]),/version conflict/);
  assert.equal(await scalar(db,'select count(*)::int from public.expense_payments'),0);
 });
 await t.test('일괄 지급 한 건 실패 시 전부 롤백',async()=>{
  await as(db,payer);const draftId=uid(102);
  const items=[{id:second,revision:await revision(second)},{id:draftId,revision:await revision(draftId)}];
  await assert.rejects(async()=>db.query("select public.record_expense_payments($1,$2,'2026-11-04','bank_transfer','','')",[uid(902),JSON.stringify(items)]),/not payment officer/);
  assert.equal(await scalar(db,'select count(*)::int from public.expense_payments'),0);assert.equal(await scalar(db,'select count(*)::int from public.payment_batches'),0);
  assert.equal(await scalar(db,'select status from public.expense_requests where id=$1',[second]),'approved');
 });
 await t.test('건별 지급은 예약→사용액 전환, 가용액 유지, 기록·신청자 알림',async()=>{
  const before=await balance();assert.equal(String(before.reserved),'60.00');await as(db,payer);await record([legacy]);
  assert.equal(await scalar(db,'select status from public.expense_requests where id=$1',[legacy]),'paid');assert.equal((await pending(legacy)),undefined);
  assert.equal(await scalar(db,"select count(*)::int from public.notifications where expense_id=$1 and kind='payment_ready' and resolved_at is null",[legacy]),0);
  const after=await balance();assert.equal(String(after.used),'10.00');assert.equal(String(after.reserved),'50.00');assert.equal(String(after.unreserved),String(before.unreserved));
  await as(db,owner);assert.equal(await scalar(db,"select count(*)::int from public.notifications where expense_id=$1 and kind='paid'",[legacy]),1);assert.equal(await scalar(db,'select count(*)::int from public.expense_payments where expense_id=$1',[legacy]),1);
 });
 await t.test('여러 건 일괄 지급과 같은 요청 재시도는 한 번만 기록',async()=>{
  await as(db,payer);const items=JSON.stringify([{id:second,revision:await revision(second)},{id:third,revision:await revision(third)}]);
  const args=[uid(903),items,'2026-11-04','bank_transfer','BANK-TEST-123','테스트'];
  const call=()=>scalar(db,'select public.record_expense_payments($1,$2,$3,$4,$5,$6)',args);
  assert.equal(await call(),uid(903));assert.equal(await call(),uid(903));
  assert.equal(await scalar(db,'select count(*)::int from public.payable_expenses()'),0);assert.equal(await scalar(db,'select count(*)::int from public.expense_payments'),3);assert.equal(await scalar(db,'select count(*)::int from public.payment_batches'),2);
  args[4]='changed';await assert.rejects(call,/payment batch conflict/);
  await assert.rejects(async()=>record([second],uid(904)),/not payment officer/);
  const b=await balance();assert.equal(String(b.used),'60.00');assert.equal(String(b.reserved),'0');assert.equal(String(b.unreserved),'940.00');
 });
 await t.test('지급완료 사용액 아래 예산 감액 및 초과 재신청 차단',async()=>{
  await as(db,admin);await assert.rejects(async()=>db.query("select public.adjust_budget($1,$2,null,$3,'-950','감액',1)",[year,org,account]),/reserved budget/);
  const id=await draft(106,'950');await bank(id);await attach(id);await assert.rejects(async()=>submit(id),/insufficient allocation/);
 });
 await t.test('지급 담당자 역할 회수·비활성·마감 시 지급 차단',async()=>{
  const id=await ready(107);await as(db,admin);const assignment=await scalar(db,"select id from public.role_assignments where user_id=$1 and role='payment_officer'",[payer]);await db.query('select public.remove_member_role($1)',[assignment]);await as(db,payer);assert.equal(await scalar(db,'select public.expense_can_pay($1)',[id]),false);assert.equal(await scalar(db,'select count(*)::int from public.expense_bank_details'),0);
  await as(db,admin);await db.query("select public.assign_member_role($1,'payment_officer',null)",[payer]);await db.query('select public.set_member_active($1,false)',[payer]);await as(db,payer);assert.equal(await scalar(db,'select public.expense_can_pay($1)',[id]),false);
  await as(db,admin);await db.query('select public.set_member_active($1,true)',[payer]);await db.query("select public.save_year($1,'FY2026','2026-01-01','2026-12-31',true)",[year]);await as(db,payer);await assert.rejects(async()=>record([id],uid(905)),/not payment officer/);
 });
 await t.test('조회권한별 예산 합계 및 익명·직접 지급기록 쓰기 차단',async()=>{
  await as(db,admin);const b=(await db.query<any>('select * from public.budget_usage_summary($1)',[year])).rows[0];assert.equal(String(b.used),'60.00');assert.equal(String(b.reserved),'10.00');
  await as(db,payer);await assert.rejects(async()=>db.exec('delete from public.expense_payments'),/permission denied/);await db.exec('reset role;set role anon');await assert.rejects(async()=>db.exec('select * from public.expense_bank_details'),/permission denied/);
 });
 }finally{await db.close();}
});
