'use client';
import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveBank, decideExpense, reviseExpense, saveExpense, submitExpense, endExpense, prepareReceipt, finishReceipt, removeReceipt } from './actions';
import { browserSupabase } from '@/lib/supabase/client';
import { receiptBucket, validateReceipt, maxReceipts } from '@/lib/expenses';
export type BudgetOption = { id: string; label: string; starts: string; ends: string };
export type ExpenseDraft = { id: string; revision: number; budget_line_id: string; title: string; description: string; payee_name: string; spent_on: string; amount: string | number };
export type ApproverChoice = { step_id: string; position: number; label: string; user_id: string | null; display_name: string | null; version: number; version_id: string };
export type ReceiptRow = { id: string; original_name: string; mime_type: string; byte_size: number; state: string };
export type BankDetails={holder:string;bank_name:string;account_number:string};
export function BankFields({bank}:{bank?:BankDetails|null}){return <><label>예금주<input name="holder" required maxLength={100} defaultValue={bank?.holder}/></label><label>은행명<input name="bank_name" required maxLength={100} defaultValue={bank?.bank_name}/></label><label>뉴질랜드 계좌번호<input name="account_number" required inputMode="numeric" maxLength={24} defaultValue={bank?.account_number} placeholder="00-0000-0000000-000" autoComplete="off"/></label><p className="small">실제 지급받을 계좌를 확인해 입력하세요. 계좌 소유 여부는 은행에서 별도로 확인해야 합니다. 제출 후에는 변경할 수 없습니다.</p></>;}
export function ExpenseForm({ id, budgets, draft,bank }: { id: string; budgets: BudgetOption[]; draft?: ExpenseDraft;bank?:BankDetails|null }) {
  const [state, action, pending] = useActionState(saveExpense, { error: '' });
  const [budget, setBudget] = useState(draft?.budget_line_id ?? budgets[0]?.id ?? '');
  const selected = budgets.find(b => b.id === budget);
  return <form action={action} className="stack">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="revision" value={draft?.revision ?? 0} />
    <label>사용할 예산 항목<select name="budget" value={budget} onChange={e => setBudget(e.target.value)} required><option value="">예산 선택</option>{budgets.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
    {!budgets.length && <p className="notice">신청 가능한 예산이 없습니다. 관리자에게 해당 조직의 신청자 권한과 예산 배정을 요청해 주세요.</p>}
    <label>제목<input name="title" required maxLength={120} defaultValue={draft?.title} placeholder="예: 주일 행사 식비 정산" /></label>
    <div className="grid"><label>지출일<input name="spent_on" type="date" required min={selected?.starts} max={selected?.ends} defaultValue={draft?.spent_on} /></label><label>신청 금액 (NZD)<input name="amount" inputMode="decimal" required pattern="[0-9]{1,12}(\.[0-9]{1,2})?" defaultValue={draft?.amount} placeholder="예: 35.50" /></label></div>
    <label>지급 대상 이름<input name="payee" required maxLength={100} defaultValue={draft?.payee_name} placeholder="환급받을 사람 또는 지급할 거래처" /></label>
    <BankFields bank={bank}/><label>지출 목적 · 상세 내용<textarea name="description" required maxLength={2000} defaultValue={draft?.description} placeholder="사용 목적과 내역을 입력해 주세요. 계좌번호는 이 칸에 입력하지 마세요." /></label>
    <p className="small">신청서 한 건에 예산 항목 한 개를 사용합니다. 저장 후 영수증을 첨부하고 제출할 수 있습니다. 예금주·은행명·계좌번호는 필수입니다.</p>
    {state.error && <p role="alert" className="error">{state.error}</p>}
    <button disabled={pending || !budgets.length}>{pending ? '저장 중…' : '임시저장'}</button>
  </form>;
}
export function SubmitForm({ expense, choices, canSubmit }: { expense: ExpenseDraft; choices: ApproverChoice[]; canSubmit: boolean }) {
  const [state, action, pending] = useActionState(submitExpense, { error: '' });
  const steps = [...new Map(choices.map(c => [c.step_id, c])).values()];
  const missing = !steps.length || steps.some(s => !choices.some(c => c.step_id === s.step_id && c.user_id));
  return <form action={action} className="stack">
    <input type="hidden" name="id" value={expense.id} /><input type="hidden" name="revision" value={expense.revision} /><input type="hidden" name="workflow" value={choices[0]?.version_id ?? ''} />
    <p>결재선 버전 {choices[0]?.version ?? '—'} · 제출 시 아래 담당자와 단계가 고정됩니다. 본인은 결재 담당자로 선택할 수 없습니다.</p>
    {steps.map(s => <label key={s.step_id}>{s.position}. {s.label}<select name={`assignee_${s.step_id}`} required defaultValue=""><option value="">담당자 선택</option>{choices.filter(c => c.step_id === s.step_id && c.user_id).map(c => <option key={c.user_id} value={c.user_id!}>{c.display_name}</option>)}</select></label>)}
    {missing && <p className="error">지정할 수 있는 담당자가 없는 단계가 있습니다. 관리자가 사용자 · 권한에서 해당 조직 또는 상위 조직의 역할을 먼저 지정해야 합니다.</p>}
    <p className="small">제출하면 수정·영수증 교체가 잠기고 신청액이 예산에서 예약됩니다. 현재 차례의 승인자에게 앱 내 알림이 생성됩니다. 수정한 내용은 위에서 먼저 임시저장해 주세요.</p>
    {!canSubmit && <p className="small">업로드가 완료된 영수증이 최소 한 개 필요하며, 미완료 첨부가 있으면 제출할 수 없습니다.</p>}
    {state.error && <p role="alert" className="error">{state.error}</p>}
    <button disabled={pending || missing || !canSubmit}>{pending ? '제출 중…' : '지출결의서 제출'}</button>
  </form>;
}
export function EndForm({ id, revision, submitted }: { id: string; revision: number; submitted: boolean }) {
  const [state, action, pending] = useActionState(endExpense, { error: '' });
  return <form action={action} className="stack"><input type="hidden" name="id" value={id} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="action" value={submitted ? 'withdrawn' : 'cancelled'} />
    <p>{submitted ? '제출을 철회하면 예약된 예산이 해제됩니다. 이 신청서는 기록으로 보존되며 다시 제출할 수 없습니다.' : '작성을 취소하면 이 신청서는 기록으로 보존되며 다시 수정할 수 없습니다.'} 필요하면 새 신청서를 작성하세요.</p>
    <label>{submitted ? '철회 사유' : '취소 사유'}<input name="reason" maxLength={500} required /></label>{state.error && <p className="error" role="alert">{state.error}</p>}
    <button className="secondary" disabled={pending}>{pending ? '처리 중…' : submitted ? '제출 철회' : '작성 취소'}</button></form>;
}
export function Receipts({ expenseId, receipts, editable }: { expenseId: string; receipts: ReceiptRow[]; editable: boolean }) {
  const router = useRouter(); const [message, setMessage] = useState(''); const [pending, start] = useTransition();
  const shown = receipts.filter(r => r.state !== 'deleted');
  function task(fn: () => Promise<{ error?: string }>) { start(async () => { setMessage(''); try { const result = await fn(); setMessage(result.error || '처리했습니다.'); } catch { setMessage('연결이 끊겼습니다. 목록에서 첨부 상태를 확인하고 재시도해 주세요.'); } finally { router.refresh(); } }); }
  return <div className="stack"><p>JPG·PNG·PDF, 파일당 최대 5MB, 신청서당 최대 20개. 영수증은 비공개로 보관합니다.</p>
    <ul className="receipt-list">{shown.map(r => <li key={r.id}><div><b>{r.original_name}</b><div className="small">{(Number(r.byte_size) / 1024).toFixed(0)} KB · {r.state === 'ready' ? '첨부 완료' : r.state === 'removing' ? '삭제 미완료' : '업로드 미완료'}</div></div><div className="receipt-actions">{r.state === 'ready' && <a href={`/expenses/receipts/${r.id}`} target="_blank" rel="noopener noreferrer">다운로드</a>}{editable && r.state === 'pending' && <button disabled={pending} className="secondary" onClick={() => task(() => finishReceipt(r.id))}>첨부 완료 재시도</button>}{editable && <button disabled={pending} className="secondary" onClick={() => task(() => removeReceipt(r.id))}>{r.state === 'removing' ? '삭제 재시도' : '삭제'}</button>}</div></li>)}</ul>
    {!shown.length && <p className="small">첨부된 영수증이 없습니다.</p>}
    {editable && <label>영수증 파일 추가<input type="file" multiple accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf" disabled={pending || shown.length >= maxReceipts} onChange={e => {
      const files = Array.from(e.currentTarget.files??[]);e.currentTarget.value='';if(!files.length)return;
      task(async()=>{
        if(shown.length+files.length>maxReceipts)return {error:`최대 ${maxReceipts}개까지 첨부할 수 있습니다. 현재 ${shown.length}개입니다.`};
        try{for(const file of files)validateReceipt(file.name,file.type,file.size);}catch(err){return {error:(err as Error).message};}
        let completed=0;
        for(const file of files){
          const prepared=await prepareReceipt(expenseId,file.name,file.type,file.size);
          if(prepared.error||!prepared.path||!prepared.id)return {error:`${completed}개 완료. ${file.name}: ${prepared.error||'첨부 준비 실패'}`};
          const {error}=await browserSupabase().storage.from(receiptBucket).upload(prepared.path,file,{upsert:false,contentType:file.type,cacheControl:'0'});
          if(error)return {error:`${completed}개 완료. ${file.name}: 업로드 실패. 미완료 첨부를 삭제하고 다시 올려 주세요.`};
          const finished=await finishReceipt(prepared.id);if(finished.error)return {error:`${completed}개 완료. ${file.name}: ${finished.error}`};completed++;
        }
        return {error:`${completed}개 첨부를 완료했습니다.`};
      });
    }} /></label>}
    {pending && <p role="status">파일 처리 중… 화면을 닫지 마세요.</p>}{message && <p role="status">{message}</p>}
  </div>;
}

