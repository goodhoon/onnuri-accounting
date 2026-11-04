import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/shell';
import { requireMember } from '@/lib/session';
import { money } from '@/lib/budget';
import { expenseNumber, expenseStates } from '@/lib/expenses';
import { DecisionForm, RevisionForm, ExpenseForm, SubmitForm, EndForm, Receipts, type ApproverChoice, type ReceiptRow } from '../forms';
import { expenseOptions } from '../data';
const actions: Record<string, string> = { step_approved:'단계 승인', step_rejected:'반려', revision_created:'수정 재신청 작성', created: '신청서 작성', updated: '신청 내용 수정', receipt_added: '영수증 첨부', receipt_removed: '영수증 삭제', submitted: '신청서 제출', withdrawn: '제출 철회', cancelled: '작성 취소' };
export default async function ExpenseDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; submitted?: string }> }) {
  const s = await requireMember(), { id } = await params, q = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: e, error } = await s.db.from('expense_requests').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('신청서 조회 실패'); if (!e) notFound();
  const [{ data: b }, rr, sr, hr] = await Promise.all([
    s.db.from('budget_lines').select('*,fiscal_years(name),org_units(code,name),accounts(code,name),events(name)').eq('id', e.budget_line_id).single(),
    s.db.from('expense_receipts').select('id,original_name,mime_type,byte_size,state').eq('expense_id', id).order('created_at'),
    s.db.from('expense_steps').select('*').eq('expense_id', id).order('position'),
    s.db.from('expense_history').select('*').eq('expense_id', id).order('created_at', { ascending: false }).limit(100),
  ]);
  if (rr.error || sr.error || hr.error) throw new Error('첨부 또는 이력 조회 실패');
  const receipts = (rr.data ?? []) as ReceiptRow[], own = e.requester_id === s.user.id, editable = own && e.status === 'draft';
  let choices: ApproverChoice[] = [];
  if (editable) { const r = await s.db.rpc('expense_approver_choices', { p_id: id }); if (r.error) throw new Error('결재 담당자 조회 실패'); choices = r.data ?? []; }
  const budgets = editable ? await expenseOptions(s) : [];
  const { data: balances } = await s.db.rpc('expense_budget_status', { p_budget: e.budget_line_id });
  const balance = balances?.[0];
  const {data:canDecide,error:decisionError}=await s.db.rpc('expense_can_decide',{p_id:id});
  if(decisionError) throw new Error('승인 권한 조회 실패');
  const current=sr.data?.find(step=>step.decision==='pending');
  const decisions:Record<string,string>={waiting:'순서 대기',pending:'현재 처리 대기',approved:'승인',rejected:'반려',skipped:'진행 중단'};
  return <Shell name={s.profile.display_name} admin={s.isAdmin}>
    <header><div className="eyebrow">{expenseNumber(e.request_no)}</div><h1>{e.title}</h1><span className="badge">{expenseStates[e.status]}</span><p><Link href="/expenses">신청 목록으로 →</Link></p></header>
    {q.saved && <p className="notice" role="status">임시저장했습니다. 아래에서 영수증을 첨부하고 결재 담당자를 선택하세요.</p>}
    {q.submitted && <p className="notice" role="status">제출했습니다. 신청액을 예산에서 예약하고 결재선·담당자를 기록했습니다. 현재 차례의 승인자에게 앱 내 알림을 보냈습니다.</p>}
    <section className="panel"><h2>연결된 예산</h2><p>{b?.fiscal_years?.name} / {b?.org_units?.code} {b?.org_units?.name} / {b?.accounts?.code} {b?.accounts?.name} / {b?.events?.name ?? '일반 운영'}</p>{balance && <div className="balance-grid"><div><span>배정 예산</span><b>{money(balance.allocated)}</b></div><div><span>제출 신청 예약액</span><b>{money(balance.reserved)}</b></div><div><span>미예약 예산</span><b>{money(balance.unreserved)}</b></div></div>}<p className="small">단위 NZD. 예약은 지출·지급 완료를 의미하지 않습니다. 임시저장은 예산을 예약하지 않습니다.</p></section>
    <section className="panel"><h2>신청 내용</h2>{editable ? <ExpenseForm id={id} draft={e} budgets={budgets} /> : <dl className="expense-detail"><dt>지출일</dt><dd>{e.spent_on}</dd><dt>신청 금액</dt><dd>{money(e.amount)} NZD</dd><dt>지급 대상</dt><dd>{e.payee_name}</dd><dt>지출 목적 · 상세 내용</dt><dd className="preserve-lines">{e.description}</dd></dl>}</section>
    <section className="panel"><h2>영수증 첨부</h2><Receipts expenseId={id} receipts={receipts} editable={editable} /></section>
    {editable ? <section className="panel"><h2>결재 담당자 확인 · 제출</h2><SubmitForm expense={e} choices={choices} canSubmit={receipts.some(r => r.state === 'ready') && !receipts.some(r => ['pending', 'removing'].includes(r.state))} /></section> : (sr.data?.length ? <section className="panel"><h2>제출 당시 결재선 · 담당자</h2><ol className="snapshot-list">{sr.data.map(step => <li key={step.id}><b>{step.label}</b><span className="small">담당자: {step.assignee_name} · {decisions[step.decision] ?? step.decision}{step.decided_at && ` · ${new Date(step.decided_at).toLocaleString('ko-KR', {timeZone:'Pacific/Auckland'})}`}{step.decision_note && ` · ${step.decision_note}`}</span></li>)}</ol></section> : null)}
    {canDecide && current && <section className="panel"><h2>{current.label} · 결재 처리</h2><DecisionForm id={id} revision={e.revision} step={current.id}/></section>}
    {e.status==='approved' && <p className="notice">승인이 완료되어 지급 대기 중입니다. 실제 지급 처리는 다음 개발 범위입니다.</p>}
    {own && e.status==='rejected' && <section className="panel"><h2>수정 재신청</h2><RevisionForm id={id} revision={e.revision}/></section>}
    {e.resubmission_of && <p><Link href={`/expenses/${e.resubmission_of}`}>반려 원본 보기 →</Link></p>}
    {own && (e.status==='draft' || (e.status==='submitted' && !sr.data?.some(step=>step.decision==='approved'))) && <details className="panel"><summary>{e.status === 'submitted' ? '제출 철회' : '작성 취소'}</summary><EndForm id={id} revision={e.revision} submitted={e.status === 'submitted'} /></details>}
    {e.ended_reason && <section className="notice"><b>{expenseStates[e.status]} 사유</b><p>{e.ended_reason}</p></section>}
    <section className="panel"><h2>처리 이력</h2>{hr.data?.map(h => <div className="history-row" key={h.id}><b>{actions[h.action] ?? h.action}</b><span>{h.note}</span><time className="small">{new Date(h.created_at).toLocaleString('ko-KR', { timeZone: 'Pacific/Auckland' })} (NZ)</time></div>)}</section>
  </Shell>;
}
