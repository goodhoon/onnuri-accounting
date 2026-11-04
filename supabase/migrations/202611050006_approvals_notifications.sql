begin;
-- Day 4: sequential approvals and durable, recipient-private in-app notifications.
alter table public.expense_requests drop constraint expense_requests_status_check;
alter table public.expense_requests add constraint expense_requests_status_check check(status in ('draft','submitted','approved','rejected','withdrawn','cancelled'));
alter table public.expense_requests add column resubmission_of uuid unique references public.expense_requests(id);
alter table public.expense_steps add column decision text not null default 'waiting' check(decision in ('waiting','pending','approved','rejected','skipped'));
alter table public.expense_steps add column decided_at timestamptz;
alter table public.expense_steps add column decided_by uuid references public.profiles(id);
alter table public.expense_steps add column decision_note text not null default '';
create unique index expense_one_pending_step on public.expense_steps(expense_id) where decision='pending';
create table public.notifications (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(id),
 expense_id uuid not null references public.expense_requests(id),step_id uuid references public.expense_steps(id),
 kind text not null check(kind in ('approval_required','payment_ready','rejected','approved','withdrawn')),
 title text not null, message text not null,event_key text not null unique,
 created_at timestamptz not null default now(),read_at timestamptz,resolved_at timestamptz
);
create index on public.notifications(recipient_id,created_at desc);
create index on public.notifications(recipient_id) where read_at is null and resolved_at is null;
create function public.expense_notify(p_user uuid,p_expense uuid,p_step uuid,p_kind text,p_title text,p_message text,p_key text)
 returns void language sql security definer set search_path='' as $$
 insert into public.notifications(recipient_id,expense_id,step_id,kind,title,message,event_key)
 values(p_user,p_expense,p_step,p_kind,p_title,p_message,p_key) on conflict(event_key) do nothing
$$;
create function public.expense_stage_started() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.expense_steps;
begin
 if new.status='submitted' and old.status='draft' then
 select * into s from public.expense_steps where expense_id=new.id and kind='approval' order by position limit 1;
 if s.id is null then raise exception 'invalid approval workflow';end if;
 update public.expense_steps set decision='pending' where id=s.id;
 perform public.expense_notify(s.assignee_id,new.id,s.id,'approval_required','결재 요청이 도착했습니다',s.label||' 단계의 승인이 필요합니다.',s.id::text||':approval_required');
 elsif new.status='withdrawn' and old.status='submitted' then
 select * into s from public.expense_steps where expense_id=new.id and decision='pending';
 update public.notifications set resolved_at=coalesce(resolved_at,now()) where expense_id=new.id and kind in ('approval_required','payment_ready');
 update public.expense_steps set decision='skipped' where expense_id=new.id and decision in ('pending','waiting');
 if s.id is not null then perform public.expense_notify(s.assignee_id,new.id,s.id,'withdrawn','신청이 철회되었습니다','신청자가 결재 요청을 철회했습니다.',new.id::text||':withdrawn');end if;
 end if;
 return new;
end;
$$;
create trigger expense_stage_transition after update of status on public.expense_requests for each row execute function public.expense_stage_started();

