import Link from 'next/link';
import Shell from '@/components/shell';
import { requireMember } from '@/lib/session';
import { ExpenseForm } from '../forms';
import { expenseOptions } from '../data';
export default async function NewExpense() {
  const s = await requireMember(), budgets = await expenseOptions(s);
  return <Shell name={s.profile.display_name} admin={s.isAdmin}><header><div className="eyebrow">NEW REQUEST</div><h1>지출결의서 작성</h1><p>먼저 내용을 임시저장한 뒤 영수증을 첨부하세요.</p><Link href="/expenses">신청 목록으로 →</Link></header><section className="panel"><h2>신청 내용</h2><ExpenseForm id={crypto.randomUUID()} budgets={budgets} /></section></Shell>;
}
