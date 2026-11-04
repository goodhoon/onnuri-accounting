export const receiptBucket = 'expense-receipts';
export const maxReceiptBytes = 5 * 1024 * 1024;
export const maxReceipts = 10;
export const expenseStates: Record<string, string> = {
  draft: '임시저장', submitted: '제출 · 결재 대기', withdrawn: '제출 철회', cancelled: '작성 취소',
};
export function expenseNumber(n: number | string) { return `E${String(n).padStart(6, '0')}`; }
export function receiptExtension(type: string) {
  const ext: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
  if (!ext[type]) throw new Error('영수증은 JPG, PNG, PDF만 첨부할 수 있습니다.');
  return ext[type];
}
export function validateReceipt(name: string, type: string, size: number) {
  const ext = receiptExtension(type);
  if (!name.trim() || name.length > 200 || /[\x00-\x1f\x7f/\\]/.test(name)) throw new Error('파일 이름이 올바르지 않습니다.');
  if (!Number.isInteger(size) || size <= 0 || size > maxReceiptBytes) throw new Error('파일은 0바이트 초과, 5MB 이하로 첨부해 주세요.');
  return ext;
}
export function hasReceiptSignature(data: Uint8Array, type: string) {
  if (type === 'application/pdf') return new TextDecoder().decode(data.slice(0, 5)) === '%PDF-';
  if (type === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (type === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => data[i] === v);
  return false;
}
export function expenseError(message: string) {
  const rules: Record<string, string> = {
    'version conflict': '다른 변경이 먼저 저장됐습니다. 새로고침 후 다시 시도해 주세요.',
    'forbidden': '신청자 권한 또는 본인 신청서인지 확인해 주세요.',
    'draft required': '임시저장 상태에서만 수정하거나 첨부할 수 있습니다.',
    'closed': '마감된 회계연도에는 저장하거나 제출할 수 없습니다.',
    'inactive': '사용 중지된 조직·계정·행사는 사용할 수 없습니다.',
    'expense date': '지출일을 선택한 회계연도와 행사 기간 안으로 입력해 주세요.',
    'invalid money': '신청 금액은 0보다 큰 숫자로 소수 둘째 자리까지 입력해 주세요.',
    'insufficient allocation': '신청 금액이 미예약 예산을 초과합니다. 관리자에게 예산을 확인해 주세요.',
    'receipt required': '제출하려면 업로드가 완료된 영수증이 한 개 이상 필요합니다.',
    'receipt unfinished': '완료되지 않은 첨부가 있습니다. 업로드를 완료하거나 해당 첨부를 삭제해 주세요.',
    'receipt limit': '영수증은 신청서당 최대 10개까지 첨부할 수 있습니다.',
    'receipt missing': '파일이 아직 업로드되지 않았거나 크기·형식이 맞지 않습니다.',
    'workflow changed': '결재선 설정이 변경됐습니다. 새로고침 후 담당자를 다시 선택해 주세요.',
    'assignee': '각 결재 단계에 해당 조직의 역할을 가진 담당자를 선택해 주세요. 본인을 지정할 수 없습니다.',
    'submitted required': '제출된 신청서만 철회할 수 있습니다.',
    'reserved budget': '제출된 신청서의 예약액보다 예산을 줄일 수 없습니다.',
    'not found': '신청서나 예산 항목을 찾을 수 없습니다.',
  };
  return Object.entries(rules).find(([key]) => message.includes(key))?.[1] ?? '저장하지 못했습니다. 입력 내용과 권한을 확인해 주세요.';
}
