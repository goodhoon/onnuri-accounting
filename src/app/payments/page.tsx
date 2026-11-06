import Shell from '@/components/shell';
import {requireMember} from '@/lib/session';
import {money} from '@/lib/budget';
import PaymentEditor from './editor';
import Link from 'next/link';
import {expenseNumber} from '@/lib/expenses';
import type { PaymentExpenseLabel } from './labels';
export default async function Payments({searchParams}:{searchParams:Promise<{expense?:string}>}){
 const s=await requireMember(),q=await searchParams;
 const [{data:rows,error},{data:history,error:historyError}]=await Promise.all([s.db.rpc('payable_expenses'),s.db.from('expense_payments').select('*').order('created_at',{ascending:false}).limit(100)]);
 if(error||historyError)throw new Error('지급 관리 조회 실패. Day 5 SQL 적용 여부를 확인하세요.');
 const ids = [...new Set([...(rows??[]).map((row:{id:string})=>row.id),...(history??[]).map(row=>row.expense_id)])];
 const labels = ids.length ? await s.db.rpc('payment_expense_labels',{p_ids:ids}) : {data:[],error:null};
 if(labels.error)throw new Error('지급 건의 조직·계정·행사 조회 실패. Day 6 SQL 적용 여부를 확인하세요.');
 const byId = new Map<string,PaymentExpenseLabel>((labels.data??[]).map((row:PaymentExpenseLabel)=>[row.id,row]));
 const payableRows = (rows??[]).map((row:{id:string})=>({...row,classification:byId.get(row.id)}));
 const now=new Date();const parts=new Intl.DateTimeFormat('en-NZ',{timeZone:'Pacific/Auckland',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const part=(name:string)=>parts.find(p=>p.type===name)?.value;const today=`${part('year')}-${part('month')}-${part('day')}`;
 return <Shell name={s.profile.display_name} admin={s.isAdmin}><header><h1>지급 관리</h1><p>실제 송금·현금 지급 결과를 기록합니다. 한 건 또는 여러 건을 선택해 처리할 수 있습니다.</p></header><PaymentEditor rows={payableRows} today={today} batch={crypto.randomUUID()} selectedId={q.expense}/><section className="panel"><h2>조회 권한 내 최근 지급 기록 · 최대 100건</h2><div className="table-wrap"><table><thead><tr><th>지급일</th><th>신청서</th><th>조직 · 계정 · 행사</th><th>금액 (NZD)</th><th>방법</th><th>은행 참조번호</th><th>앱 묶음 ID</th></tr></thead><tbody>{history?.map(p=>{const label=byId.get(p.expense_id);return <tr key={p.expense_id}><td>{p.paid_on}</td><td><Link href={`/expenses/${p.expense_id}`}>{label ? `${expenseNumber(label.request_no)} · ${label.title}` : '신청서 보기'}</Link></td><td>{label ? <>{label.organization}<br/>{label.account}<br/>{label.event}</> : '—'}</td><td>{money(p.amount)}</td><td>{p.method==='bank_transfer'?'계좌이체':p.method==='cash'?'현금':'기타'}</td><td>{p.bank_reference||'미입력'}</td><td>{p.batch_id}</td></tr>})}</tbody></table></div></section></Shell>;
}
