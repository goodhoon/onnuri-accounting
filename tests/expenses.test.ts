import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validateReceipt, hasReceiptSignature, expenseNumber } from '../src/lib/expenses.ts';
const uid = (n: number) => `30000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const admin=uid(1),applicant=uid(2),leader=uid(3),head=uid(4),vision=uid(5),payer=uid(6),outsider=uid(7),auditor=uid(8);
async function scalar(db:PGlite,sql:string,args:unknown[]=[]):Promise<any>{return Object.values((await db.query<any>(sql,args)).rows[0])[0];}
async function as(db:PGlite,id:string){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');}
test('Receipt limits and signatures; readable request numbers',()=>{
 assert.equal(expenseNumber(12),'E000012');assert.equal(validateReceipt('영수증.pdf','application/pdf',5242880),'pdf');
 for(const [name,type,size] of [['a.svg','image/svg+xml',10],['../a.pdf','application/pdf',10],['a.pdf','application/pdf',0],['a.pdf','application/pdf',5242881]] as const)assert.throws(()=>validateReceipt(name,type,size));
 assert.equal(hasReceiptSignature(new TextEncoder().encode('%PDF-1.7'),'application/pdf'),true);
 assert.equal(hasReceiptSignature(new TextEncoder().encode('<html>'),'application/pdf'),false);
 assert.equal(hasReceiptSignature(new Uint8Array([137,80,78,71,13,10,26,10]),'image/png'),true);
 assert.equal(hasReceiptSignature(new Uint8Array([255,216,255]),'image/jpeg'),true);
});
test('Day 3 request, receipt and reservation enforcement',async t=>{
 const db=new PGlite();try{
 await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 for(let n=1;n<=8;n++)await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[uid(n),`u${n}@example.test`,JSON.stringify({display_name:`사용자${n}`})]);
 await db.exec(`update public.profiles set active=true;insert into public.role_assignments(user_id,role) values('${admin}','admin')`);
 await as(db,admin);
 const team=await scalar(db,"select id from public.org_units where name='미디어팀'"),other=await scalar(db,"select id from public.org_units where name='새가족팀'"),church=await scalar(db,"select id from public.org_units where kind='church'"),account=await scalar(db,"select id from public.accounts where code='5201'");
 const year=await scalar(db,"select public.save_year(null,'2026','2026-01-01','2026-12-31',false)");
 const budget=await scalar(db,"select public.adjust_budget($1,$2,null,$3,'100.00','초기',0)",[year,team,account]);
 const target=await scalar(db,"select public.adjust_budget($1,$2,null,$3,'0','이동 수신',0)",[year,other,account]);
 for(const [user,role,org] of [[applicant,'applicant',team],[leader,'team_leader',team],[head,'department_head',church],[vision,'vision_member',church],[payer,'payment_officer',null],[outsider,'applicant',other],[auditor,'auditor',team]])await db.query('select public.assign_member_role($1,$2,$3)',[user,role,org]);
 const e1=uid(101),e2=uid(102);let receipt:string,path:string;
 const rev=async(id=e1)=>Number(await scalar(db,'select revision from public.expense_requests where id=$1',[id]));
 async function save(id=e1,revision=0,amount='60.10',b=budget){return scalar(db,"select public.save_expense($1,$2,$3,'식비 신청','주일 행사 식비','테스트 지급 대상','2026-11-01',$4)",[id,revision,b,amount]);}
 async function choices(id=e1){return (await db.query<any>('select * from public.expense_approver_choices($1)',[id])).rows;}
 async function submit(id=e1,version?:string,selected?:unknown){const c=await choices(id);return scalar(db,'select public.submit_expense($1,$2,$3,$4)',[id,await rev(id),version??c[0].version_id,JSON.stringify(selected??c.map(c=>({step_id:c.step_id,user_id:c.user_id})))]);}
 async function upload(id=e1){const r=(await db.query<any>("select * from public.prepare_expense_receipt($1,'영수증.pdf','application/pdf',100)",[id])).rows[0];await db.query("insert into storage.objects(bucket_id,name,metadata) values('expense-receipts',$1,$2)",[r.object_path,JSON.stringify({size:100,mimetype:'application/pdf'})]);await db.query('select public.finish_expense_receipt($1)',[r.id]);return r;}
 await t.test('신청 권한·예산 범위 검사 및 관리자 작성',async()=>{
  await as(db,outsider);await assert.rejects(async()=>save(),/forbidden/);
  await as(db,leader);await assert.rejects(async()=>save(),/forbidden/);
  await as(db,admin);await save(uid(109),0,'1.00');await db.query("select public.end_expense($1,1,'cancelled','관리자 작성 확인')",[uid(109)]);
  await as(db,applicant);await save();assert.equal(await scalar(db,"select status from public.expense_requests where id=$1",[e1]),'draft');
 });
 await t.test('금액·회계기간 검증, 임시저장 수정 충돌·중복 생성 차단',async()=>{
  for(const a of ['0','-1','1.001','1e3'])await assert.rejects(async()=>save(uid(150),0,a),/invalid money/);
  await assert.rejects(async()=>db.query("select public.save_expense($1,0,$2,'제목','내역','대상','2027-01-01','1')",[uid(150),budget]),/expense date/);
  await assert.rejects(async()=>save(),/version conflict/);await save(e1,1);await assert.rejects(async()=>save(e1,1),/version conflict/);
 });
 await t.test('타인·결재자·조회 담당자에게 임시저장 격리; 직접 쓰기 차단',async()=>{
  for(const user of [outsider,leader,auditor]){await as(db,user);assert.equal(await scalar(db,'select count(*)::int from public.expense_requests where id=$1',[e1]),0);await assert.rejects(async()=>db.exec("update public.expense_requests set amount=1"),/permission denied/);}
  await as(db,admin);assert.equal(await scalar(db,'select count(*)::int from public.expense_requests where id=$1',[e1]),1);await assert.rejects(async()=>save(e1,2),/forbidden/);await as(db,applicant);
 });
 await t.test('영수증 없이 제출 차단; 저장만으로 예산 예약하지 않음',async()=>{await assert.rejects(async()=>submit(),/receipt required/);assert.equal(String((await db.query<any>('select * from public.expense_budget_status($1)',[budget])).rows[0].reserved),'0');});
 await t.test('첨부 경로 생성·크기/형식 제한·완료 전 제출 차단',async()=>{
  for(const [type,size] of [['image/svg+xml',100],['application/pdf',5242881],['application/pdf',0]])await assert.rejects(async()=>db.query("select * from public.prepare_expense_receipt($1,'a.pdf',$2,$3)",[e1,type,size]),/invalid receipt/);
  const r=(await db.query<any>("select * from public.prepare_expense_receipt($1,'영수증.pdf','application/pdf',100)",[e1])).rows[0];receipt=r.id;path=r.object_path;assert.ok(path.startsWith(`${applicant}/${e1}/`));
  await assert.rejects(async()=>db.query('select public.finish_expense_receipt($1)',[receipt]),/receipt missing/);await assert.rejects(async()=>submit(),/receipt unfinished/);
 });
 await t.test('Storage RLS: 타인 경로 업로드·조회·덮어쓰기·삭제 차단',async()=>{
  await as(db,outsider);await assert.rejects(async()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('expense-receipts',$1,'{}')",[path]),/row-level security/);
  await as(db,applicant);await db.query("insert into storage.objects(bucket_id,name,metadata) values('expense-receipts',$1,$2)",[path,JSON.stringify({size:100,mimetype:'application/pdf'})]);
  await db.query("update storage.objects set metadata='{}' where name=$1",[path]);assert.equal((await db.query<any>('select metadata from storage.objects where name=$1',[path])).rows[0].metadata.size,100);
  await as(db,outsider);assert.equal(await scalar(db,'select count(*)::int from storage.objects'),0);await db.query('delete from storage.objects where name=$1',[path]);
  await as(db,applicant);await db.query('select public.finish_expense_receipt($1)',[receipt]);
 });
 await t.test('담당자 후보는 실제 조직 역할만, 본인은 제외; 다른 조직·누락·중복 선택 거절',async()=>{
  const c=await choices();assert.equal(c.length,4);assert.ok(c.every(c=>c.user_id && c.user_id!==applicant));
  for(const user of [applicant,outsider,admin])await assert.rejects(async()=>submit(e1,undefined,c.map(c=>({step_id:c.step_id,user_id:user}))),/assignee/);
  await assert.rejects(async()=>submit(e1,undefined,[]),/assignee/);await assert.rejects(async()=>submit(e1,undefined,c.map(()=>({step_id:c[0].step_id,user_id:leader}))),/assignee/);
  assert.equal(await scalar(db,'select count(*)::int from public.expense_steps'),0);
 });
 await t.test('결재선 변경 시 이전 화면 제출 거절',async()=>{
  const c=await choices();await as(db,admin);const payload=(await db.query<any>('select label,role,kind from public.workflow_steps where workflow_id=$1 order by position',[c[0].version_id])).rows;payload[0].label='담당 팀장';await db.query('select public.save_workflow($1,1)',[JSON.stringify(payload)]);await as(db,applicant);await assert.rejects(async()=>submit(e1,c[0].version_id),/workflow changed/);
 });
 await t.test('제출 시 담당자·이름·결재선 고정, 금액 한 번만 예약',async()=>{
  await submit();assert.equal(await scalar(db,'select status from public.expense_requests where id=$1',[e1]),'submitted');assert.equal(await scalar(db,'select count(*)::int from public.expense_steps where expense_id=$1',[e1]),4);
  assert.equal(await scalar(db,"select label from public.expense_steps where expense_id=$1 and position=1",[e1]),'담당 팀장');
  assert.ok(await scalar(db,"select assignee_name from public.expense_steps where expense_id=$1 and position=1",[e1]));
  const balance=(await db.query<any>('select * from public.expense_budget_status($1)',[budget])).rows[0];assert.equal(String(balance.reserved),'60.10');assert.equal(String(balance.unreserved),'39.90');
  await assert.rejects(async()=>db.query('select public.submit_expense($1,$2,$3,$4)',[e1,await rev(),uid(999),'[]']),/draft required/);
 });
 await t.test('제출 후 수정·첨부·삭제 차단, 배정 담당자와 감사자만 열람',async()=>{
  await assert.rejects(async()=>save(e1,await rev()),/draft required/);await assert.rejects(async()=>db.query('select public.remove_expense_receipt($1,false)',[receipt]),/draft required/);
  await assert.rejects(async()=>db.query("select * from public.prepare_expense_receipt($1,'a.pdf','application/pdf',100)",[e1]),/draft required/);
  await db.query('delete from storage.objects where name=$1',[path]);assert.equal(await scalar(db,'select count(*)::int from storage.objects where name=$1',[path]),1);
  for(const user of [leader,head,vision,payer,auditor]){await as(db,user);assert.equal(await scalar(db,'select count(*)::int from public.expense_requests where id=$1',[e1]),1);assert.equal(await scalar(db,'select count(*)::int from storage.objects where name=$1',[path]),1);}
  await as(db,outsider);assert.equal(await scalar(db,'select count(*)::int from public.expense_requests where id=$1',[e1]),0);
  await as(db,applicant);
 });
 await t.test('초과 신청 제출 실패 시 담당자/상태/예약 롤백',async()=>{await save(e2,0,'40.00');await upload(e2);await assert.rejects(async()=>submit(e2),/insufficient allocation/);assert.equal(await scalar(db,'select status from public.expense_requests where id=$1',[e2]),'draft');assert.equal(await scalar(db,'select count(*)::int from public.expense_steps where expense_id=$1',[e2]),0);});
 await t.test('예약액 아래 예산 감액·이동 차단, 실패 시 양쪽 금액 보존',async()=>{
  await as(db,admin);await assert.rejects(async()=>db.query("select public.adjust_budget($1,$2,null,$3,'-40','감액',1)",[year,team,account]),/reserved budget/);
  await assert.rejects(async()=>db.query("select public.transfer_budget($1,$2,'40','이동',1,1)",[budget,target]),/reserved budget/);assert.equal(String(await scalar(db,'select amount from public.budget_lines where id=$1',[budget])),'100.00');await as(db,applicant);
 });
 await t.test('철회로 예약 해제, 기록 보존, 철회된 건 수정 불가',async()=>{
  await db.query("select public.end_expense($1,$2,'withdrawn','테스트 철회')",[e1,await rev()]);assert.equal(String((await db.query<any>('select * from public.expense_budget_status($1)',[budget])).rows[0].reserved),'0');assert.equal(await scalar(db,'select count(*)::int from public.expense_steps where expense_id=$1',[e1]),4);await assert.rejects(async()=>save(e1,await rev()),/draft required/);await submit(e2);
 });
 await t.test('실패한 첨부 삭제 재시도, Storage 객체 제거 후에만 삭제 완료',async()=>{
  await save(uid(103),0,'1');const r=await upload(uid(103));await db.query('select public.remove_expense_receipt($1,false)',[r.id]);await assert.rejects(async()=>db.query('select public.remove_expense_receipt($1,true)',[r.id]),/receipt unfinished/);await db.query('delete from storage.objects where name=$1',[r.object_path]);await db.query('select public.remove_expense_receipt($1,true)',[r.id]);assert.equal(await scalar(db,'select state from public.expense_receipts where id=$1',[r.id]),'deleted');await assert.rejects(async()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('expense-receipts',$1,'{}')",[r.object_path]),/row-level security/);
 });
 await t.test('첨부 완료 시 실제 Storage 메타데이터 대조',async()=>{
  await as(db,applicant);await save(uid(105),0,'1');const r=(await db.query<any>("select * from public.prepare_expense_receipt($1,'a.pdf','application/pdf',100)",[uid(105)])).rows[0];
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('expense-receipts',$1,$2)",[r.object_path,JSON.stringify({size:99,mimetype:'application/pdf'})]);
  await assert.rejects(async()=>db.query('select public.finish_expense_receipt($1)',[r.id]),/receipt missing/);
  await db.exec('reset role');await db.query("update storage.objects set metadata=$1 where name=$2",[JSON.stringify({size:100,mimetype:'text/html'}),r.object_path]);await as(db,applicant);
  await assert.rejects(async()=>db.query('select public.finish_expense_receipt($1)',[r.id]),/receipt missing/);
 });
 await t.test('첨부 한도·미완료 첨부 취소 방지',async()=>{
  await save(uid(106),0,'1');for(let i=0;i<10;i++)await db.query("select * from public.prepare_expense_receipt($1,'a.pdf','application/pdf',1)",[uid(106)]);
  await assert.rejects(async()=>db.query("select * from public.prepare_expense_receipt($1,'a.pdf','application/pdf',1)",[uid(106)]),/receipt limit/);
  await assert.rejects(async()=>db.query("select public.end_expense($1,$2,'cancelled','미완료 첨부')",[uid(106),await rev(uid(106))]),/receipt unfinished/);
 });
 await t.test('같은 역할이라도 배정되지 않은 사용자는 신청서·파일 열람 불가',async()=>{
  await db.exec('reset role');await db.query('insert into auth.users(id,email) values($1,$2)',[uid(9),'unassigned@example.test']);await as(db,admin);await db.query("select public.assign_member_role($1,'team_leader',$2)",[uid(9),team]);await as(db,uid(9));
  assert.equal(await scalar(db,'select count(*)::int from public.expense_requests'),0);assert.equal(await scalar(db,'select count(*)::int from storage.objects'),0);await as(db,applicant);
 });
 await t.test('익명 접근과 내부 권한 검사 RPC 실행 차단',async()=>{
  await db.exec('reset role;set role anon');await assert.rejects(async()=>db.exec('select * from public.expense_requests'),/permission denied/);await assert.rejects(async()=>db.exec('select * from storage.objects'),/permission denied/);
  await as(db,applicant);await assert.rejects(async()=>db.query("select public.expense_user_role($1,'team_leader',$2)",[leader,team]),/permission denied/);
 });
 await t.test('비활성 사용자와 역할 회수 시 담당자 접근 해제',async()=>{
  await as(db,admin);const assignment=await scalar(db,"select id from public.role_assignments where user_id=$1 and role='team_leader'",[leader]);await db.query('select public.remove_member_role($1)',[assignment]);await as(db,leader);assert.equal(await scalar(db,'select count(*)::int from public.expense_requests'),0);await as(db,admin);await db.query('select public.set_member_active($1,false)',[applicant]);await as(db,applicant);assert.equal(await scalar(db,'select count(*)::int from public.expense_requests'),0);assert.equal(await scalar(db,'select count(*)::int from storage.objects'),0);await as(db,admin);await db.query('select public.set_member_active($1,true)',[applicant]);
 });
 await t.test('마감 연도 저장·제출 차단',async()=>{
  await as(db,admin);await db.query("select public.save_year($1,'2026','2026-01-01','2026-12-31',true)",[year]);await as(db,applicant);await assert.rejects(async()=>save(uid(104)),/closed/);await assert.rejects(async()=>submit(uid(103)),/closed/);
 });
 }finally{await db.close();}
});
