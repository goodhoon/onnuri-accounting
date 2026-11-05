'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireMember } from '@/lib/session';
import { expenseError, receiptBucket, validateReceipt, hasReceiptSignature } from '@/lib/expenses';
export type ExpenseActionState = { error: string };
const value = (form: FormData, key: string) => String(form.get(key) ?? '');
function refresh(id: string) {
  revalidatePath('/notifications'); revalidatePath('/', 'layout'); revalidatePath('/expenses'); revalidatePath(`/expenses/${id}`); revalidatePath('/budgets');
}
export async function saveExpense(_: ExpenseActionState, form: FormData): Promise<ExpenseActionState> {
  const s = await requireMember();
  const { data, error } = await s.db.rpc('save_expense_with_bank', {
    p_id: value(form, 'id'), p_revision: Number(value(form, 'revision')), p_budget: value(form, 'budget'),
    p_title: value(form, 'title'), p_description: value(form, 'description'), p_payee: value(form, 'payee'),
    p_date: value(form, 'spent_on'), p_amount: value(form, 'amount'),
    p_holder:value(form,'holder'),p_bank:value(form,'bank_name'),p_account:value(form,'account_number'),
  });
  if (error) return { error: expenseError(error.message) };
  refresh(String(data)); redirect(`/expenses/${data}?saved=1`);
}
export async function submitExpense(_: ExpenseActionState, form: FormData): Promise<ExpenseActionState> {
  const s = await requireMember(), id = value(form, 'id');
  const choices = [...form.entries()].filter(([key]) => key.startsWith('assignee_'))
    .map(([key, user]) => ({ step_id: key.slice(9), user_id: String(user) }));
  const { error } = await s.db.rpc('submit_expense', {
    p_id: id, p_revision: Number(value(form, 'revision')), p_workflow: value(form, 'workflow'), p_assignees: choices,
  });
  if (error) return { error: expenseError(error.message) };
  refresh(id); redirect(`/expenses/${id}?submitted=1`);
}
export async function endExpense(_: ExpenseActionState, form: FormData): Promise<ExpenseActionState> {
  const s = await requireMember(), id = value(form, 'id');
  const { error } = await s.db.rpc('end_expense', { p_id: id, p_revision: Number(value(form, 'revision')), p_action: value(form, 'action'), p_reason: value(form, 'reason') });
  if (error) return { error: expenseError(error.message) };
  refresh(id); redirect(`/expenses/${id}`);
}
export async function prepareReceipt(expense: string, name: string, type: string, size: number) {
  const s = await requireMember();
  try { validateReceipt(name, type, size); } catch (e) { return { error: (e as Error).message }; }
  const { data, error } = await s.db.rpc('prepare_expense_receipt', { p_expense: expense, p_name: name, p_type: type, p_size: size });
  if (error) return { error: expenseError(error.message) };
  refresh(expense); return { id: String(data[0].id), path: String(data[0].object_path) };
}
export async function finishReceipt(id: string) {
  const s = await requireMember();
  const { data: r } = await s.db.from('expense_receipts').select('expense_id,object_path,mime_type,byte_size').eq('id', id).single();
  if (!r) return { error: '첨부를 찾을 수 없습니다.' };
  const { data: blob, error: downloadError } = await s.db.storage.from(receiptBucket).download(r.object_path);
  if (downloadError || !blob) return { error: '파일을 확인하지 못했습니다. 첨부 완료 재시도를 눌러 주세요.' };
  if (blob.size !== Number(r.byte_size) || !hasReceiptSignature(new Uint8Array(await blob.arrayBuffer()), r.mime_type)) return { error: '파일 내용과 형식이 맞지 않습니다. 첨부를 삭제하고 JPG·PNG·PDF 파일로 다시 올려 주세요.' };
  const { error } = await s.db.rpc('finish_expense_receipt', { p_id: id });
  refresh(r.expense_id); return error ? { error: expenseError(error.message) } : { error: '' };
}
export async function removeReceipt(id: string) {
  const s = await requireMember();
  const { data: r } = await s.db.from('expense_receipts').select('expense_id').eq('id', id).single();
  if (!r) return { error: '첨부를 찾을 수 없습니다.' };
  const { data: path, error } = await s.db.rpc('remove_expense_receipt', { p_id: id, p_finish: false });
  if (error) return { error: expenseError(error.message) };
  const { error: storageError } = await s.db.storage.from(receiptBucket).remove([String(path)]);
  if (storageError) { refresh(r.expense_id); return { error: '파일 삭제가 완료되지 않았습니다. 삭제 재시도를 눌러 주세요.' }; }
  const { error: finishError } = await s.db.rpc('remove_expense_receipt', { p_id: id, p_finish: true });
  refresh(r.expense_id); return finishError ? { error: expenseError(finishError.message) } : { error: '' };
}

export async function decideExpense(_: ExpenseActionState, form: FormData): Promise<ExpenseActionState> {
 const s = await requireMember(), id = value(form, 'id');
 const { error } = await s.db.rpc('decide_expense', {p_id:id,p_revision:Number(value(form,'revision')),p_step:value(form,'step'),p_decision:value(form,'decision'),p_note:value(form,'note')});
 if(error) return {error:expenseError(error.message)};
 refresh(id); redirect(`/expenses/${id}`);
}
export async function reviseExpense(_: ExpenseActionState, form: FormData): Promise<ExpenseActionState> {
 const s=await requireMember();
 const {data,error}=await s.db.rpc('revise_expense',{p_id:value(form,'id'),p_revision:Number(value(form,'revision'))});
 if(error) return {error:expenseError(error.message)};
 refresh(String(data)); redirect(`/expenses/${data}`);
}

export async function saveBank(_:ExpenseActionState,form:FormData):Promise<ExpenseActionState>{
 const s=await requireMember(),id=value(form,'id');
 const {error}=await s.db.rpc('save_expense_bank',{p_id:id,p_revision:Number(value(form,'revision')),p_holder:value(form,'holder'),p_bank:value(form,'bank_name'),p_account:value(form,'account_number')});
 if(error)return {error:expenseError(error.message)};
 refresh(id);redirect(`/expenses/${id}`);
}
