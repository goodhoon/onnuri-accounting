begin;

-- Keep previous snapshots intact. Only new submissions use the amount policy.
alter table public.expense_steps add column vision_quorum boolean not null default false;
drop index public.expense_one_pending_step;
create unique index expense_one_pending_single_step on public.expense_steps(expense_id)
 where decision='pending' and not vision_quorum;
create unique index expense_unique_vision_voter on public.expense_steps(expense_id,assignee_id)
 where vision_quorum;

create function public.expense_stage_required(p_role public.app_role,p_amount numeric)
returns boolean language sql immutable set search_path='' as $$
 select case p_role
   when 'team_leader' then true
   when 'department_head' then p_amount>100
   when 'vision_member' then p_amount>300
   when 'payment_officer' then true
   else false
 end
$$;
revoke all on function public.expense_stage_required(public.app_role,numeric) from public,anon,authenticated;

create or replace function public.expense_approver_choices(p_id uuid)
 returns table(step_id uuid,"position" integer,label text,role public.app_role,user_id uuid,display_name text,version integer,version_id uuid)
 language plpgsql stable security definer set search_path='' as $$
declare e public.expense_requests;v_id uuid;v_version integer;v_org uuid;
begin
 select * into e from public.expense_requests where id=p_id;
 if not public.is_active_member() or e.id is null or e.requester_id<>auth.uid() or e.status<>'draft' then raise exception 'forbidden' using errcode='42501';end if;
 select b.org_unit_id into v_org from public.budget_lines b where b.id=e.budget_line_id;
 select w.id,w.version into v_id,v_version from public.workflow_versions w where w.version=1;
 return query select s.id,s.position,s.label,s.role,p.id,p.display_name,v_version,v_id
 from public.workflow_steps s left join public.profiles p on p.active and p.id<>e.requester_id and public.expense_user_role(p.id,s.role,v_org)
 where s.workflow_id=v_id and public.expense_stage_required(s.role,e.amount) order by s.position,p.display_name,p.id;
end;
$$;

create or replace function public.submit_expense(p_id uuid,p_revision integer,p_workflow uuid,p_assignees jsonb)
 returns uuid language plpgsql security definer set search_path='' as $$
declare e public.expense_requests;b public.budget_lines;w uuid;s public.workflow_steps;v_user uuid;v_name text;held numeric;v_count integer; v_position integer:=0; v_members uuid[];
begin
 perform pg_advisory_xact_lock(79335005);
 select * into e from public.expense_requests where id=p_id for update;
 if not public.is_active_member() or e.id is null or e.requester_id<>auth.uid() or not public.can_create_expense(e.budget_line_id) then raise exception 'forbidden' using errcode='42501';end if;
 if e.status<>'draft' then raise exception 'draft required';end if;
 if e.revision is distinct from p_revision then raise exception 'version conflict';end if;
 perform public.expense_check_budget(e.budget_line_id,e.spent_on);
 if exists(select 1 from public.expense_receipts where expense_id=e.id and state in ('pending','removing')) then raise exception 'receipt unfinished';end if;
 if not exists(select 1 from public.expense_receipts r join storage.objects o on o.bucket_id='expense-receipts' and o.name=r.object_path where r.expense_id=e.id and r.state='ready') then raise exception 'receipt required';end if;
 select id into w from public.workflow_versions where version=1;
 if w is null or w is distinct from p_workflow then raise exception 'workflow changed';end if;
 select count(*) into v_count from public.workflow_steps where workflow_id=w and public.expense_stage_required(role,e.amount) and not (role='vision_member' and e.amount>500);
 if jsonb_typeof(p_assignees) is distinct from 'array' then raise exception 'invalid assignees';end if;
 if jsonb_array_length(p_assignees)<>v_count then raise exception 'invalid assignees';end if;
 select * into b from public.budget_lines where id=e.budget_line_id;
 select coalesce(sum(amount),0) into held from public.expense_requests where budget_line_id=b.id and status in ('submitted','approved','paid');
 if b.amount-held<e.amount then raise exception 'insufficient allocation';end if;
 for s in select * from public.workflow_steps where workflow_id=w and public.expense_stage_required(role,e.amount) order by position loop
 if s.role='vision_member' and e.amount>500 then
   select array_agg(p.id order by p.id) into v_members from public.profiles p
   where p.active and p.id<>e.requester_id and public.expense_user_role(p.id,s.role,b.org_unit_id);
   if coalesce(cardinality(v_members),0)<2 then raise exception 'vision quorum unavailable';end if;
   foreach v_user in array v_members loop
     v_position:=v_position+1;
     insert into public.expense_steps(expense_id,position,label,role,kind,source_step_id,assignee_id,assignee_name,vision_quorum)
     select e.id,v_position,s.label,s.role,s.kind,s.id,p.id,p.display_name,true from public.profiles p where p.id=v_user;
   end loop;
   continue;
 end if;
 if (select count(*) from jsonb_array_elements(p_assignees) a where a->>'step_id'=s.id::text)<>1 then raise exception 'invalid assignees';end if;
 select (a->>'user_id')::uuid into v_user from jsonb_array_elements(p_assignees) a where a->>'step_id'=s.id::text;
 if v_user is null or v_user=e.requester_id or not public.expense_user_role(v_user,s.role,b.org_unit_id) then raise exception 'invalid assignee';end if;
 select display_name into v_name from public.profiles where id=v_user;
 v_position:=v_position+1;
 insert into public.expense_steps(expense_id,position,label,role,kind,source_step_id,assignee_id,assignee_name)
 values(e.id,v_position,s.label,s.role,s.kind,s.id,v_user,v_name);
 end loop;
 update public.expense_requests set status='submitted',workflow_version_id=w,submitted_at=now(),revision=revision+1,updated_at=now() where id=e.id;
 insert into public.expense_history(expense_id,actor_id,action,note) values(e.id,auth.uid(),'submitted','결재선·담당자 고정 / 신청액 예산 예약');return e.id;
