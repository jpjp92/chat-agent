/**
 * 업로드 파일명 → Storage 키 정규화. **순수 함수**(server-only 의존 없음 — 하니스가 임포트한다).
 *
 * 🔴 왜 필요했나: 한글 한 글자가 대시 하나가 되면서 이름이 통째로 뭉개졌다(실측 2026-08-17):
 *   `2024년 AI바우처 지원사업.hwp` → `-2024--ai---------.hwp`
 *   `멀티에이전트 시스템 설계.pdf` → `multiagent-----------------.pdf`
 * Storage 콘솔에서 **파일이 뭔지 알아볼 수 없어** 고아 파일 정리·장애 조사가 어렵다.
 * 삭제한 `/api/upload` 에 있던 대시 축약 로직을 가져왔다.
 *
 * ⚠️ 보안상 의미는 없다 — 경로 격리는 `${uid}/` prefix + Storage RLS 가 한다.
 *    여기서 하는 일은 **가독성**과 키에 들어가면 곤란한 문자 제거뿐이다.
 *
 * ⚠️ 확장자는 보존해야 한다 — `parse-document` 의 `STORAGE_PATH_RE` 가 `.hwp|.hwpx|…` 를 요구한다.
 *
 * 검증: `npx tsx scripts/test-storage-name.mts`
 */
export function safeStorageName(fileName: string): string {
    const dot = fileName.lastIndexOf(".");
    // `.gitignore` 처럼 점으로 시작하는 이름은 확장자가 아니라 본문이다 → dot > 0 조건.
    const rawBase = dot > 0 ? fileName.slice(0, dot) : fileName;
    const rawExt = dot > 0 ? fileName.slice(dot + 1) : "";

    const clean = (s: string) =>
        s.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();

    // 전부 한글이면 base 가 빈 문자열이 된다 → 키가 `123_.hwp` 가 되어 읽기 더 나빠진다.
    const base = clean(rawBase) || "file";
    const ext = clean(rawExt);
    return ext ? `${base}.${ext}` : base;
}