export function DecisionForm({id,revision,step}:{id:string;revision:number;step:string}) {
 const [state,action,pending]=useActionState(decideExpense,{error:''});
 const [decision,setDecision]=useState('approved');
 return <form action={action} className="stack"><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={revision}/><input type="hidden" name="step" value={step}/>
 <label>처리<select name="decision" value={decision} onChange={e=>setDecision(e.target.value)}><option value="approved">승인</option><option value="rejected">반려</option></select></label>
 <label>의견 · 반려 사유<textarea name="note" maxLength={1000} required={decision==='rejected'}/></label>
 {state.error&&<p role="alert" className="error">{state.error}</p>}<button disabled={pending}>{pending?'처리 중…':decision==='approved'?'승인 확정':'반려 확정'}</button></form>;
}
export function RevisionForm({id,revision}:{id:string;revision:number}) {
 const [state,action,pending]=useActionState(reviseExpense,{error:''});
 return <form action={action}><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={revision}/><p>원본을 보존한 새 임시저장 신청서를 만듭니다. 영수증을 다시 첨부하고 제출하세요.</p>{state.error&&<p role="alert" className="error">{state.error}</p>}<button disabled={pending}>수정 재신청 작성</button></form>;
}

export function LegacyBankForm({id,revision}:{id:string;revision:number}){
 const [state,action,pending]=useActionState(saveBank,{error:''});
 return <form action={action} className="stack"><p>Day 5 이전에 제출한 신청서입니다. 지급 전에 신청자가 계좌를 한 번 등록해야 합니다. 등록 후에는 변경할 수 없습니다.</p><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={revision}/><BankFields/>{state.error&&<p role="alert" className="error">{state.error}</p>}<button disabled={pending}>누락 계좌 등록</button></form>;
}
