import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const uid=(n:number)=>`40000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const admin=uid(1),owner=uid(2),leader=uid(3),head=uid(4),vision=uid(5),payer=uid(6),other=uid(7),auditor=uid(8);
async function scalar(db:PGlite,sql:string,args:unknown[]=[]):Promise<any>{return Object.values((await db.query<any>(sql,args)).rows[0])[0];}
async function as(db:PGlite,id:string){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
test('Day 4 sequential approval, rejection, resubmission and notifications',async t=>{
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
 const revision=async(id:string)=>Number(await scalar(db,'select revision from public.expense_requests where id=$1',[id]));
 async function draft(n:number,amount='10'){const id=uid(n);await as(db,owner);await db.query("select public.save_expense($1,0,$2,'지출 테스트','지출 목적','지급대상','2026-11-04',$3)",[id,budget,amount]);return id;}
 async function attach(id:string){const r=(await db.query<any>("select * from public.prepare_expense_receipt($1,'receipt.pdf','application/pdf',100)",[id])).rows[0];await db.query("insert into storage.objects(bucket_id,name,metadata) values('expense-receipts',$1,$2)",[r.object_path,JSON.stringify({size:100,mimetype:'application/pdf'})]);await db.query('select public.finish_expense_receipt($1)',[r.id]);return r;}
 async function submit(id:string,same?:string){const c=(await db.query<any>('select * from public.expense_approver_choices($1)',[id])).rows;const stages=[...new Map(c.map(s=>[s.step_id,s])).values()];const people:Record<string,string>={team_leader:leader,department_head:head,vision_member:vision,payment_officer:payer};await db.query('select public.submit_expense($1,$2,$3,$4)',[id,await revision(id),c[0].version_id,JSON.stringify(stages.map(s=>({step_id:s.step_id,user_id:same??people[s.role]})))]);}
 async function pending(id:string){return (await db.query<any>("select * from public.expense_steps where expense_id=$1 and decision='pending'",[id])).rows[0];}
 async function decide(id:string,decision='approved',note='확인했습니다',step?:string,rev?:number){return db.query('select public.decide_expense($1,$2,$3,$4,$5)',[id,rev??await revision(id),step??(await pending(id))?.id,decision,note]);}
 async function held(){return String((await db.query<any>('select * from public.expense_budget_status($1)',[budget])).rows[0].reserved);}
 // A real Day 3 submission exists before applying the Day 4 migration.
 const legacy=await draft(101);await attach(legacy);await submit(legacy);
 await db.exec('reset role');for(const f of files.filter(f=>f>='202611050006'))await db.exec(await readFile(new URL(f,dir),'utf8'));
 await t.test('기존 제출 건을 보존하고 첫 단계만 시작·알림 생성',async()=>{
  await as(db,leader);assert.equal(await scalar(db,'select status from public.expense_requests where id=$1',[legacy]),'submitted');assert.equal((await pending(legacy)).role,'team_leader');assert.equal(await scalar(db,'select count(*)::int from public.notifications'),1);
  await as(db,head);assert.equal(await scalar(db,'select count(*)::int from public.notifications'),0);assert.equal(await scalar(db,'select public.expense_can_decide($1)',[legacy]),false);
 });
 await t.test('본인 수신 알림만 읽기 가능, 직접 생성·수정·관리자 열람 차단',async()=>{
  await as(db,leader);const n=await scalar(db,'select id from public.notifications');await as(db,owner);await assert.rejects(async()=>db.query('select public.read_notification($1)',[n]),/forbidden/);
  await as(db,admin);assert.equal(await scalar(db,'select count(*)::int from public.notifications'),0);await assert.rejects(async()=>db.exec("update public.notifications set read_at=now()"),/permission denied/);
  await as(db,leader);assert.equal(await scalar(db,'select public.read_notification($1)',[n]),legacy);assert.ok(await scalar(db,'select read_at from public.notifications where id=$1',[n]));
 });
 await t.test('현재 담당자만 승인 가능, 관리자·신청자·미래 단계 차단',async()=>{
  for(const u of [owner,head,vision,payer,admin]){await as(db,u);await assert.rejects(async()=>decide(legacy),/not current approver/);}
  await as(db,leader);assert.equal(await scalar(db,'select public.expense_can_decide($1)',[legacy]),true);
 });
 await t.test('순서대로 승인 후 다음 담당자에게만 알림, 중복 클릭 방지',async()=>{
  const s=await pending(legacy),r=await revision(legacy);await decide(legacy);await assert.rejects(async()=>decide(legacy,'approved','중복',s.id,r),/version conflict/);
  assert.equal(await scalar(db,"select count(*)::int from public.notifications where resolved_at is null"),0);
  await as(db,head);assert.equal((await pending(legacy)).role,'department_head');assert.equal(await scalar(db,'select count(*)::int from public.notifications'),1);
  await decide(legacy);await as(db,vision);assert.equal((await pending(legacy)).role,'vision_member');assert.equal(await scalar(db,'select count(*)::int from public.notifications'),1);await decide(legacy);
 });
 await t.test('최종 승인 시 지급 대기·신청자/지급담당 알림, 예약 유지',async()=>{
  await as(db,payer);assert.equal(await scalar(db,'select status from public.expense_requests where id=$1',[legacy]),'approved');assert.equal((await pending(legacy)).kind,'payment');assert.equal(await scalar(db,"select count(*)::int from public.notifications where kind='payment_ready'"),1);await assert.rejects(async()=>decide(legacy),/submitted required/);
  await as(db,owner);assert.equal(await scalar(db,"select count(*)::int from public.notifications where kind='approved'"),1);assert.equal(await held(),'10.00');
 });
 let rejected:string,oldReceipt:string;
 await t.test('새 제출에도 첫 단계 알림만 생성, 반려 사유 필수',async()=>{
  rejected=await draft(102,'20');oldReceipt=(await attach(rejected)).object_path;await submit(rejected);await as(db,leader);assert.equal(await scalar(db,"select count(*)::int from public.notifications where expense_id=$1 and resolved_at is null",[rejected]),1);
  const r=await revision(rejected);await assert.rejects(async()=>decide(rejected,'rejected',''),/rejection reason required/);assert.equal(await revision(rejected),r);
  await decide(rejected);await as(db,head);await decide(rejected,'rejected','영수증 내역을 보완해 주세요');
 });
 await t.test('반려 시 뒤 단계 중단·예산 해제·신청자 알림 및 원본 보존',async()=>{
  await as(db,owner);assert.equal(await scalar(db,'select status from public.expense_requests where id=$1',[rejected]),'rejected');assert.equal(await scalar(db,"select count(*)::int from public.expense_steps where expense_id=$1 and decision='skipped'",[rejected]),2);assert.equal(await held(),'10.00');assert.equal(await scalar(db,"select count(*)::int from public.notifications where expense_id=$1 and kind='rejected'",[rejected]),1);assert.equal(await scalar(db,'select count(*)::int from storage.objects where name=$1',[oldReceipt]),1);
  await assert.rejects(async()=>db.query("select public.save_expense($1,$2,$3,'덮어쓰기','목적','대상','2026-11-04','2')",[rejected,await revision(rejected),budget]),/draft required/);
 });
 let revised:string;
 await t.test('수정 재신청은 원본과 연결된 새 임시저장 한 건만 생성',async()=>{
  revised=await scalar(db,'select public.revise_expense($1,$2)',[rejected,await revision(rejected)]);assert.notEqual(revised,rejected);assert.equal(await scalar(db,'select resubmission_of from public.expense_requests where id=$1',[revised]),rejected);assert.equal(await scalar(db,'select public.revise_expense($1,$2)',[rejected,await revision(rejected)]),revised);assert.equal(await scalar(db,'select count(*)::int from public.expense_receipts where expense_id=$1',[revised]),0);
  await as(db,head);await assert.rejects(async()=>db.query('select public.revise_expense($1,$2)',[rejected,1]),/forbidden/);await as(db,owner);
 });
 await t.test('수정본은 다시 첨부·담당자 선택 후 처음부터 결재·별도 예약',async()=>{
  await assert.rejects(async()=>submit(revised),/receipt required/);await db.query("select public.save_expense($1,$2,$3,'보완한 신청','내역 보완','대상','2026-11-04','15.50')",[revised,await revision(revised),budget]);await attach(revised);await submit(revised);assert.equal(await held(),'25.50');assert.equal((await pending(revised)).role,'team_leader');assert.equal(await scalar(db,'select amount::text from public.expense_requests where id=$1',[rejected]),'20.00');
 });
 await t.test('승인 후 지급 대기 금액 아래 예산 감액 및 초과 신청 차단',async()=>{
  await as(db,admin);await assert.rejects(async()=>db.query("select public.adjust_budget($1,$2,null,$3,'-980','감액',1)",[year,org,account]),/reserved budget/);
  const large=await draft(103,'980');await attach(large);await assert.rejects(async()=>submit(large),/insufficient allocation/);assert.equal(await scalar(db,'select status from public.expense_requests where id=$1',[large]),'draft');
 });
 await t.test('승인 전 철회는 현재 알림 종료·담당자 철회 알림·예약 해제',async()=>{
  await db.query("select public.end_expense($1,$2,'withdrawn','테스트 철회')",[revised,await revision(revised)]);assert.equal(await held(),'10.00');await as(db,leader);assert.equal(await scalar(db,"select count(*)::int from public.notifications where expense_id=$1 and kind='approval_required' and resolved_at is null",[revised]),0);assert.equal(await scalar(db,"select count(*)::int from public.notifications where expense_id=$1 and kind='withdrawn'",[revised]),1);
 });
 await t.test('첫 승인 이후 신청자 임의 철회 차단',async()=>{
  const id=await draft(104);await attach(id);await submit(id);await as(db,leader);await decide(id);await as(db,owner);await assert.rejects(async()=>db.query("select public.end_expense($1,$2,'withdrawn','철회')",[id,await revision(id)]),/approval already started/);
 });
 await t.test('역할 회수된 다음 담당자에게 진행 차단; 승인/알림 부분 저장 없음',async()=>{
  const id=await draft(105);await attach(id);await submit(id);await as(db,admin);const role=await scalar(db,"select id from public.role_assignments where user_id=$1 and role='department_head'",[head]);await db.query('select public.remove_member_role($1)',[role]);await as(db,leader);const r=await revision(id);await assert.rejects(async()=>decide(id),/next assignee unavailable/);assert.equal(await revision(id),r);assert.equal((await pending(id)).role,'team_leader');await as(db,admin);await db.query("select public.assign_member_role($1,'department_head',$2)",[head,church]);
 });
 await t.test('계정 비활성화·역할 회수 시 알림과 승인 접근 차단',async()=>{
  await as(db,leader);const rev=await revision(uid(105)),step=(await pending(uid(105))).id;await as(db,admin);await db.query('select public.set_member_active($1,false)',[leader]);await as(db,leader);assert.equal(await scalar(db,'select count(*)::int from public.notifications'),0);await assert.rejects(async()=>decide(uid(105),'approved','확인',step,rev),/forbidden/);await as(db,admin);await db.query('select public.set_member_active($1,true)',[leader]);
 });
 await t.test('한 테스트 사용자의 복수 역할도 단계별로만 진행',async()=>{
  await as(db,admin);for(const role of ['department_head','vision_member','payment_officer'])await db.query('select public.assign_member_role($1,$2,$3)',[leader,role,org]);
  const id=await draft(106);await attach(id);await submit(id,leader);await as(db,leader);for(let i=0;i<3;i++){assert.equal((await pending(id)).position,i+1);await decide(id);}assert.equal(await scalar(db,'select status from public.expense_requests where id=$1',[id]),'approved');assert.equal((await pending(id)).kind,'payment');assert.equal(await scalar(db,"select count(*)::int from public.notifications where expense_id=$1 and resolved_at is null",[id]),1);
 });
 await t.test('알림 모두 읽음 처리와 익명/내부 함수 접근 차단',async()=>{
  await as(db,leader);await db.exec('select public.read_all_notifications()');assert.equal(await scalar(db,'select count(*)::int from public.notifications where read_at is null'),0);await assert.rejects(async()=>db.query("select public.expense_notify($1,$2,null,'approved','제목','내용','위조')",[owner,legacy]),/permission denied/);
  await db.exec('reset role;set role anon');await assert.rejects(async()=>db.exec('select * from public.notifications'),/permission denied/);
 });
 await t.test('회계연도 마감 후 승인 차단',async()=>{
  await as(db,admin);await db.query("select public.save_year($1,'FY2026','2026-01-01','2026-12-31',true)",[year]);await as(db,head);await assert.rejects(async()=>decide(uid(104)),/closed/);
 });
 }finally{await db.close();}
});
