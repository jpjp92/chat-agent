'use client';

import React, { useEffect, useRef, useState } from 'react';
import WaitingIndicator from '../../../components/WaitingIndicator';
import { SLOW_TURN_MS } from '../../../src/lib/loading-status';

// useChatStream 의 대기 문구 규칙을 그대로 흉내 낸다:
//  · 첨부·URL 등 클라이언트가 아는 문구가 있으면 즉시 표시
//  · 없으면 오브만 → threshold 안에 첫 조각·서버 알림이 없으면 "답변을 준비 중입니다"
//  · 서버 알림(searching·lookup)은 타이머를 취소하고 문구를 바꾼다
//  · 첫 조각이 오면 대기 표시를 내리고 답변이 시작된다
type Ev = { at: number; kind: 'searching' | 'lookup' | 'chunk' };
type Scenario = { id: string; label: string; initial?: string; events: Ev[] };

const SCENARIOS: Scenario[] = [
    { id: 'fast', label: '일반 · 빠름 (1.2s)', events: [{ at: 1200, kind: 'chunk' }] },
    { id: 'mid', label: '일반 · 보통 (2.8s)', events: [{ at: 2800, kind: 'chunk' }] },
    { id: 'slow', label: '일반 · 느림 (6s)', events: [{ at: 6000, kind: 'chunk' }] },
    { id: 'vslow', label: '일반 · 매우 느림 (12s)', events: [{ at: 12000, kind: 'chunk' }] },
    { id: 'search', label: '웹 검색 (알림 1.5s → 답 7s)', events: [{ at: 1500, kind: 'searching' }, { at: 7000, kind: 'chunk' }] },
    { id: 'search-late', label: '웹 검색 · 알림 늦음 (4s → 9s)', events: [{ at: 4000, kind: 'searching' }, { at: 9000, kind: 'chunk' }] },
    { id: 'lookup', label: '카드 조회 (0.8s → 3s)', events: [{ at: 800, kind: 'lookup' }, { at: 3000, kind: 'chunk' }] },
    { id: 'doc', label: '문서 첨부 (5s)', initial: 'PDF 문서를 분석 중입니다', events: [{ at: 5000, kind: 'chunk' }] },
];

const TEXT = { preparing: '답변을 준비 중입니다', searching: '웹을 검색 중입니다', lookup: '정보를 조회 중입니다' };

export default function LoadingPreview() {
    const [threshold, setThreshold] = useState(SLOW_TURN_MS);
    const [running, setRunning] = useState<Scenario | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [answered, setAnswered] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [log, setLog] = useState<string[]>([]);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const tick = useRef<ReturnType<typeof setInterval> | null>(null);

    const clearAll = () => {
        timers.current.forEach(clearTimeout); timers.current = [];
        if (tick.current) clearInterval(tick.current);
    };
    useEffect(() => clearAll, []);

    const run = (sc: Scenario) => {
        clearAll();
        const t0 = performance.now();
        const stamp = (m: string) => setLog(l => [...l, `${((performance.now() - t0) / 1000).toFixed(1)}s  ${m}`]);
        setRunning(sc); setAnswered(false); setLog([]); setElapsed(0);
        setStatus(sc.initial ?? null);
        stamp(sc.initial ? `시작 — 문구 "${sc.initial}"` : '시작 — 오브만');
        tick.current = setInterval(() => setElapsed(performance.now() - t0), 100);

        let gotChunk = false;
        let slow: ReturnType<typeof setTimeout> | undefined;
        if (!sc.initial) {
            slow = setTimeout(() => { if (!gotChunk) { setStatus(TEXT.preparing); stamp(`지연 문구 "${TEXT.preparing}"`); } }, threshold);
            timers.current.push(slow);
        }
        for (const ev of sc.events) {
            timers.current.push(setTimeout(() => {
                if (slow) { clearTimeout(slow); slow = undefined; }
                if (ev.kind === 'chunk') {
                    gotChunk = true; setStatus(null); setAnswered(true); stamp('첫 응답 조각 — 대기 표시 내림');
                    if (tick.current) clearInterval(tick.current);
                } else {
                    const text = ev.kind === 'searching' ? TEXT.searching : TEXT.lookup;
                    setStatus(text); stamp(`서버 알림 "${text}"`);
                }
            }, ev.at));
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#0b1020] text-slate-800 dark:text-slate-200 p-4 sm:p-8">
            <div className="max-w-3xl mx-auto space-y-6">
                <header>
                    <h1 className="text-xl font-semibold">대기 표시 미리보기</h1>
                    <p className="text-sm text-slate-500 mt-1">dev 전용. 실제 채팅과 같은 컴포넌트(WaitingIndicator)와 같은 규칙으로 시나리오를 재생한다.</p>
                </header>

                <section className="flex flex-wrap items-center gap-3 text-sm">
                    <label htmlFor="th">지연 문구 기준</label>
                    <input id="th" type="range" min={1000} max={6000} step={500} value={threshold}
                        onChange={e => setThreshold(Number(e.target.value))} />
                    <span className="tabular-nums w-14">{(threshold / 1000).toFixed(1)}s</span>
                    <span className="text-slate-500">(코드 기본값 {(SLOW_TURN_MS / 1000).toFixed(1)}s)</span>
                </section>

                <section className="flex flex-wrap gap-2">
                    {SCENARIOS.map(sc => (
                        <button key={sc.id} onClick={() => run(sc)}
                            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${running?.id === sc.id ? 'bg-indigo-500 text-white border-indigo-500' : 'border-slate-300 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-white/5'}`}>
                            {sc.label}
                        </button>
                    ))}
                </section>

                <section className="rounded-2xl border border-slate-200 dark:border-white/10 p-4 min-h-[180px]">
                    {running ? (
                        <>
                            <div className="flex justify-end">
                                <div className="px-4 py-2.5 rounded-3xl bg-indigo-100 dark:bg-indigo-500/20 text-sm">질문 — {running.label}</div>
                            </div>
                            {!answered ? <WaitingIndicator status={status} /> : (
                                <div className="flex items-start gap-4 mt-4 pl-1">
                                    <div className="flex-shrink-0 mt-1 w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 via-primary-500 to-violet-500 flex items-center justify-center">
                                        <i className="fa-solid fa-sparkles text-white text-[10px]"></i>
                                    </div>
                                    <p className="text-sm leading-7 pt-1.5">답변이 여기서 스트리밍되기 시작합니다…</p>
                                </div>
                            )}
                        </>
                    ) : <p className="text-sm text-slate-500">위에서 시나리오를 고르세요.</p>}
                </section>

                <section className="text-xs font-mono text-slate-500 space-y-0.5">
                    <div>경과 {(elapsed / 1000).toFixed(1)}s</div>
                    {log.map((l, i) => <div key={i}>{l}</div>)}
                </section>
            </div>
        </div>
    );
}
