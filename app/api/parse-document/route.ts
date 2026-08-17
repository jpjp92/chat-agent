import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient, userIdFromToken, unauthorized } from '../../../lib/supabase/route';

/**
 * HWP 계열 문서 파싱 API — kordoc으로 구조 보존 마크다운(표 포함) 추출.
 *   POST (multipart/form-data, field "file")  ← 직행, raw ≤ 4MB (download hop 없음, 55~62% 빠름)
 *   POST { filePath }                          ← Storage 경유, raw > 4MB (Vercel 4.5MB 본문 한도 우회)
 *
 * 스코프: .hwp/.hwpx/.hwp3/.hwpml만. PDF는 native 멀티모달 유지(회귀 방지), docx/xlsx는 현행.
 * kordoc은 zlib·cfb 등 Node 내장 모듈을 쓰므로 nodejs 런타임 필수.
 * 한국 Supabase Storage와의 download leg 지연 방지를 위해 서울 리전 고정(chat/showtimes와 동일).
 *
 * 설계: docs/plans/PLAN_KORDOC_INTEGRATION_260620.md §3 (4MB 임계값 라우팅).
 */
export const runtime = 'nodejs';
export const preferredRegion = 'icn1';
export const maxDuration = 60;

// HWP 계열 4종만 — PDF(native)/docx(mammoth)/xlsx(현행)는 제외
const SUPPORTED = ['.hwp', '.hwpx', '.hwp3', '.hwpml'];
const STORAGE_BUCKET = 'chat-docs';
// filePath는 create-signed-url이 만든 형식(`${timestamp}_${safeBaseName}.ext`)만 허용.
// 단일 세그먼트(슬래시·`..` 금지)로 한정해 경로 traversal/타 객체 접근을 차단(IDOR 완화).
// 무인증 앱이라 소유권 검증은 불가 → 최소한 네임스페이스 형태로 blast radius 제한.
// 🔴 2026-08-17: uid 세그먼트를 요구하도록 바꿨다. 예전 형식(`${timestamp}_...`)은 무인증
// 시절의 것이고, 이제 업로드가 `${uid}/${timestamp}_...` 를 만든다. 소유권은 아래 RLS 가 강제하고
// 이 정규식은 형태만 본다(`..`·중첩 슬래시 차단).
const STORAGE_PATH_RE = /^[0-9a-f-]{36}\/\d+_[a-z0-9._-]+\.(hwp|hwpx|hwp3|hwpml)$/i;
// 마크다운 길이 상한(L4) — NIA 159K자(≈5만 토큰) 사례. /api/chat 주입 전 트렁케이트로
// LLM TTFT·생성 지연 + 토큰 비용 절감. 대다수 문서(중기부 35K 등)는 영향 없음.
const MARKDOWN_MAX = 100_000;

const isSupported = (name: string) => {
  const lower = (name || '').toLowerCase();
  return SUPPORTED.some((ext) => lower.endsWith(ext));
};

async function parseBuffer(buffer: Buffer) {
  // 동적 import — kordoc 미설치 환경에서 빌드가 깨지지 않도록
  const { parse } = await import('kordoc');
  // kordoc은 Buffer를 직접 수용. Buffer는 풀링된 ArrayBuffer의 뷰일 수 있으므로
  // .buffer 슬라이스 대신 Buffer 자체를 전달(잘못된 오프셋 방지).
  return parse(buffer);
}

function buildResponse(result: Awaited<ReturnType<typeof parseBuffer>>) {
  if (!result.success) {
    return NextResponse.json(
      { error: result.error || 'Parse failed', code: result.code },
      { status: 422 },
    );
  }
  // 길이 상한(L4) — 한도 초과 시 트렁케이트 + 안내 문구
  let markdown = result.markdown ?? '';
  let truncated = false;
  if (markdown.length > MARKDOWN_MAX) {
    markdown = markdown.slice(0, MARKDOWN_MAX) +
      `\n\n[...문서가 길어 약 ${MARKDOWN_MAX.toLocaleString()}자에서 잘렸습니다. 이후 내용은 포함되지 않았습니다.]`;
    truncated = true;
  }

  // 페이로드 최소화(L5) — blocks[] 원본은 반환하지 않음
  return NextResponse.json({
    markdown,
    truncated,
    fileType: result.fileType,
    blockCount: result.blocks?.length ?? 0,
    tableCount: result.blocks?.filter((b) => b.type === 'table').length ?? 0,
    metadata: result.metadata ?? null,
  });
}

export async function POST(req: NextRequest) {
  try {
    // 🔴 2026-08-17 이전 무인증이었다. 두 경로 모두 인증을 요구한다 —
    //    ⓐ 직행도 파싱 연산을 소비하므로 열어둘 이유가 없다.
    const db = createRouteClient(req);
    const uid = userIdFromToken(req);
    if (!db || !uid) return unauthorized();

    const contentType = req.headers.get('content-type') || '';

    // ── ⓐ 직행: multipart/form-data raw 바이너리 (raw ≤ 4MB) ──
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') {
        return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
      }
      const fileName = (file as File).name || '';
      if (!isSupported(fileName)) {
        return NextResponse.json({ error: `Unsupported format: ${fileName}` }, { status: 415 });
      }
      const buffer = Buffer.from(await (file as File).arrayBuffer());
      const result = await parseBuffer(buffer);
      return buildResponse(result);
    }

    // ── ⓑ Storage 경유: { filePath } (raw > 4MB) ──
    const { filePath } = await req.json();
    if (!filePath || typeof filePath !== 'string') {
      return NextResponse.json({ error: 'Missing filePath' }, { status: 400 });
    }
    // 경로 형식 엄격 검증 — traversal(`..`/슬래시)·타 객체 접근 차단(IDOR 완화)
    if (!STORAGE_PATH_RE.test(filePath)) {
      return NextResponse.json({ error: 'Invalid filePath' }, { status: 400 });
    }
    const { data, error } = await db.storage.from(STORAGE_BUCKET).download(filePath);
    if (error || !data) {
      return NextResponse.json(
        { error: `Storage download failed: ${error?.message || 'no data'}` },
        { status: 502 },
      );
    }

    // ⚠️ 보안: 라우트에서 service-role `remove()`를 호출하지 않는다.
    // 무인증 앱이라 caller가 filePath의 소유자인지 검증할 수 없어, 정리용 delete가
    // 임의 파일 삭제(IDOR/파괴) 벡터가 됨. 고아 파일 정리는 chat-docs 버킷 TTL/
    // 스케줄 정리로 위임(계획서 P3 백로그). 근본 해결은 앱 전역 인증 + 유저별 prefix.
    const buffer = Buffer.from(await data.arrayBuffer());
    const result = await parseBuffer(buffer);
    return buildResponse(result);
  } catch (err: any) {
    console.error('[parse-document] failed:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
