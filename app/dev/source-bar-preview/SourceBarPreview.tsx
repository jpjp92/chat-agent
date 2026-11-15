'use client';

import { useEffect, useRef, useState } from 'react';
import SourceBar from '../../../components/SourceBar';
import type { GroundingSource, Language } from '../../../types';

// 표본 — 실제 답변에서 나오는 모양만 흉내 낸다(제목 자리에 도메인이 오는 Gemini grounding 링크 포함). 사용자 데이터 아님
const G = (title: string, n?: number): GroundingSource => ({ title, uri: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${encodeURIComponent(title)}`, ...(n ? { citationNumber: n } : {}) });
const D = (title: string, uri: string, n?: number): GroundingSource => ({ title, uri, ...(n ? { citationNumber: n } : {}) });
const TEN = ['kosis.kr', 'bok.or.kr', 'yna.co.kr', 'hankyung.com', 'chosun.com', 'mk.co.kr', 'namu.wiki', 'kostat.go.kr', 'reuters.com', 'medium.com'];

const CASES: { id: string; note: string; sources: GroundingSource[]; showKinds?: boolean }[] = [
    { id: 'one', note: '1개 — 칩', sources: [G('kosis.kr', 1)] },
    { id: 'two', note: '2개 — 칩', sources: [G('yna.co.kr', 1), G('hankyung.com', 2)] },
    { id: 'two-long', note: '2개 — 긴 한국어·영문 제목(칩 제목 150px 자름)', sources: [
        D('2026년 하반기 소비자물가 동향 및 향후 전망에 관한 보고서', 'https://www.example.go.kr/report/2026/cpi-outlook', 1),
        D('Global Semiconductor Supply Chain Outlook for the Second Half of 2026', 'https://www.example-research.com/semiconductor-outlook-2026-h2'),
    ] },
    { id: 'two-kinds', note: '2개 — 출처 성격 태그(차트 답변)', sources: [G('kostat.go.kr', 1), G('yna.co.kr', 2)], showKinds: true },
    { id: 'three', note: '3개 — 접힌 바(접힘 기준)', sources: [G('kosis.kr', 1), G('yna.co.kr', 2), G('namu.wiki')] },
    { id: 'ten', note: '10개 — 접힌 바 · 시트 스크롤', sources: TEN.map((t, i) => G(t, i < 6 ? i + 1 : undefined)) },
    { id: 'ten-kinds', note: '10개 — 성격 태그 + "공식 n"', sources: TEN.map((t, i) => G(t, i < 6 ? i + 1 : undefined)), showKinds: true },
    { id: 'long-domain', note: '3개 — 긴 도메인(시트 줄바꿈)', sources: [
        G('very-long-subdomain-name.statistics.example-government-agency.go.kr', 1), G('another.extremely-long-domain-name-for-testing.co.kr', 2), G('short.kr'),
    ] },
];

type Box = { tag: string; w: number; h: number };
const TOUCH_MIN = 44;


export default function SourceBarPreview() {
    const [dark, setDark] = useState(false);
    const [lang, setLang] = useState<Language>('ko');
    const [boxes, setBoxes] = useState<Record<string, Box[]>>({});
    const [vw, setVw] = useState(0);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const html = document.documentElement;
        const before = html.classList.contains('dark');
        html.classList.toggle('dark', dark);
        return () => { html.classList.toggle('dark', before); };
    }, [dark]);

    // 칩·바의 실제 렌더 크기 — 터치 목표(44px) 미달을 바로 보이게
    useEffect(() => {
        const measure = () => {
            setVw(window.innerWidth);
            const out: Record<string, Box[]> = {};
            root.current?.querySelectorAll<HTMLElement>('[data-case]').forEach(el => {
                out[el.dataset.case!] = [...el.querySelectorAll<HTMLElement>(':scope > a, :scope > button')].map(n => {
                    const r = n.getBoundingClientRect();
                    return { tag: n.tagName === 'A' ? '칩' : '바', w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
                });
            });
            setBoxes(out);
        };
        measure();
        const t = setTimeout(measure, 300); // favicon 로드 뒤
        window.addEventListener('resize', measure);
        return () => { clearTimeout(t); window.removeEventListener('resize', measure); };
    }, [lang, dark]);

    return (
        <div ref={root} className="min-h-screen bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 p-4 sm:p-8">
            <h1 className="text-lg font-bold mb-1">출처 바 미리보기 — 실측용</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                고정 표본으로 칩(1~2개)·접힌 바(3개 이상)·시트를 그린다. 바를 누르면 시트가 열린다. 개발자 도구에서 375·390·430·1280px 로 바꿔 본다. 로그인 없이 열린다(dev 전용).
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-6 text-xs">
                <button type="button" onClick={() => setDark(d => !d)} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-white/20">{dark ? '라이트로' : '다크로'}</button>
                {(['ko', 'en', 'es', 'fr'] as Language[]).map(l => (
                    <button key={l} type="button" onClick={() => setLang(l)} className={`px-3 py-1.5 rounded-lg border ${lang === l ? 'border-primary-500 text-primary-600 dark:text-primary-400' : 'border-slate-300 dark:border-white/20'}`}>{l}</button>
                ))}
                <span className="text-slate-500 dark:text-slate-400">화면 폭 {vw}px</span>
            </div>
            {CASES.map(c => (
                <section key={c.id} className="mb-8">
                    <h2 className="text-sm font-semibold mb-2">{c.note}</h2>
                    {/* ChatMessage 의 출처 줄과 같은 감싸개 */}
                    <div data-case={c.id} className="flex flex-wrap gap-2">
                        <SourceBar sources={c.sources} language={lang} showKinds={c.showKinds} />
                    </div>
                    <div className="mt-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {(boxes[c.id] ?? []).map((b, i) => (
                            <span key={i} className={`mr-3 ${b.h < TOUCH_MIN ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                {b.tag}{i + 1} {b.w}×{b.h}{b.h < TOUCH_MIN ? ` (높이 < ${TOUCH_MIN})` : ''}
                            </span>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
