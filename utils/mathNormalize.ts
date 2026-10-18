/** 수식 마크다운 후처리 — 순수. 검증: `npx tsx tests/test-math-normalize.mts` */

/**
 * 줄 맨 앞의 `$$식$$ 문장` → `$$` 블록 + 문장으로 쪼갠다.
 * remark-math 는 줄 첫머리 `$$` 를 **디스플레이 블록 시작**으로 읽어, 같은 줄에서 닫혀도
 * 다음 줄 단독 `$$` 까지(없으면 끝까지) 삼킨다 → KaTeX 파싱 실패로 이후 답변 전체가 빨간 원문이 된다.
 *
 * 펜스 안/밖 상태를 추적하는 줄 스캐너로 판정한다 — 정규식 한 줄로 하면 단독 `$$` 펜스 블록의
 * 닫는 줄을 여는 줄로 오인해 이후 `$$` 짝이 한 칸씩 밀린다(블록 수식을 펜스로 쓰는 모델). 코드 펜스(```)도
 * 건너뛴다 → DEV_261009
 */
export const splitInlineDisplayMath = (text: string): string => {
  const lines = text.split('\n');
  const out: string[] = [];
  let inMathFence = false;
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) { inCodeFence = !inCodeFence; out.push(line); continue; }
    if (inCodeFence) { out.push(line); continue; }
    // 단독 `$$` 줄 = 펜스 여닫기. 안쪽은 건드리지 않는다.
    if (trimmed === '$$') { inMathFence = !inMathFence; out.push(line); continue; }
    // 펜스 안에서 `$$ 문장` — 닫는 펜스 뒤에 문장이 붙은 꼴. 펜스를 닫고 문장을 떼어 낸다.
    if (inMathFence && trimmed.startsWith('$$')) { inMathFence = false; out.push('$$', '', trimmed.slice(2).trim()); continue; }
    if (inMathFence || !trimmed.startsWith('$$')) { out.push(line); continue; }

    // 줄 첫머리 `$$식…` — 닫는 `$$` 를 같은 문단 안에서 찾는다(빈 줄을 넘지 않는다).
    let buf = trimmed.slice(2);
    let j = i;
    let close = buf.indexOf('$$');
    while (close < 0 && j + 1 < lines.length && lines[j + 1].trim() !== '' && lines[j + 1].trim() !== '$$') {
      j++;
      buf += '\n' + lines[j];
      close = buf.indexOf('$$');
    }
    if (close < 0) { out.push(line); continue; }        // 못 닫음(스트리밍 중 등) — 그대로 둔다

    const expr = buf.slice(0, close).trim();
    const rest = buf.slice(close + 2);
    const restFirstLine = rest.split('\n')[0];
    if (!expr || !restFirstLine.trim()) {                 // `$$식$$` 단독 — remark-math 가 이미 잘 읽는다
      out.push(...lines.slice(i, j + 1));
      i = j;
      continue;
    }
    out.push('$$', expr, '$$', '', rest.trim());
    i = j;
  }
  return out.join('\n');
};
