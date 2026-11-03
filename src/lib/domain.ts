export const roles = ['admin', 'applicant', 'team_leader', 'department_head', 'vision_member', 'payment_officer', 'auditor'] as const;
export type Role = typeof roles[number];
export const roleLabels: Record<Role, string> = { admin: '관리자', applicant: '신청자', team_leader: '팀장', department_head: '부서장', vision_member: '비전위원', payment_officer: '지급 담당자', auditor: '조회 담당자' };
export type Step = { label: string; role: Role; kind: 'approval' | 'payment' };
export const defaultSteps: Step[] = [
  {label:'팀장',role:'team_leader',kind:'approval'},
  {label:'부서장',role:'department_head',kind:'approval'},
  {label:'비전위원',role:'vision_member',kind:'approval'},
  {label:'지급 담당자',role:'payment_officer',kind:'payment'},
];
export function validateSteps(value: unknown): Step[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) throw new Error('결재 단계는 2~12개로 설정해 주세요.');
  const steps = value.map((item): Step => {
    if (!item || typeof item !== 'object') throw new Error('올바르지 않은 결재 단계입니다.');
    const {label, role, kind} = item;
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 50) throw new Error('단계 이름은 1~50자로 입력해 주세요.');
    if (!['team_leader','department_head','vision_member','payment_officer'].includes(role)) throw new Error('승인 역할을 확인해 주세요.');
    if (!['approval','payment'].includes(kind)) throw new Error('처리 유형을 확인해 주세요.');
    if ((kind === 'payment') !== (role === 'payment_officer')) throw new Error('지급 단계는 지급 담당자 역할이어야 합니다.');
    return {label:label.trim(),role,kind};
  });
  if (steps.at(-1)?.kind !== 'payment' || steps.filter(s=>s.kind==='payment').length !== 1) throw new Error('마지막에 지급 단계가 하나 있어야 합니다.');
  if(new Set(steps.map(s=>s.label)).size !== steps.length) throw new Error('단계 이름은 서로 다르게 입력해 주세요.');
  return steps;
}
export function canManage(role: string) { return role === 'admin'; }
export function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && !/[\r\n]/.test(value) ? value : '/dashboard';
}
