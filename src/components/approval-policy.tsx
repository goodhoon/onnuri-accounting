export default function ApprovalPolicy() {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>신청 금액 (NZD)</th><th>승인 순서</th></tr></thead>
        <tbody>
          <tr><td>$100 이하</td><td>팀장</td></tr>
          <tr><td>$100 초과~$300 이하</td><td>팀장 → 부서장</td></tr>
          <tr><td>$300 초과~$500 이하</td><td>팀장 → 부서장 → 비전위원 1명</td></tr>
          <tr><td>$500 초과</td><td>팀장 → 부서장 → 서로 다른 비전위원 2명</td></tr>
        </tbody>
      </table>
    </div>
  );
}
