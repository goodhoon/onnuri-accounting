import Link from 'next/link';
import Shell from '@/components/shell';
import { requireMember } from '@/lib/session';
import { money } from '@/lib/budget';
import { expenseNumber, expenseStates } from '@/lib/expenses';
export default async function Expenses({ searchParams }: { searchParams: Promise<{ scope?: string; status?: string }> }) {
  const s = await requireMember(), q = await searchParams;
  let query = s.db.from('expense_requests').select('id,request_no,title,requester_id,spent_on,amount,status,created_at').order('created_at', { ascending: false }).limit(100);
  if (q.scope !== 'accessible') query = query.eq('requester_id', s.user.id);
  if (q.status && Object.hasOwn(expenseStates, q.status)) query = query.eq('status', q.status);
  const { data, error } = await query;
  return <Shell name={s.profile.display_name} admin={s.isAdmin}>
    <header><div className="eyebrow">EXPENSE REQUESTS</div><h1>지출결의서</h1><p>신청서를 임시저장하고 영수증과 결재 담당자를 확인한 뒤 제출하세요.</p></header>
    <div className="action-bar"><Link className="button-link" href="/expenses/new">새 지출결의서 작성</Link><span className="small">제출은 결재 대기 등록입니다. 승인·지급 버튼은 다음 단계에서 연결합니다.</span></div>
    {error ? <section className="notice"><h2>Day 3 데이터베이스 적용이 필요합니다</h2><p>새 지출 기능을 불러오지 못했습니다. 추가 SQL 적용 여부와 연결 상태를 확인해 주세요.</p></section> : <>
      <section className="panel"><form className="filters"><label>조회 범위<select name="scope" defaultValue={q.scope ?? 'mine'}><option value="mine">내 신청서</option><option value="accessible">권한 내 전체 신청서</option></select></label><label>상태<select name="status" defaultValue={q.status ?? ''}><option value="">전체 상태</option>{Object.entries(expenseStates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button>조회</button></form></section>
      <section className="panel"><h2>신청 내역</h2><div className="table-wrap"><table><thead><tr><th>번호</th><th>제목</th><th>지출일</th><th>금액 (NZD)</th><th>상태</th></tr></thead><tbody>{data?.map(e => <tr key={e.id}><td>{expenseNumber(e.request_no)}</td><td><Link href={`/expenses/${e.id}`}>{e.title}</Link></td><td>{e.spent_on}</td><td>{money(e.amount)}</td><td><span className="badge">{expenseStates[e.status]}</span></td></tr>)}</tbody></table></div>{!data?.length && <p>조회 범위에 신청서가 없습니다.</p>}<p className="small">최신 100건까지 표시합니다. 다른 신청자의 임시저장은 관리자만 조회할 수 있습니다.</p></section>
    </>}
  </Shell>;
}
