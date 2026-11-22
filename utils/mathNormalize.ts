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

/**
 * 단일 `$…$` 중 LaTeX 명령(`\text` 등)이 든 것만 `$$…$$`(인라인 수식)로 올린다.
 * 단일 `$` 수식은 통화("$0.3 … $0.7")가 수식으로 묶여 꺼 뒀다(DEV_260624 §6). 그 바람에 모델이 쓰는
 * `$-\text{CH}_3$` 같은 인라인 수식이 원문으로 노출된다 — 통화엔 역슬래시 명령이 없으니 이것만 구제한다.
 * 코드 펜스·인라인 코드 안은 건드리지 않는다.
 */
const SINGLE_TEX = /(?<![\\$])\$(?![\s$])([^$\n]*?\\[a-zA-Z]+[^$\n]*?)(?<!\s)\$(?!\$)/g;
export const promoteTexInlineMath = (text: string): string => {
  let inCodeFence = false;
  return text.split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) { inCodeFence = !inCodeFence; return line; }
    if (inCodeFence) return line;
    // 홀수 칸이 인라인 코드 안이다
    return line.split('`').map((seg, k) => k % 2 ? seg : seg.replace(SINGLE_TEX, '$$$$$1$$$$')).join('`');
  }).join('\n');
};

// 원소 기호 — 화학식 판정용. 없는 기호(A·B·X 등)가 섞이면 수학 변수로 본다
const ELEMENTS = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu'.split(' '));
const CHEM_BODY = /^(?:[A-Z][a-z]?(?:_\{?\d+\}?)?)+$/;
const CHEM_TOKEN = /([A-Z][a-z]?)(?:_\{?\d+\}?)?/g;
const CHEM_SIGN = /^[-=+]\s*/;
const isChemFormula = (body: string): boolean => {
  if (!CHEM_BODY.test(body) || !/_\{?\d/.test(body)) return false;
  const syms = [...body.matchAll(CHEM_TOKEN)].map(m => m[1]);
  // 원소 둘 이상 — `V_1`·`P_2` 같은 첨자 변수를 화학식으로 오인하지 않는다
  return syms.length >= 2 && syms.every(s => ELEMENTS.has(s));
};

/**
 * 같은 줄의 `$$화학식$$` 을 `\mathrm{}` 으로 감싼다 — 수식 기본체(기울임)로 그리면 C₈H₁₀N₄O₂ 가
 * 변수 곱처럼 보인다. 화학식 관례는 정체(正體).
 */
export const uprightChemFormulas = (text: string): string => {
  let inCodeFence = false;
  return text.split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) { inCodeFence = !inCodeFence; return line; }
    if (inCodeFence) return line;
    return line.split('`').map((seg, k) => k % 2 ? seg : seg.replace(/\$\$([^$\n]+?)\$\$/g, (m, expr: string) => {
      const t = expr.trim();
      const sign = t.match(CHEM_SIGN)?.[0] ?? '';
      const body = t.slice(sign.length);
      return isChemFormula(body) ? `$$${sign}\\mathrm{${body}}$$` : m;
    })).join('`');
  }).join('\n');
};