create function public.expense_can_decide(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_member() and exists(select 1 from public.expense_requests e join public.budget_lines b on b.id=e.budget_line_id
 join public.fiscal_years y on y.id=b.fiscal_year_id join public.expense_steps s on s.expense_id=e.id
 where e.id=p_id and e.status='submitted' and not y.closed and e.requester_id<>auth.uid()
 and s.decision='pending' and s.kind='approval' and s.assignee_id=auth.uid() and public.expense_user_role(auth.uid(),s.role,b.org_unit_id))
$$;
create function public.decide_expense(p_id uuid,p_revision integer,p_step uuid,p_decision text,p_note text)
 returns void language plpgsql security definer set search_path='' as $$
declare e public.expense_requests;b public.budget_lines;s public.expense_steps;n public.expense_steps;v_note text;
begin
 perform pg_advisory_xact_lock(79335005);
 select * into e from public.expense_requests where id=p_id for update;
 if not public.is_active_member() or e.id is null then raise exception 'forbidden' using errcode='42501';end if;
 if e.status<>'submitted' then raise exception 'submitted required';end if;
 if e.revision is distinct from p_revision then raise exception 'version conflict';end if;
 select * into b from public.budget_lines where id=e.budget_line_id;
 if not exists(select 1 from public.fiscal_years where id=b.fiscal_year_id and not closed) then raise exception 'closed';end if;
 select * into s from public.expense_steps where expense_id=e.id and decision='pending';
 if s.id is null or s.id is distinct from p_step or s.kind<>'approval' or s.assignee_id<>auth.uid() or e.requester_id=auth.uid()
 or not public.expense_user_role(auth.uid(),s.role,b.org_unit_id) then raise exception 'not current approver' using errcode='42501';end if;
 if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'invalid decision';end if;
 v_note=trim(coalesce(p_note,''));if length(v_note)>1000 then raise exception 'note too long';end if;
 if p_decision='rejected' and length(v_note)=0 then raise exception 'rejection reason required';end if;
 if p_decision='approved' then
 select * into n from public.expense_steps where expense_id=e.id and position>s.position order by position limit 1;
 if n.id is null or not public.expense_user_role(n.assignee_id,n.role,b.org_unit_id) then raise exception 'next assignee unavailable';end if;
 end if;
 update public.expense_steps set decision=p_decision,decided_at=now(),decided_by=auth.uid(),decision_note=v_note where id=s.id;
 update public.notifications set resolved_at=coalesce(resolved_at,now()),read_at=coalesce(read_at,now()) where step_id=s.id and kind='approval_required';
 if p_decision='rejected' then
 update public.expense_steps set decision='skipped' where expense_id=e.id and decision='waiting';
 update public.expense_requests set status='rejected',ended_reason=v_note,revision=revision+1,updated_at=now() where id=e.id;
 perform public.expense_notify(e.requester_id,e.id,s.id,'rejected','지출결의서가 반려되었습니다',s.label||': '||v_note,e.id::text||':rejected');
 else
 update public.expense_steps set decision='pending' where id=n.id;
 update public.expense_requests set status=case when n.kind='payment' then 'approved' else 'submitted' end,revision=revision+1,updated_at=now() where id=e.id;
 if n.kind='payment' then
 perform public.expense_notify(n.assignee_id,e.id,n.id,'payment_ready','승인 완료 · 지급 대기','모든 승인 단계가 완료되었습니다. 지급 대상 신청서를 확인하세요.',n.id::text||':payment_ready');
 perform public.expense_notify(e.requester_id,e.id,null,'approved','지출결의서 승인이 완료되었습니다','지급 대기 상태입니다. 실제 지급은 아직 완료되지 않았습니다.',e.id::text||':approved');
 else
 perform public.expense_notify(n.assignee_id,e.id,n.id,'approval_required','결재 요청이 도착했습니다',n.label||' 단계의 승인이 필요합니다.',n.id::text||':approval_required');
 end if;
 end if;
 insert into public.expense_history(expense_id,actor_id,action,note) values(e.id,auth.uid(),case when p_decision='approved' then 'step_approved' else 'step_rejected' end,s.label||' / '||s.assignee_name||case when v_note<>'' then ': '||v_note else '' end);
end;
$$;
create function public.revise_expense(p_id uuid,p_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.expense_requests;v_new uuid;
begin
 perform pg_advisory_xact_lock(79335005);select * into e from public.expense_requests where id=p_id for update;
 if not public.is_active_member() or e.id is null or e.requester_id<>auth.uid() or not public.can_create_expense(e.budget_line_id) then raise exception 'forbidden' using errcode='42501';end if;
 if e.status<>'rejected' then raise exception 'rejected required';end if;
 select id into v_new from public.expense_requests where resubmission_of=e.id;
 if v_new is not null then return v_new;end if;
 if e.revision is distinct from p_revision then raise exception 'version conflict';end if;
 perform public.expense_check_budget(e.budget_line_id,e.spent_on);
 v_new=gen_random_uuid();
 insert into public.expense_requests(id,requester_id,budget_line_id,title,description,payee_name,spent_on,amount,resubmission_of)
 values(v_new,e.requester_id,e.budget_line_id,e.title,e.description,e.payee_name,e.spent_on,e.amount,e.id);
 insert into public.expense_history(expense_id,actor_id,action,note) values(v_new,auth.uid(),'revision_created','반려 신청서 E'||lpad(e.request_no::text,6,'0')||'의 수정본 작성');
 return v_new;
end;
$$;
create function public.read_notification(p_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare n public.notifications;
begin
 select * into n from public.notifications where id=p_id and recipient_id=auth.uid();
 if not public.is_active_member() or n.id is null or not public.can_read_expense(n.expense_id) then raise exception 'forbidden' using errcode='42501';end if;
 update public.notifications set read_at=coalesce(read_at,now()) where id=n.id;return n.expense_id;
end;
$$;
create function public.read_all_notifications() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_active_member() then raise exception 'forbidden' using errcode='42501';end if;
 update public.notifications set read_at=now() where recipient_id=auth.uid() and read_at is null and public.can_read_expense(expense_id);
end;
$$;
alter table public.notifications enable row level security;
create policy notifications_read on public.notifications for select to authenticated using(recipient_id=auth.uid() and public.is_active_member() and public.can_read_expense(expense_id));
revoke all on public.notifications from anon,authenticated;
grant select on public.notifications to authenticated;
revoke all on function public.expense_notify(uuid,uuid,uuid,text,text,text,text),public.expense_stage_started(),public.expense_can_decide(uuid),public.decide_expense(uuid,integer,uuid,text,text),public.revise_expense(uuid,integer),public.read_notification(uuid),public.read_all_notifications() from public,anon,authenticated;
grant execute on function public.expense_can_decide(uuid),public.decide_expense(uuid,integer,uuid,text,text),public.revise_expense(uuid,integer),public.read_notification(uuid),public.read_all_notifications() to authenticated;

create or replace function public.can_read_expense(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_member() and exists(select 1 from public.expense_requests e join public.budget_lines b on b.id=e.budget_line_id
 where e.id=p_id and (e.requester_id=auth.uid() or public.is_admin() or
 (e.status in ('submitted','approved','rejected','withdrawn') and (public.expense_user_role(auth.uid(),'auditor',b.org_unit_id) or exists(
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
 select coalesce(sum(amount),0) into held from public.expense_requests where budget_line_id=b.id and status in ('submitted','approved');
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

create or replace function public.end_expense(p_id uuid,p_revision integer,p_action text,p_reason text)
 returns void language plpgsql security definer set search_path='' as $$
declare e public.expense_requests;
begin
 perform pg_advisory_xact_lock(79335005);select * into e from public.expense_requests where id=p_id for update;
 if not public.is_active_member() or e.id is null or e.requester_id<>auth.uid() then raise exception 'forbidden' using errcode='42501';end if;
 if e.revision is distinct from p_revision then raise exception 'version conflict';end if;
 if p_action='cancelled' then
 if e.status<>'draft' then raise exception 'draft required';end if;
 elsif p_action='withdrawn' then
 if e.status<>'submitted' then raise exception 'submitted required';end if;
 if exists(select 1 from public.expense_steps where expense_id=e.id and decision='approved') then raise exception 'approval already started';end if;
 else raise exception 'invalid action';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'reason required';end if;
 if exists(select 1 from public.expense_receipts where expense_id=e.id and state in ('pending','removing')) then raise exception 'receipt unfinished';end if;
 update public.expense_requests set status=p_action,ended_reason=trim(p_reason),revision=revision+1,updated_at=now() where id=e.id;
 insert into public.expense_history(expense_id,actor_id,action,note) values(e.id,auth.uid(),p_action,trim(p_reason));
end;
$$;

create or replace function public.expense_budget_status(p_budget uuid)
 returns table(allocated numeric,reserved numeric,unreserved numeric) language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.budget_lines b where b.id=p_budget and public.can_view_budget(b.org_unit_id)) then raise exception 'forbidden' using errcode='42501';end if;
 return query select b.amount,coalesce(sum(e.amount),0),b.amount-coalesce(sum(e.amount),0) from public.budget_lines b
 left join public.expense_requests e on e.budget_line_id=b.id and e.status in ('submitted','approved') where b.id=p_budget group by b.id;
end;
$$;

create or replace function public.protect_reserved_budget() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(79335005);
 if new.amount<(select coalesce(sum(amount),0) from public.expense_requests where budget_line_id=new.id and status in ('submitted','approved')) then raise exception 'reserved budget';end if;
 return new;
end;
$$;

-- Preserve submitted Day 3 records and snapshots; start their first approval once.
update public.expense_steps s set decision='pending' from public.expense_requests e
 where e.id=s.expense_id and e.status='submitted' and s.position=(select min(x.position) from public.expense_steps x where x.expense_id=e.id and x.kind='approval');
insert into public.notifications(recipient_id,expense_id,step_id,kind,title,message,event_key)
 select s.assignee_id,e.id,s.id,'approval_required','결재 요청이 도착했습니다',s.label||' 단계의 승인이 필요합니다.',s.id::text||':approval_required'
 from public.expense_steps s join public.expense_requests e on e.id=s.expense_id where e.status='submitted' and s.decision='pending'
 on conflict(event_key) do nothing;
commit;
