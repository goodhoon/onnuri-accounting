begin;
-- Day 3: saved requests, private receipts, submission snapshots and budget holds.
create table public.expense_requests (
 id uuid primary key, request_no bigint generated always as identity unique,
 requester_id uuid not null references public.profiles(id),
 budget_line_id uuid not null references public.budget_lines(id),
 title text not null check(length(trim(title)) between 1 and 120),
 description text not null check(length(trim(description)) between 1 and 2000),
 payee_name text not null check(length(trim(payee_name)) between 1 and 100),
 spent_on date not null, amount numeric(14,2) not null check(amount>0),
 status text not null default 'draft' check(status in ('draft','submitted','withdrawn','cancelled')),
 revision integer not null default 1, workflow_version_id uuid references public.workflow_versions(id),
 submitted_at timestamptz, ended_reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.expense_requests(requester_id,created_at desc);
create index on public.expense_requests(budget_line_id,status);
create table public.expense_steps (
 id uuid primary key default gen_random_uuid(), expense_id uuid not null references public.expense_requests(id),
 position integer not null, label text not null, role public.app_role not null, kind public.step_kind not null,
 source_step_id uuid not null references public.workflow_steps(id),
 assignee_id uuid not null references public.profiles(id), assignee_name text not null,
 unique(expense_id,position)
);
create index on public.expense_steps(assignee_id,expense_id);
create table public.expense_receipts (
 id uuid primary key default gen_random_uuid(),expense_id uuid not null references public.expense_requests(id),
 object_path text not null unique,original_name text not null check(length(original_name) between 1 and 200),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','application/pdf')),
 byte_size bigint not null check(byte_size between 1 and 5242880),
 state text not null default 'pending' check(state in ('pending','ready','removing','deleted')),
 created_at timestamptz not null default now()
);
create index on public.expense_receipts(expense_id);
create table public.expense_history (
 id uuid primary key default gen_random_uuid(),expense_id uuid not null references public.expense_requests(id),
 actor_id uuid not null references public.profiles(id),action text not null,
 note text not null default '',created_at timestamptz not null default now()
);
create index on public.expense_history(expense_id,created_at);

-- Explicit role membership for assignees: admin does not implicitly become an approver.
create function public.expense_user_role(p_user uuid,p_role public.app_role,p_org uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 with recursive ancestors as (
 select id,parent_id from public.org_units where id=p_org
 union all select o.id,o.parent_id from public.org_units o join ancestors a on a.parent_id=o.id
 ) select exists(select 1 from public.role_assignments r join public.profiles p on p.id=r.user_id
 where p.active and r.user_id=p_user and r.role=p_role
 and (r.org_unit_id in(select id from ancestors) or (r.org_unit_id is null and r.role in ('payment_officer','auditor'))))
$$;
create function public.can_create_expense(p_budget uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_member() and exists(select 1 from public.budget_lines b where b.id=p_budget
 and (public.is_admin() or public.expense_user_role(auth.uid(),'applicant',b.org_unit_id)))
$$;
create function public.can_read_expense(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_member() and exists(select 1 from public.expense_requests e join public.budget_lines b on b.id=e.budget_line_id
 where e.id=p_id and (e.requester_id=auth.uid() or public.is_admin() or
 (e.status in ('submitted','withdrawn') and (public.expense_user_role(auth.uid(),'auditor',b.org_unit_id) or exists(
 select 1 from public.expense_steps s where s.expense_id=e.id and s.assignee_id=auth.uid()
 and public.expense_user_role(auth.uid(),s.role,b.org_unit_id))))))
$$;
create function public.expense_create_budget_ids() returns table(id uuid) language sql stable security definer set search_path='' as $$
 select b.id from public.budget_lines b where public.can_create_expense(b.id)
$$;
create function public.expense_check_budget(p_budget uuid,p_date date) returns void language plpgsql security definer set search_path='' as $$
declare b public.budget_lines;y public.fiscal_years;
begin
 select * into b from public.budget_lines where id=p_budget;if b.id is null then raise exception 'not found';end if;
 select * into y from public.fiscal_years where id=b.fiscal_year_id;
 if y.closed then raise exception 'closed';end if;
 if p_date is null or p_date<y.starts_on or p_date>y.ends_on then raise exception 'expense date';end if;
 if not exists(select 1 from public.org_units where id=b.org_unit_id and active) or not exists(select 1 from public.accounts where id=b.account_id and active and category='expense') then raise exception 'inactive';end if;
 if b.event_id is not null and not exists(select 1 from public.events where id=b.event_id and active and org_unit_id=b.org_unit_id and p_date between starts_on and ends_on) then raise exception 'expense date or inactive event';end if;
end;
$$;
create function public.save_expense(p_id uuid,p_revision integer,p_budget uuid,p_title text,p_description text,p_payee text,p_date date,p_amount text)
 returns uuid language plpgsql security definer set search_path='' as $$
declare e public.expense_requests;
begin
 perform pg_advisory_xact_lock(79335005);
 if not public.can_create_expense(p_budget) then raise exception 'forbidden' using errcode='42501';end if;
 perform public.expense_check_budget(p_budget,p_date);
 if p_amount is null or p_amount !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' or p_amount::numeric<=0 then raise exception 'invalid money';end if;
 select * into e from public.expense_requests where id=p_id for update;
 if e.id is null then
 if p_revision is distinct from 0 then raise exception 'version conflict';end if;
 insert into public.expense_requests(id,requester_id,budget_line_id,title,description,payee_name,spent_on,amount)
 values(p_id,auth.uid(),p_budget,trim(p_title),trim(p_description),trim(p_payee),p_date,p_amount::numeric);
 else
 if e.requester_id<>auth.uid() then raise exception 'forbidden' using errcode='42501';end if;
 if e.status<>'draft' then raise exception 'draft required';end if;
 if p_revision is distinct from e.revision then raise exception 'version conflict';end if;
 update public.expense_requests set budget_line_id=p_budget,title=trim(p_title),description=trim(p_description),payee_name=trim(p_payee),spent_on=p_date,amount=p_amount::numeric,revision=revision+1,updated_at=now() where id=p_id;
 end if;
 insert into public.expense_history(expense_id,actor_id,action) values(p_id,auth.uid(),case when e.id is null then 'created' else 'updated' end);
 return p_id;
end;
$$;
create function public.expense_approver_choices(p_id uuid)
 returns table(step_id uuid,"position" integer,label text,role public.app_role,user_id uuid,display_name text,version integer,version_id uuid)
 language plpgsql stable security definer set search_path='' as $$
declare e public.expense_requests;v_id uuid;v_version integer;v_org uuid;
begin
 select * into e from public.expense_requests where id=p_id;
 if not public.is_active_member() or e.id is null or e.requester_id<>auth.uid() or e.status<>'draft' then raise exception 'forbidden' using errcode='42501';end if;
 select b.org_unit_id into v_org from public.budget_lines b where b.id=e.budget_line_id;
 select w.id,w.version into v_id,v_version from public.workflow_versions w order by w.version desc limit 1;
 return query select s.id,s.position,s.label,s.role,p.id,p.display_name,v_version,v_id
 from public.workflow_steps s left join public.profiles p on p.active and p.id<>e.requester_id and public.expense_user_role(p.id,s.role,v_org)
 where s.workflow_id=v_id order by s.position,p.display_name,p.id;
end;
$$;
create function public.submit_expense(p_id uuid,p_revision integer,p_workflow uuid,p_assignees jsonb)
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
 select coalesce(sum(amount),0) into held from public.expense_requests where budget_line_id=b.id and status='submitted';
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
create function public.end_expense(p_id uuid,p_revision integer,p_action text,p_reason text)
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
 else raise exception 'invalid action';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'reason required';end if;
 if exists(select 1 from public.expense_receipts where expense_id=e.id and state in ('pending','removing')) then raise exception 'receipt unfinished';end if;
 update public.expense_requests set status=p_action,ended_reason=trim(p_reason),revision=revision+1,updated_at=now() where id=e.id;
 insert into public.expense_history(expense_id,actor_id,action,note) values(e.id,auth.uid(),p_action,trim(p_reason));
end;
$$;

-- A pending attachment blocks submission. Removal is two-phase so failed Storage API
-- calls can be retried without losing the metadata or freezing an incomplete submission.
create function public.prepare_expense_receipt(p_expense uuid,p_name text,p_type text,p_size bigint)
 returns table(id uuid,object_path text) language plpgsql security definer set search_path='' as $$
declare e public.expense_requests;r uuid=gen_random_uuid();path text;ext text;
begin
 select * into e from public.expense_requests where expense_requests.id=p_expense for update;
 if not public.is_active_member() or e.id is null or e.requester_id<>auth.uid() or not public.can_create_expense(e.budget_line_id) then raise exception 'forbidden' using errcode='42501';end if;
 if e.status<>'draft' then raise exception 'draft required';end if;
 if p_type not in ('image/jpeg','image/png','application/pdf') or p_type is null or p_size is null or p_size not between 1 and 5242880 or p_name is null or length(p_name) not between 1 and 200 or p_name ~ '[[:cntrl:]/\\]' then raise exception 'invalid receipt';end if;
 if (select count(*) from public.expense_receipts where expense_id=e.id and state<>'deleted')>=10 then raise exception 'receipt limit';end if;
 ext=case p_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'pdf' end;
 path=e.requester_id::text||'/'||e.id::text||'/'||r::text||'.'||ext;
 insert into public.expense_receipts(id,expense_id,object_path,original_name,mime_type,byte_size) values(r,e.id,path,p_name,p_type,p_size);
 update public.expense_requests set revision=revision+1,updated_at=now() where expense_requests.id=e.id;
 return query select r,path;
end;
$$;
create function public.finish_expense_receipt(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.expense_receipts;e public.expense_requests;m jsonb;
begin
 select * into r from public.expense_receipts where id=p_id;
 select * into e from public.expense_requests where id=r.expense_id for update;
 if not public.is_active_member() or e.id is null or e.requester_id<>auth.uid() then raise exception 'forbidden' using errcode='42501';end if;
 if e.status<>'draft' then raise exception 'draft required';end if;
 select * into r from public.expense_receipts where id=p_id;
 if r.state='ready' then return;end if;
 if r.state<>'pending' then raise exception 'invalid receipt state';end if;
 select metadata into m from storage.objects where bucket_id='expense-receipts' and name=r.object_path;
 if m is null or (m->>'size')::bigint is distinct from r.byte_size or m->>'mimetype' is distinct from r.mime_type then raise exception 'receipt missing';end if;
 update public.expense_receipts set state='ready' where id=r.id;
 update public.expense_requests set revision=revision+1,updated_at=now() where id=e.id;
 insert into public.expense_history(expense_id,actor_id,action,note) values(e.id,auth.uid(),'receipt_added',r.original_name);
end;
$$;
create function public.remove_expense_receipt(p_id uuid,p_finish boolean) returns text language plpgsql security definer set search_path='' as $$
declare r public.expense_receipts;e public.expense_requests;
begin
 select * into r from public.expense_receipts where id=p_id;
 select * into e from public.expense_requests where id=r.expense_id for update;
 if not public.is_active_member() or e.id is null or e.requester_id<>auth.uid() then raise exception 'forbidden' using errcode='42501';end if;
 if e.status<>'draft' then raise exception 'draft required';end if;
 select * into r from public.expense_receipts where id=p_id;
 if r.state='deleted' then return r.object_path;end if;
 if p_finish then
 if r.state<>'removing' or exists(select 1 from storage.objects where bucket_id='expense-receipts' and name=r.object_path) then raise exception 'receipt unfinished';end if;
 update public.expense_receipts set state='deleted' where id=p_id;
 insert into public.expense_history(expense_id,actor_id,action,note) values(e.id,auth.uid(),'receipt_removed',r.original_name);
 else update public.expense_receipts set state='removing' where id=p_id;end if;
 update public.expense_requests set revision=revision+1,updated_at=now() where id=e.id;return r.object_path;
end;
$$;
create function public.expense_receipt_access(p_path text,p_operation text) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_active_member() and exists(select 1 from public.expense_receipts r join public.expense_requests e on e.id=r.expense_id
 where r.object_path=p_path and r.state<>'deleted' and case
 when p_operation='read' then (r.state='ready' and public.can_read_expense(e.id)) or (e.requester_id=auth.uid() and e.status='draft')
 when p_operation='insert' then e.requester_id=auth.uid() and e.status='draft' and r.state='pending' and public.can_create_expense(e.budget_line_id)
 when p_operation='delete' then e.requester_id=auth.uid() and e.status='draft' and r.state='removing'
 else false end)
$$;
create function public.expense_budget_status(p_budget uuid)
 returns table(allocated numeric,reserved numeric,unreserved numeric) language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.budget_lines b where b.id=p_budget and public.can_view_budget(b.org_unit_id)) then raise exception 'forbidden' using errcode='42501';end if;
 return query select b.amount,coalesce(sum(e.amount),0),b.amount-coalesce(sum(e.amount),0) from public.budget_lines b
 left join public.expense_requests e on e.budget_line_id=b.id and e.status='submitted' where b.id=p_budget group by b.id;
end;
$$;
create function public.protect_reserved_budget() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(79335005);
 if new.amount<(select coalesce(sum(amount),0) from public.expense_requests where budget_line_id=new.id and status='submitted') then raise exception 'reserved budget';end if;
 return new;
end;
$$;
create trigger reserved_budget_floor before update of amount on public.budget_lines for each row execute function public.protect_reserved_budget();

alter table public.expense_requests enable row level security;
alter table public.expense_steps enable row level security;
alter table public.expense_receipts enable row level security;
alter table public.expense_history enable row level security;
create policy expenses_read on public.expense_requests for select to authenticated using(public.can_read_expense(id));
create policy expense_steps_read on public.expense_steps for select to authenticated using(public.can_read_expense(expense_id));
create policy expense_receipts_read on public.expense_receipts for select to authenticated using(public.can_read_expense(expense_id) and (state='ready' or exists(select 1 from public.expense_requests e where e.id=expense_id and e.requester_id=auth.uid())));
create policy expense_history_read on public.expense_history for select to authenticated using(public.can_read_expense(expense_id));
revoke all on public.expense_requests,public.expense_steps,public.expense_receipts,public.expense_history from anon,authenticated;
grant select on public.expense_requests,public.expense_steps,public.expense_receipts,public.expense_history to authenticated;
create trigger audit_expenses after insert or update or delete on public.expense_requests for each row execute function public.audit_change();
create trigger audit_expense_steps after insert or update or delete on public.expense_steps for each row execute function public.audit_change();
create trigger audit_expense_receipts after insert or update or delete on public.expense_receipts for each row execute function public.audit_change();
create trigger audit_expense_history after insert or update or delete on public.expense_history for each row execute function public.audit_change();
-- Explicit grants only. Internal helpers are not public RPCs.
revoke all on function public.expense_create_budget_ids(),public.expense_user_role(uuid,public.app_role,uuid),public.can_create_expense(uuid),public.can_read_expense(uuid),public.expense_check_budget(uuid,date),public.save_expense(uuid,integer,uuid,text,text,text,date,text),public.expense_approver_choices(uuid),public.submit_expense(uuid,integer,uuid,jsonb),public.end_expense(uuid,integer,text,text),public.prepare_expense_receipt(uuid,text,text,bigint),public.finish_expense_receipt(uuid),public.remove_expense_receipt(uuid,boolean),public.expense_receipt_access(text,text),public.expense_budget_status(uuid),public.protect_reserved_budget() from public,anon,authenticated;
grant execute on function public.expense_create_budget_ids(),public.can_create_expense(uuid),public.can_read_expense(uuid),public.save_expense(uuid,integer,uuid,text,text,text,date,text),public.expense_approver_choices(uuid),public.submit_expense(uuid,integer,uuid,jsonb),public.end_expense(uuid,integer,text,text),public.prepare_expense_receipt(uuid,text,text,bigint),public.finish_expense_receipt(uuid),public.remove_expense_receipt(uuid,boolean),public.expense_receipt_access(text,text),public.expense_budget_status(uuid) to authenticated;

-- Private bucket, no UPDATE/upsert policy: a submitted receipt cannot be replaced.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('expense-receipts','expense-receipts',false,5242880,array['image/jpeg','image/png','application/pdf']);
create policy expense_receipt_upload on storage.objects for insert to authenticated
 with check(bucket_id='expense-receipts' and public.expense_receipt_access(name,'insert'));
create policy expense_receipt_download on storage.objects for select to authenticated
 using(bucket_id='expense-receipts' and public.expense_receipt_access(name,'read'));
create policy expense_receipt_delete on storage.objects for delete to authenticated
 using(bucket_id='expense-receipts' and public.expense_receipt_access(name,'delete'));
commit;
