/**
 * 마크다운 답변 → 읽을 텍스트 — 순수 모듈. 서버(라우트)·클라이언트(버튼 사전 판정)·하니스가 같이 쓴다.
 * 그래서 `server/` 가 아니라 `lib/` 에 둔다(`server/` 는 클라이언트가 임포트하지 않는다).
 *
 * 시각화 블록(```json:weather``` 등 렌더러 7종)·코드는 귀로 들을 내용이 아니므로 통째로 뺀다.
 * JSON 을 그대로 보내면 TTS 가 한 글자씩 철자로 읽고, 기호뿐인 조각에는 오디오를 안 돌려줘
 * 스트림이 끊긴다 → DEV_261003
 */

export function toSpeakableText(markdown: string): string {
    let s = markdown;

    // 코드 펜스(시각화 카드 JSON 포함) — 닫히지 않은 펜스는 끝까지 버린다
    s = s.replace(/```[\s\S]*?(```|$)/g, '\n');
    s = s.replace(/~~~[\s\S]*?(~~~|$)/g, '\n');
    // 수식
    s = s.replace(/\$\$[\s\S]*?\$\$/g, ' ').replace(/\\\[[\s\S]*?\\\]/g, ' ').replace(/\$[^$\n]+\$/g, ' ');
    // HTML 태그
    s = s.replace(/<[^>\n]+>/g, ' ');
    // 이미지는 버리고, 링크는 글자만. 링크 글자가 인용 번호([1])뿐이면 버린다
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    // 인용 링크 [[1]](url) — 일반 링크 규칙보다 먼저(안쪽 대괄호 때문에 일반 규칙이 깨진다)
    s = s.replace(/\[\[\^?\d+\]\]\([^)]*\)/g, '');
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, (_, t: string) => (/^\s*\[?\d+\]?\s*$/.test(t) ? '' : t));
    s = s.replace(/\[\^?\d+\]/g, '');
    // 맨 URL
    s = s.replace(/https?:\/\/\S+/g, ' ').replace(/\bwww\.\S+/g, ' ');

    const lines = s.split('\n').flatMap(line => {
        let l = line.trim();
        if (!l) return [];
        // 표: 구분선은 버리고 칸은 쉼표로
        if (/^\|?[\s:|-]+\|[\s:|-]*$/.test(l)) return [];
        if (l.startsWith('|')) l = l.replace(/^\||\|$/g, '').split('|').map(c => c.trim()).filter(Boolean).join(', ');
        // 제목·인용·글머리표
        l = l.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '').replace(/^[-*+•]\s+/, '');
        // 강조·인라인 코드 기호(글자는 남긴다)
        l = l.replace(/(\*\*|__|~~)/g, '').replace(/[*_`]/g, '');
        // 수평선
        if (/^[-=*_]{3,}$/.test(l)) return [];
        l = l.trim();
        if (!l) return [];
        // 기호·숫자만 남은 줄은 읽을 게 없다
        if (!/[\p{L}]/u.test(l)) return [];
        // 줄 끝에 문장부호가 없으면 붙여 분할기가 문장 경계로 쓰게 한다(글머리표 항목들이 한 문장으로 뭉치지 않게)
        if (!/[.?!。…:]$/.test(l)) l = l.replace(/[,，;]$/, '') + '.';
        return [l];
    });

    return lines.join(' ').replace(/\s+/g, ' ').trim();
}
