/**
 * json:diagram — 현행 canvas(DiagramRenderer) vs SVG 시제품(prototypes/DiagramSvg) 비교. 무네트워크·무자격증명·호출 0.
 *
 *   npx tsx tests/manual/compare-diagram-svg.mts [출력.html]
 *
 * ① 정적 검사(SSR): 같은 JSON 을 렌더한 HTML 에 라벨·화살표·조작 요소가 몇 개 나오나.
 *    canvas 는 그림이 JS 실행 뒤에야 생기므로 HTML 에는 아무것도 없다 — 스크린리더·검색·복사도 같은 처지.
 * ② 비교 페이지: 두 렌더러를 나란히 띄우는 HTML 을 만든다(esbuild 번들, 실제 컴포넌트 그대로).
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { spawnSync } from 'node:child_process';
import { DiagramRenderer } from '../../components/DiagramRenderer';
import { DiagramSvg } from './prototypes/DiagramSvg';
import { SAMPLES } from './prototypes/diagram-samples';

const OUT = process.argv[2] ?? 'diagram-compare.html';
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

console.log('── ① 정적 검사(SSR) ──');
console.log('샘플'.padEnd(26) + '| canvas 라벨·화살표·조작 | SVG 라벨·화살표·조작');
for (const s of SAMPLES) {
    const a = renderToStaticMarkup(React.createElement(DiagramRenderer, { data: s.data as never }));
    const b = renderToStaticMarkup(React.createElement(DiagramSvg, { data: s.data as never }));
    const row = (h: string) => `${count(h, /<text/g)}·${count(h, /<polygon/g)}·${count(h, /role="button"|type="range"/g)}`;
    console.log(`${s.name.padEnd(26)}| ${row(a).padEnd(24)}| ${row(b)}${s.note ? `   ← ${s.note}` : ''}`);
}

const entry = path.resolve('tests/manual/prototypes/compare-entry.tsx');
// esbuild 는 직접 의존성이 아니다(tsx·vite 경유) — import 대신 CLI 로 부른다
const res = spawnSync('npx', ['esbuild', entry, '--bundle', '--minify', '--format=iife', '--jsx=automatic',
    '--define:process.env.NODE_ENV="production"', '--log-level=error'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (res.status !== 0) { console.error(res.stderr); process.exit(1); }
const js = res.stdout.replace(/<\/script/gi, '<\\/script');
fs.writeFileSync(OUT, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diagram 렌더러 비교</title><script src="https://cdn.tailwindcss.com/3.4.17"></script>
<script>tailwind.config={darkMode:'class'}</script></head><body><div id="root"></div><script>${js}</script></body></html>`);
console.log(`\n── ② 비교 페이지 ── ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB)`);
