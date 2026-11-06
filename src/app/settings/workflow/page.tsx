import Link from 'next/link';
import { notFound } from 'next/navigation';
import ApprovalPolicy from '@/components/approval-policy';
import Shell from '@/components/shell';
import { requireMember } from '@/lib/session';

export default async function Workflow() {
  const s = await requireMember();
  if (!s.isAdmin) notFound();

  return (
    <Shell name={s.profile.display_name} admin>
      <header><h1>결재선 설정</h1><p>새 지출결의서는 저장된 신청 금액에 따라 결재 단계가 정해집니다.</p></header>
      <section className="panel">
        <ApprovalPolicy />
        <p>승인이 끝나면 지급 담당자에게 넘어갑니다.</p>
        <p><Link href="/settings/members">사용자 · 권한</Link>에서 팀장과 부서장의 적용 조직, 비전위원 명단을 관리하세요. 교회 전체 위원은 최상위 교회 조직에 배정할 수 있습니다.</p>
      </section>
    </Shell>
  );
}
