begin;
-- Preserve all UUIDs and role links; replace display codes only.
with numbered as (select id,row_number() over(order by sort_order,created_at,id) as n from public.org_units)
update public.org_units o set code=lpad(n.n::text,3,'0') from numbered n where o.id=n.id;
create table public.fiscal_years (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 50),
 starts_on date not null, ends_on date not null, closed boolean not null default false,
 created_at timestamptz not null default now(),check(ends_on>=starts_on)
);
create table public.accounts (
 id uuid primary key default gen_random_uuid(),code text not null unique check(code ~ '^[45][1-9][0-9]{2}$'),
 name text not null check(length(trim(name)) between 1 and 100),
 category text not null check(category in ('income','expense')), active boolean not null default true,
 created_at timestamptz not null default now(),
 check((category='income' and left(code,1)='4') or (category='expense' and left(code,1)='5'))
);
create table public.events (
 id uuid primary key default gen_random_uuid(), code text not null unique check(code ~ '^[0-9]{3}$' and code<>'000'),
 name text not null check(length(trim(name)) between 1 and 100),org_unit_id uuid not null references public.org_units(id),
 starts_on date not null, ends_on date not null, active boolean not null default true,
 created_at timestamptz not null default now(),check(ends_on>=starts_on)
);
create table public.budget_lines (
 id uuid primary key default gen_random_uuid(), fiscal_year_id uuid not null references public.fiscal_years(id),
 org_unit_id uuid not null references public.org_units(id),event_id uuid references public.events(id),account_id uuid not null references public.accounts(id),
 amount numeric(14,2) not null default 0 check(amount>=0),revision integer not null default 0,
 created_at timestamptz not null default now(),unique nulls not distinct(fiscal_year_id,org_unit_id,event_id,account_id)
);
create index on public.budget_lines(org_unit_id,fiscal_year_id);
create table public.budget_changes (
 id uuid primary key default gen_random_uuid(),budget_line_id uuid not null references public.budget_lines(id),
 delta numeric(14,2) not null check(delta<>0),reason text not null check(length(trim(reason)) between 1 and 500),
 transfer_id uuid,actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create index on public.budget_changes(budget_line_id,created_at);

create function public.can_view_budget(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_org_role('applicant',p_org) or public.has_org_role('team_leader',p_org) or public.has_org_role('department_head',p_org) or public.has_org_role('vision_member',p_org) or public.has_org_role('payment_officer',p_org) or public.has_org_role('auditor',p_org)
$$;
create function public.require_admin() returns void language plpgsql security definer set search_path='' as $$
begin if not public.is_admin() then raise exception 'forbidden' using errcode='42501';end if;end;
$$;
create function public.validate_year() returns trigger language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(79335004);
 if exists(select 1 from public.fiscal_years y where y.id<>new.id and daterange(y.starts_on,y.ends_on,'[]') && daterange(new.starts_on,new.ends_on,'[]')) then raise exception 'overlapping fiscal year';end if;
 if tg_op='UPDATE' and (new.starts_on<>old.starts_on or new.ends_on<>old.ends_on) and exists(select 1 from public.budget_lines where fiscal_year_id=new.id) then raise exception 'dates already in use';end if;
 return new;
end;
$$;
create trigger fiscal_year_validation before insert or update on public.fiscal_years for each row execute function public.validate_year();
create function public.save_year(p_id uuid,p_name text,p_start date,p_end date,p_closed boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 perform public.require_admin();perform pg_advisory_xact_lock(79335005);
 if p_id is null then insert into public.fiscal_years(name,starts_on,ends_on,closed) values(trim(p_name),p_start,p_end,p_closed) returning id into v_id;
 else update public.fiscal_years set name=trim(p_name),starts_on=p_start,ends_on=p_end,closed=p_closed where id=p_id returning id into v_id;end if;
 if v_id is null then raise exception 'unknown fiscal year';end if;return v_id;
end;
$$;
create function public.save_account(p_id uuid,p_group text,p_name text,p_active boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; n integer; v_category text;
begin
 perform public.require_admin();perform pg_advisory_xact_lock(79335006);
 if p_id is null then
 if p_group not in ('41','42','43','51','52','53','54','55','56','57','58','59') or p_group is null then raise exception 'invalid group';end if;
 select coalesce(max(right(code,2)::int),0)+1 into n from public.accounts where left(code,2)=p_group;
 if n>99 then raise exception 'account group full';end if;
 v_category=case when left(p_group,1)='4' then 'income' else 'expense' end;
 insert into public.accounts(code,name,category,active) values(p_group||lpad(n::text,2,'0'),trim(p_name),v_category,p_active) returning id into v_id;
 else update public.accounts set name=trim(p_name),active=p_active where id=p_id returning id into v_id;end if;
 if v_id is null then raise exception 'unknown account';end if;return v_id;
end;
$$;
create function public.save_event(p_id uuid,p_name text,p_org uuid,p_start date,p_end date,p_active boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;n integer;
begin
 perform public.require_admin();perform pg_advisory_xact_lock(79335007);
 if not exists(select 1 from public.org_units where id=p_org and active) then raise exception 'inactive organization';end if;
 if p_id is null then
 select coalesce(max(code::int),0)+1 into n from public.events;if n>999 then raise exception 'event codes full';end if;
 insert into public.events(code,name,org_unit_id,starts_on,ends_on,active) values(lpad(n::text,3,'0'),trim(p_name),p_org,p_start,p_end,p_active) returning id into v_id;
 else
 if exists(select 1 from public.budget_lines where event_id=p_id) and exists(select 1 from public.events where id=p_id and org_unit_id<>p_org) then raise exception 'event organization already in use';end if;
 update public.events set name=trim(p_name),org_unit_id=p_org,starts_on=p_start,ends_on=p_end,active=p_active where id=p_id returning id into v_id;
 end if;
 if v_id is null then raise exception 'unknown event';end if;return v_id;
end;
$$;
create function public.create_org(p_parent uuid,p_name text,p_kind public.org_kind) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;n integer;
begin
 perform public.require_admin();perform pg_advisory_xact_lock(79335001);
 select coalesce(max(code::int),0)+1 into n from public.org_units;if n>999 then raise exception 'organization codes full';end if;
 insert into public.org_units(parent_id,code,name,kind,sort_order) values(p_parent,lpad(n::text,3,'0'),trim(p_name),p_kind,n) returning id into v_id;return v_id;
end;
$$;
-- Budget amounts are allocations retained by each organization, NOT parent
-- ceilings. A transfer decreases one allocation and increases another atomically.
create function public.adjust_budget(p_year uuid,p_org uuid,p_event uuid,p_account uuid,p_delta text,p_reason text,p_expected_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_revision integer;v_amount numeric;v_delta numeric;
begin
 perform public.require_admin();perform pg_advisory_xact_lock(79335005);
 if p_delta is null or p_delta !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$' then raise exception 'invalid money';end if;
 v_delta=p_delta::numeric;
 if p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'reason required';end if;
 if not exists(select 1 from public.fiscal_years where id=p_year and not closed) then raise exception 'closed or unknown fiscal year';end if;
 if not exists(select 1 from public.org_units where id=p_org and active) then raise exception 'inactive organization';end if;
 if not exists(select 1 from public.accounts where id=p_account and category='expense' and active) then raise exception 'inactive expense account';end if;
 if p_event is not null and not exists(select 1 from public.events e join public.fiscal_years y on y.id=p_year where e.id=p_event and e.org_unit_id=p_org and e.active and e.starts_on<=y.ends_on and e.ends_on>=y.starts_on) then raise exception 'event mismatch';end if;
 select id,revision,amount into v_id,v_revision,v_amount from public.budget_lines where fiscal_year_id=p_year and org_unit_id=p_org and event_id is not distinct from p_event and account_id=p_account;
 if v_id is null then
 if p_expected_revision is distinct from 0 then raise exception 'version conflict';end if;
 insert into public.budget_lines(fiscal_year_id,org_unit_id,event_id,account_id) values(p_year,p_org,p_event,p_account) returning id,revision,amount into v_id,v_revision,v_amount;
 end if;
 if v_delta=0 and v_revision>0 then raise exception 'zero adjustment';end if;
 if p_expected_revision is distinct from v_revision then raise exception 'version conflict';end if;
 if v_amount+v_delta<0 then raise exception 'negative allocation';end if;
 update public.budget_lines set amount=amount+v_delta,revision=revision+1 where id=v_id;
 if v_delta<>0 then insert into public.budget_changes(budget_line_id,delta,reason,actor_id) values(v_id,v_delta,trim(p_reason),auth.uid());end if;
 return v_id;
end;
$$;
create function public.transfer_budget(p_from uuid,p_to uuid,p_amount text,p_reason text,p_from_revision integer,p_to_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
declare f public.budget_lines;t public.budget_lines;v_amount numeric;v_transfer uuid=gen_random_uuid();
begin
 perform public.require_admin();perform pg_advisory_xact_lock(79335005);
 if p_from=p_to then raise exception 'same allocation';end if;
 if p_amount is null or p_amount !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then raise exception 'invalid money';end if;
 v_amount=p_amount::numeric;if v_amount<=0 then raise exception 'positive amount required';end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'reason required';end if;
 select * into f from public.budget_lines where id=p_from;select * into t from public.budget_lines where id=p_to;
 if f.id is null or t.id is null or f.fiscal_year_id<>t.fiscal_year_id then raise exception 'same fiscal year required';end if;
 if not exists(select 1 from public.fiscal_years where id=f.fiscal_year_id and not closed) then raise exception 'closed fiscal year';end if;
 if p_from_revision is distinct from f.revision or p_to_revision is distinct from t.revision then raise exception 'version conflict';end if;
 if f.amount<v_amount then raise exception 'insufficient allocation';end if;
 if exists(select 1 from public.accounts where id in (f.account_id,t.account_id) and not active) or exists(select 1 from public.org_units where id in (f.org_unit_id,t.org_unit_id) and not active) or exists(select 1 from public.events where id in(f.event_id,t.event_id) and not active) then raise exception 'inactive dimension';end if;
 update public.budget_lines set amount=amount-v_amount,revision=revision+1 where id=f.id;
 update public.budget_lines set amount=amount+v_amount,revision=revision+1 where id=t.id;
 insert into public.budget_changes(budget_line_id,delta,reason,transfer_id,actor_id) values(f.id,-v_amount,trim(p_reason),v_transfer,auth.uid()),(t.id,v_amount,trim(p_reason),v_transfer,auth.uid());
 return v_transfer;
end;
$$;
create trigger audit_years after insert or update or delete on public.fiscal_years for each row execute function public.audit_change();
create trigger audit_accounts after insert or update or delete on public.accounts for each row execute function public.audit_change();
create trigger audit_events_dimension after insert or update or delete on public.events for each row execute function public.audit_change();
create trigger audit_budget_lines after insert or update or delete on public.budget_lines for each row execute function public.audit_change();
create trigger audit_budget_changes after insert or update or delete on public.budget_changes for each row execute function public.audit_change();
alter table public.fiscal_years enable row level security;
alter table public.accounts enable row level security;
alter table public.events enable row level security;
alter table public.budget_lines enable row level security;
alter table public.budget_changes enable row level security;
create policy years_read on public.fiscal_years for select to authenticated using(public.is_active_member());
create policy accounts_read on public.accounts for select to authenticated using(public.is_active_member());
create policy events_read on public.events for select to authenticated using(public.can_view_budget(org_unit_id));
create policy budgets_read on public.budget_lines for select to authenticated using(public.can_view_budget(org_unit_id));
create policy budget_changes_read on public.budget_changes for select to authenticated using(exists(select 1 from public.budget_lines b where b.id=budget_line_id and public.can_view_budget(b.org_unit_id)));
revoke all on public.fiscal_years,public.accounts,public.events,public.budget_lines,public.budget_changes from anon,authenticated;
grant select on public.fiscal_years,public.accounts,public.events,public.budget_lines,public.budget_changes to authenticated;
revoke all on function public.can_view_budget(uuid),public.require_admin(),public.validate_year(),public.save_year(uuid,text,date,date,boolean),public.save_account(uuid,text,text,boolean),public.save_event(uuid,text,uuid,date,date,boolean),public.create_org(uuid,text,public.org_kind),public.adjust_budget(uuid,uuid,uuid,uuid,text,text,integer),public.transfer_budget(uuid,uuid,text,text,integer,integer) from public,anon;
grant execute on function public.can_view_budget(uuid),public.save_year(uuid,text,date,date,boolean),public.save_account(uuid,text,text,boolean),public.save_event(uuid,text,uuid,date,date,boolean),public.create_org(uuid,text,public.org_kind),public.adjust_budget(uuid,uuid,uuid,uuid,text,text,integer),public.transfer_budget(uuid,uuid,text,text,integer,integer) to authenticated;
-- Starter chart: draft classifications, not imported financial records.
insert into public.accounts(code,name,category) values
('4101','일반헌금','income'),('4102','십일조','income'),('4103','감사헌금','income'),('4104','지정헌금','income'),
('4201','행사 참가비','income'),('4301','이자수입','income'),('4302','기타수입','income'),
('5101','급여','expense'),('5102','수당 및 사례비','expense'),('5103','직원 복리후생','expense'),
('5201','식비','expense'),('5202','소모품비','expense'),('5203','통신비','expense'),('5204','인쇄 및 사무비','expense'),('5205','수수료','expense'),
('5301','임차료','expense'),('5302','공과금','expense'),('5303','시설 수선비','expense'),('5304','보험료','expense'),
('5401','교재 및 도서비','expense'),('5402','교육 및 훈련비','expense'),('5403','행사 운영비','expense'),
('5501','교통 및 차량유지비','expense'),('5502','여비 및 숙박비','expense'),
('5601','장비구입비','expense'),('5602','장비 임차 및 유지비','expense'),
('5701','선교 지원금','expense'),('5702','구제 및 장학금','expense'),('5801','단체 분담금','expense'),('5901','기타지출','expense');
commit;
