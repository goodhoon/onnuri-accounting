begin;
-- Increase attachment limit while preserving existing files and permissions.
create or replace function public.prepare_expense_receipt(p_expense uuid,p_name text,p_type text,p_size bigint)
 returns table(id uuid,object_path text) language plpgsql security definer set search_path='' as $$
declare e public.expense_requests;r uuid=gen_random_uuid();path text;ext text;
begin
 select * into e from public.expense_requests where expense_requests.id=p_expense for update;
 if not public.is_active_member() or e.id is null or e.requester_id<>auth.uid() or not public.can_create_expense(e.budget_line_id) then raise exception 'forbidden' using errcode='42501';end if;
 if e.status<>'draft' then raise exception 'draft required';end if;
 if p_type not in ('image/jpeg','image/png','application/pdf') or p_type is null or p_size is null or p_size not between 1 and 5242880 or p_name is null or length(p_name) not between 1 and 200 or p_name ~ '[[:cntrl:]/\\]' then raise exception 'invalid receipt';end if;
 if (select count(*) from public.expense_receipts where expense_id=e.id and state<>'deleted')>=20 then raise exception 'receipt limit';end if;
 ext=case p_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'pdf' end;
 path=e.requester_id::text||'/'||e.id::text||'/'||r::text||'.'||ext;
 insert into public.expense_receipts(id,expense_id,object_path,original_name,mime_type,byte_size) values(r,e.id,path,p_name,p_type,p_size);
 update public.expense_requests set revision=revision+1,updated_at=now() where expense_requests.id=e.id;
 return query select r,path;
end;
$$;
commit;
