begin;
-- Account details are isolated from general request/approval data.
create table public.expense_bank_details (
 expense_id uuid primary key references public.expense_requests(id),
 holder text not null check(length(trim(holder)) between 1 and 100),
 bank_name text not null check(length(trim(bank_name)) between 1 and 100),
 account_number text not null check(account_number ~ '^[0-9]{2}-[0-9]{4}-[0-9]{7}-[0-9]{3}$'),
 updated_at timestamptz not null default now()
);
-- Only these pre-existing requests may receive missing bank details once after submission.
alter table public.expense_requests add column legacy_bank_missing boolean not null default false;
update public.expense_requests set legacy_bank_missing=true where status in ('submitted','approved');
alter table public.expense_requests drop constraint expense_requests_status_check;
alter table public.expense_requests add constraint expense_requests_status_check check(status in ('draft','submitted','approved','paid','rejected','withdrawn','cancelled'));
alter table public.expense_steps drop constraint expense_steps_decision_check;
alter table public.expense_steps add constraint expense_steps_decision_check check(decision in ('waiting','pending','approved','rejected','skipped','paid'));
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in ('approval_required','payment_ready','rejected','approved','withdrawn','paid'));
create function public.can_read_expense_bank(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_member() and exists(select 1 from public.expense_requests e join public.budget_lines b on b.id=e.budget_line_id
 where e.id=p_id and (e.requester_id=auth.uid() or (e.status in ('submitted','approved','paid') and exists(select 1 from public.expense_steps s
 where s.expense_id=e.id and s.kind='payment' and s.assignee_id=auth.uid() and public.expense_user_role(auth.uid(),s.role,b.org_unit_id)))))
$$;
alter table public.expense_bank_details enable row level security;
revoke all on public.expense_bank_details from anon,authenticated;
grant select on public.expense_bank_details to authenticated;
create policy bank_private on public.expense_bank_details for select to authenticated using(public.can_read_expense_bank(expense_id));
create function public.save_expense_bank(p_id uuid,p_revision integer,p_holder text,p_bank text,p_account text) returns void language plpgsql security definer set search_path='' as $$
declare e public.expense_requests;digits text;normalized text;
begin
 perform pg_advisory_xact_lock(79335005);
 select * into e from public.expense_requests where id=p_id for update;
 if not public.is_active_member() or e.id is null or e.requester_id<>auth.uid() then raise exception 'forbidden' using errcode='42501';end if;
 if e.revision is distinct from p_revision then raise exception 'version conflict';end if;
 if e.status<>'draft' and not(e.legacy_bank_missing and e.status in ('submitted','approved') and not exists(select 1 from public.expense_bank_details where expense_id=e.id)) then raise exception 'bank locked';end if;
 if p_holder is null or length(trim(p_holder)) not between 1 and 100 or p_bank is null or length(trim(p_bank)) not between 1 and 100 then raise exception 'bank details required';end if;
 if p_account is null or p_account !~ '^[0-9 -]+$' then raise exception 'invalid bank account';end if;
 digits=regexp_replace(p_account,'[ -]','','g');
 if length(digits) not in (15,16) then raise exception 'invalid bank account';end if;
 normalized=substr(digits,1,2)||'-'||substr(digits,3,4)||'-'||substr(digits,7,7)||'-'||lpad(substr(digits,14),3,'0');
 insert into public.expense_bank_details(expense_id,holder,bank_name,account_number) values(e.id,trim(p_holder),trim(p_bank),normalized)
 on conflict(expense_id) do update set holder=excluded.holder,bank_name=excluded.bank_name,account_number=excluded.account_number,updated_at=now();
 update public.expense_requests set legacy_bank_missing=false,revision=revision+1,updated_at=now() where id=e.id;
 insert into public.expense_history(expense_id,actor_id,action,note) values(e.id,auth.uid(),'bank_updated',case when e.status='draft' then '지급 계좌 정보 저장' else '기존 제출 건의 누락된 지급 계좌 최초 등록' end);
end;
$$;
create function public.save_expense_with_bank(p_id uuid,p_revision integer,p_budget uuid,p_title text,p_description text,p_payee text,p_date date,p_amount text,p_holder text,p_bank text,p_account text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_rev integer;
begin
 v_id=public.save_expense(p_id,p_revision,p_budget,p_title,p_description,p_payee,p_date,p_amount);
 select revision into v_rev from public.expense_requests where id=v_id;
 perform public.save_expense_bank(v_id,v_rev,p_holder,p_bank,p_account);return v_id;
end;
$$;
create function public.check_submission_bank() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='submitted' and old.status='draft' and not exists(select 1 from public.expense_bank_details where expense_id=new.id) then raise exception 'bank details required';end if;
 return new;
end;
$$;
create trigger bank_required_before_submission before update of status on public.expense_requests for each row execute function public.check_submission_bank();
create table public.payment_batches (
 id uuid primary key, batch_no bigint generated always as identity unique,
 actor_id uuid not null references public.profiles(id), paid_on date not null,
 method text not null check(method in ('bank_transfer','cash','other')),
 bank_reference text not null default '' check(length(bank_reference)<=100),
 note text not null default '' check(length(note)<=500),
 request_payload jsonb not null,created_at timestamptz not null default now()
);
create table public.expense_payments (
 expense_id uuid primary key references public.expense_requests(id),
 batch_id uuid not null references public.payment_batches(id),amount numeric(14,2) not null check(amount>0),
 paid_on date not null,method text not null,bank_reference text not null,recorded_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.payment_batches enable row level security;
alter table public.expense_payments enable row level security;
revoke all on public.payment_batches,public.expense_payments from anon,authenticated;
grant select on public.payment_batches,public.expense_payments to authenticated;
create policy batch_owner on public.payment_batches for select to authenticated using(actor_id=auth.uid() and public.is_active_member());
create policy payment_read on public.expense_payments for select to authenticated using(public.can_read_expense(expense_id));
create function public.expense_can_pay(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_member() and exists(select 1 from public.expense_requests e join public.budget_lines b on b.id=e.budget_line_id join public.fiscal_years y on y.id=b.fiscal_year_id
 join public.expense_steps s on s.expense_id=e.id where e.id=p_id and e.status='approved' and not y.closed
 and s.kind='payment' and s.decision='pending' and s.assignee_id=auth.uid() and e.requester_id<>auth.uid()
 and public.expense_user_role(auth.uid(),s.role,b.org_unit_id))
$$;
create function public.record_expense_payments(p_batch uuid,p_items jsonb,p_date date,p_method text,p_reference text,p_note text)
 returns uuid language plpgsql security definer set search_path='' as $$
declare e public.expense_requests;s public.expense_steps;item jsonb;existing public.payment_batches;
begin
 perform pg_advisory_xact_lock(79335005);
 if not public.is_active_member() then raise exception 'forbidden' using errcode='42501';end if;
 if p_batch is null or p_date is null or p_date>(now() at time zone 'Pacific/Auckland')::date then raise exception 'invalid payment date';end if;
 if p_method is null or p_method not in ('bank_transfer','cash','other') or length(coalesce(p_reference,''))>100 or length(coalesce(p_note,''))>500 then raise exception 'invalid payment details';end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid payment selection';end if;
 if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'invalid payment selection';end if;
 if (select count(distinct (x->>'id')::uuid) from jsonb_array_elements(p_items)x)<>jsonb_array_length(p_items) then raise exception 'invalid payment selection';end if;
 select * into existing from public.payment_batches where id=p_batch;
 if existing.id is not null then
 if existing.actor_id<>auth.uid() or existing.request_payload<>p_items or existing.paid_on<>p_date or existing.method<>p_method or existing.bank_reference<>trim(coalesce(p_reference,'')) or existing.note<>trim(coalesce(p_note,'')) then raise exception 'payment batch conflict';end if;
 return existing.id;
 end if;
 insert into public.payment_batches(id,actor_id,paid_on,method,bank_reference,note,request_payload) values(p_batch,auth.uid(),p_date,p_method,trim(coalesce(p_reference,'')),trim(coalesce(p_note,'')),p_items);
 for item in select x from jsonb_array_elements(p_items)x order by x->>'id' loop
 select * into e from public.expense_requests where id=(item->>'id')::uuid for update;
 if e.id is null or not public.expense_can_pay(e.id) then raise exception 'not payment officer or not payable' using errcode='42501';end if;
 if e.revision is distinct from (item->>'revision')::integer then raise exception 'version conflict';end if;
 if p_date<e.spent_on then raise exception 'invalid payment date';end if;
 if not exists(select 1 from public.expense_bank_details where expense_id=e.id) then raise exception 'bank details required';end if;
 select * into s from public.expense_steps where expense_id=e.id and kind='payment' and decision='pending';
 insert into public.expense_payments(expense_id,batch_id,amount,paid_on,method,bank_reference,recorded_by) values(e.id,p_batch,e.amount,p_date,p_method,trim(coalesce(p_reference,'')),auth.uid());
 update public.expense_steps set decision='paid',decided_by=auth.uid(),decided_at=now(),decision_note='지급 완료 기록' where id=s.id;
 update public.expense_requests set status='paid',revision=revision+1,updated_at=now() where id=e.id;
 update public.notifications set read_at=coalesce(read_at,now()),resolved_at=coalesce(resolved_at,now()) where expense_id=e.id and kind='payment_ready';
 insert into public.expense_history(expense_id,actor_id,action,note) values(e.id,auth.uid(),'paid','지급일 '||p_date::text||' / 지급 방법 '||p_method||' / 지급 묶음 '||p_batch::text);
 perform public.expense_notify(e.requester_id,e.id,s.id,'paid','지급 완료로 기록되었습니다','지급 담당자가 '||p_date::text||' 지급을 기록했습니다.',e.id::text||':paid');
 end loop;
 return p_batch;
end;
$$;

create or replace function public.can_read_expense(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_member() and exists(select 1 from public.expense_requests e join public.budget_lines b on b.id=e.budget_line_id
 where e.id=p_id and (e.requester_id=auth.uid() or public.is_admin() or
 (e.status in ('submitted','approved','paid','rejected','withdrawn') and (public.expense_user_role(auth.uid(),'auditor',b.org_unit_id) or exists(
 select 1 from public.expense_steps s where s.expense_id=e.id and s.assignee_id=auth.uid()
 and public.expense_user_role(auth.uid(),s.role,b.org_unit_id))))))
$$;


create or replace function public.submit_expense(p_id uuid,p_revision integer,p_workflow uuid,p_assignees jsonb)
 returns uuid language plpgsql security definer set search_path='' as $$
declare e public.expense_requests;b public.budget_lines;w uuid;s public.workflow_steps;v_user uuid;v_name text;held numeric;v_count integer;
begin
 perform pg_advisory_xact_lock(79335005);
 select * into e from public.expense_requests where id=p_id for update;
 if not public.is_active_member() or e.id is null or e.requester_id<>auth.uid() or not public.can_create_expense(e.budget_line_id) then raise exception 'forbidden' using errcode='42501';end if;
 if e.status<>'draft' then raise exception 'draft required';end if;
 if e.revision is distinct from p_revision then raise exception 'version conflict';end if;
 perform public.expense_check_budget(e.budget_line_id,e.spent_on);
 if exists(select 1 from public.expense_receipts where expense_id=e.id and state in ('pending','removing')) then raise exception 'receipt unfinished';end if;
 if not exists(select 1 from public.expense_receipts r join storage.objects o on o.bucket_id='expense-receipts' and o.name=r.object_path where r.expense_id=e.id and r.state='ready') then raise exception 'receipt required';end if;
 select id into w from public.workflow_versions order by version desc limit 1;
 if w is null or w is distinct from p_workflow then raise exception 'workflow changed';end if;
 select count(*) into v_count from public.workflow_steps where workflow_id=w;
 if jsonb_typeof(p_assignees) is distinct from 'array' then raise exception 'invalid assignees';end if;
 if jsonb_array_length(p_assignees)<>v_count then raise exception 'invalid assignees';end if;
 select * into b from public.budget_lines where id=e.budget_line_id;
 select coalesce(sum(amount),0) into held from public.expense_requests where budget_line_id=b.id and status in ('submitted','approved','paid');
 if b.amount-held<e.amount then raise exception 'insufficient allocation';end if;
 for s in select * from public.workflow_steps where workflow_id=w order by position loop
 if (select count(*) from jsonb_array_elements(p_assignees) a where a->>'step_id'=s.id::text)<>1 then raise exception 'invalid assignees';end if;
 select (a->>'user_id')::uuid into v_user from jsonb_array_elements(p_assignees) a where a->>'step_id'=s.id::text;
 if v_user is null or v_user=e.requester_id or not public.expense_user_role(v_user,s.role,b.org_unit_id) then raise exception 'invalid assignee';end if;
 select display_name into v_name from public.profiles where id=v_user;
 insert into public.expense_steps(expense_id,position,label,role,kind,source_step_id,assignee_id,assignee_name)
 values(e.id,s.position,s.label,s.role,s.kind,s.id,v_user,v_name);
 end loop;
 update public.expense_requests set status='submitted',workflow_version_id=w,submitted_at=now(),revision=revision+1,updated_at=now() where id=e.id;
 insert into public.expense_history(expense_id,actor_id,action,note) values(e.id,auth.uid(),'submitted','결재선·담당자 고정 / 신청액 예산 예약');return e.id;
end;
$$;


create or replace function public.protect_reserved_budget() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(79335005);
 if new.amount<(select coalesce(sum(amount),0) from public.expense_requests where budget_line_id=new.id and status in ('submitted','approved','paid')) then raise exception 'reserved budget';end if;
 return new;
end;
$$;


-- Replace the old three-column return type once, retaining RPC name for callers.
drop function public.expense_budget_status(uuid);
create function public.expense_budget_status(p_budget uuid) returns table(allocated numeric,reserved numeric,unreserved numeric,used numeric)
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.budget_lines b where b.id=p_budget and public.can_view_budget(b.org_unit_id)) then raise exception 'forbidden' using errcode='42501';end if;
 return query select b.amount,coalesce(sum(e.amount) filter(where e.status in ('submitted','approved')),0),
 b.amount-coalesce(sum(e.amount),0),coalesce(sum(e.amount) filter(where e.status='paid'),0)
 from public.budget_lines b left join public.expense_requests e on e.budget_line_id=b.id and e.status in ('submitted','approved','paid') where b.id=p_budget group by b.id;
end;
$$;
create function public.budget_usage_summary(p_year uuid) returns table(id uuid,allocated numeric,reserved numeric,used numeric,available numeric)
language sql stable security definer set search_path='' as $$
 select b.id,b.amount,coalesce(sum(e.amount) filter(where e.status in ('submitted','approved')),0),coalesce(sum(e.amount) filter(where e.status='paid'),0),b.amount-coalesce(sum(e.amount),0)
 from public.budget_lines b left join public.expense_requests e on e.budget_line_id=b.id and e.status in ('submitted','approved','paid')
 where b.fiscal_year_id=p_year and public.is_active_member() and public.can_view_budget(b.org_unit_id) group by b.id
$$;
revoke all on function public.can_read_expense_bank(uuid),public.save_expense_bank(uuid,integer,text,text,text),public.save_expense_with_bank(uuid,integer,uuid,text,text,text,date,text,text,text,text),public.check_submission_bank(),public.expense_can_pay(uuid),public.record_expense_payments(uuid,jsonb,date,text,text,text),public.expense_budget_status(uuid),public.budget_usage_summary(uuid) from public,anon,authenticated;
grant execute on function public.can_read_expense_bank(uuid),public.save_expense_bank(uuid,integer,text,text,text),public.save_expense_with_bank(uuid,integer,uuid,text,text,text,date,text,text,text,text),public.expense_can_pay(uuid),public.record_expense_payments(uuid,jsonb,date,text,text,text),public.expense_budget_status(uuid),public.budget_usage_summary(uuid) to authenticated;
create function public.payable_expenses() returns table(id uuid,request_no bigint,title text,payee_name text,spent_on date,amount numeric,revision integer,holder text,bank_name text,account_number text)
language sql stable security definer set search_path='' as $$
 select e.id,e.request_no,e.title,e.payee_name,e.spent_on,e.amount,e.revision,d.holder,d.bank_name,d.account_number
 from public.expense_requests e left join public.expense_bank_details d on d.expense_id=e.id
 where public.expense_can_pay(e.id) order by e.submitted_at,e.id limit 100
$$;
revoke all on function public.payable_expenses() from public,anon,authenticated;
grant execute on function public.payable_expenses() to authenticated;
commit;
