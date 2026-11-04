import { requireMember } from '@/lib/session';
import { money } from '@/lib/budget';
import type { BudgetOption } from './forms';
export async function expenseOptions(s: Awaited<ReturnType<typeof requireMember>>) {
  const {data: permitted, error: permissionError} = await s.db.rpc('expense_create_budget_ids');
  if(permissionError) throw new Error('지출 신청 권한 조회 실패');
  const allowed = new Set((permitted ?? []).map((b: {id:string}) => b.id));
  const results = await Promise.all([
    s.db.from('budget_lines').select('*'), s.db.from('fiscal_years').select('*'),
    s.db.from('org_units').select('*'), s.db.from('accounts').select('*'), s.db.from('events').select('*'),
  ]);
  if (results.some(r => r.error)) throw new Error('예산 설정 조회 실패');
  const [budgets, years, units, accounts, events] = results.map(r => r.data ?? []);
  const options: BudgetOption[] = [];
  for (const b of budgets) {
    const y = years.find(y => y.id === b.fiscal_year_id), u = units.find(u => u.id === b.org_unit_id), a = accounts.find(a => a.id === b.account_id), e = events.find(e => e.id === b.event_id);
    if (!y || y.closed || !u?.active || !a?.active || (b.event_id && !e?.active)) continue;
    if (!allowed.has(b.id)) continue;
    options.push({ id: b.id, label: `${y.name} / ${u.code} ${u.name} / ${a.code} ${a.name} / ${e?.name ?? '일반 운영'} · 배정 ${money(b.amount)} NZD`, starts: e && e.starts_on > y.starts_on ? e.starts_on : y.starts_on, ends: e && e.ends_on < y.ends_on ? e.ends_on : y.ends_on });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}
