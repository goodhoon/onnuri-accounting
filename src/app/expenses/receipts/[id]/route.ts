import { requireMember } from '@/lib/session';
import { receiptBucket } from '@/lib/expenses';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireMember(), { id } = await params;
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const { data: r } = await s.db.from('expense_receipts').select('object_path,original_name').eq('id', id).eq('state', 'ready').maybeSingle();
  if (!r) return new Response('파일을 찾을 수 없습니다.', { status: 404, headers });
  // Download directly from Storage; the file body never crosses Vercel's response limit.
  const { data, error } = await s.db.storage.from(receiptBucket).createSignedUrl(r.object_path, 60, { download: r.original_name });
  if (error || !data) return new Response('파일을 불러오지 못했습니다.', { status: 404, headers });
  return new Response(null, { status: 303, headers: { ...headers, Location: data.signedUrl } });
}