end;
$$;

create or replace function public.decide_expense(p_id uuid,p_revision integer,p_step uuid,p_decision text,p_note text)
 returns void language plpgsql security definer set search_path='' as $$
declare e public.expense_requests;b public.budget_lines;s public.expense_steps;n public.expense_steps;v_note text; advance boolean:=true; member_step public.expense_steps;
begin
 perform pg_advisory_xact_lock(79335005);
 select * into e from public.expense_requests where id=p_id for update;
 if not public.is_active_member() or e.id is null then raise exception 'forbidden' using errcode='42501';end if;
 if e.status<>'submitted' then raise exception 'submitted required';end if;
 if e.revision is distinct from p_revision then raise exception 'version conflict';end if;
 select * into b from public.budget_lines where id=e.budget_line_id;
 if not exists(select 1 from public.fiscal_years where id=b.fiscal_year_id and not closed) then raise exception 'closed';end if;
 select * into s from public.expense_steps where expense_id=e.id and id=p_step and decision='pending';
 if s.id is null or s.id is distinct from p_step or s.kind<>'approval' or s.assignee_id<>auth.uid() or e.requester_id=auth.uid()
 or not public.expense_user_role(auth.uid(),s.role,b.org_unit_id) then raise exception 'not current approver' using errcode='42501';end if;
 if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'invalid decision';end if;
 v_note=trim(coalesce(p_note,''));if length(v_note)>1000 then raise exception 'note too long';end if;
 if p_decision='rejected' and length(v_note)=0 then raise exception 'rejection reason required';end if;
 if p_decision='approved' then
   if s.vision_quorum then
     advance := exists(select 1 from public.expense_steps where expense_id=e.id and vision_quorum and decision='approved');
   end if;
   if advance then
     select * into n from public.expense_steps
     where expense_id=e.id and position>s.position and (not s.vision_quorum or not vision_quorum)
     order by position limit 1;
     if n.id is null then raise exception 'next assignee unavailable';end if;
     if n.vision_quorum then
       if (select count(*) from public.expense_steps v where v.expense_id=e.id and v.vision_quorum
           and public.expense_user_role(v.assignee_id,v.role,b.org_unit_id))<2 then
         raise exception 'vision quorum unavailable';
       end if;
     elsif not public.expense_user_role(n.assignee_id,n.role,b.org_unit_id) then
       raise exception 'next assignee unavailable';
     end if;
   end if;
 end if;
 update public.expense_steps set decision=p_decision,decided_at=now(),decided_by=auth.uid(),decision_note=v_note where id=s.id;
 update public.notifications set resolved_at=coalesce(resolved_at,now()),read_at=coalesce(read_at,now()) where step_id=s.id and kind='approval_required';
 if p_decision='rejected' then
 update public.expense_steps set decision='skipped' where expense_id=e.id and decision in ('waiting','pending');
 update public.notifications set resolved_at=coalesce(resolved_at,now()) where expense_id=e.id and kind='approval_required';
 update public.expense_requests set status='rejected',ended_reason=v_note,revision=revision+1,updated_at=now() where id=e.id;
 perform public.expense_notify(e.requester_id,e.id,s.id,'rejected','지출결의서가 반려되었습니다',s.label||': '||v_note,e.id::text||':rejected');
 elsif not advance then
 update public.expense_requests set revision=revision+1,updated_at=now() where id=e.id;
 else
 if s.vision_quorum then
   update public.notifications set resolved_at=coalesce(resolved_at,now())
   where expense_id=e.id and kind='approval_required' and step_id in
     (select id from public.expense_steps where expense_id=e.id and vision_quorum and decision='pending');
   update public.expense_steps set decision='skipped' where expense_id=e.id and vision_quorum and decision='pending';
 end if;
 if n.vision_quorum then
   update public.expense_steps v set decision='skipped'
   where v.expense_id=e.id and v.vision_quorum and v.decision='waiting'
     and not public.expense_user_role(v.assignee_id,v.role,b.org_unit_id);
   for member_step in select * from public.expense_steps where expense_id=e.id and vision_quorum and decision='waiting' loop
     update public.expense_steps set decision='pending' where id=member_step.id;
     perform public.expense_notify(member_step.assignee_id,e.id,member_step.id,'approval_required','결재 요청이 도착했습니다','비전위원 2명의 승인이 필요합니다.',member_step.id::text||':approval_required');
   end loop;
 else
   update public.expense_steps set decision='pending' where id=n.id;
 end if;
 update public.expense_requests set status=case when n.kind='payment' then 'approved' else 'submitted' end,revision=revision+1,updated_at=now() where id=e.id;
 if n.kind='payment' then
 perform public.expense_notify(n.assignee_id,e.id,n.id,'payment_ready','승인 완료 · 지급 대기','모든 승인 단계가 완료되었습니다. 지급 대상 신청서를 확인하세요.',n.id::text||':payment_ready');
 perform public.expense_notify(e.requester_id,e.id,null,'approved','지출결의서 승인이 완료되었습니다','지급 대기 상태입니다. 실제 지급은 아직 완료되지 않았습니다.',e.id::text||':approved');
 elsif not n.vision_quorum then
 perform public.expense_notify(n.assignee_id,e.id,n.id,'approval_required','결재 요청이 도착했습니다',n.label||' 단계의 승인이 필요합니다.',n.id::text||':approval_required');
 end if;
 end if;
 insert into public.expense_history(expense_id,actor_id,action,note) values(e.id,auth.uid(),case when p_decision='approved' then 'step_approved' else 'step_rejected' end,s.label||' / '||s.assignee_name||case when v_note<>'' then ': '||v_note else '' end);
end;
$$;

create function public.payment_expense_labels(p_ids uuid[])
returns table(id uuid,request_no bigint,title text,organization text,account text,event text)
language sql stable security definer set search_path='' as $$
 select e.id,e.request_no,e.title,o.code||' '||o.name,a.code||' '||a.name,
        coalesce(v.code||' '||v.name,'일반 운영')
 from public.expense_requests e
 join public.budget_lines b on b.id=e.budget_line_id
 join public.org_units o on o.id=b.org_unit_id
 join public.accounts a on a.id=b.account_id
 left join public.events v on v.id=b.event_id
 where cardinality(p_ids)<=200 and e.id=any(p_ids) and public.can_read_expense(e.id)
$$;
revoke all on function public.payment_expense_labels(uuid[]) from public,anon;
grant execute on function public.payment_expense_labels(uuid[]) to authenticated;

commit;
