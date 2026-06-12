'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CHAINS, flatBranches, branchUrl, type ChainKey, type Branch } from '../lib/theaters';
import { setChainShowtimes } from '../lib/movieContext';

/**
 * 영화 상영시간표 카드 — CGV·롯데시네마·메가박스.
 * movieTool이 준 지역/기본지점(json:movie)을 받아, 체인별로 /api/showtimes를 호출(마운트·지점변경 시)해
 * 스켈레톤 → 카드(칩)로 렌더. 채팅 폭에 맞춘 변형(칩 1열·패널 경량화·영화 더보기) 적용.
 * 스파이크: scripts/test-showtimes-server.mjs (DEV_260608 §9 ~ DEV_260611).
 */

interface Showtime { start: string; end: string; screen: string; screenFull?: string; left: number; total: number }
interface MovieEntry { chain: string; cinema: string; movie: string; date: string; poster: string; rating: string; format: string; showtimes: Showtime[] }
interface Payload { cinema?: string; movies?: number; total?: number; date?: string; list?: MovieEntry[]; ms?: number; cached?: boolean | string; age?: number; error?: string }
interface MovieData { region?: string; defaults?: Partial<Record<ChainKey, Branch>> }

const MOVIE_CAP = 3;   // 체인당 최초 노출 영화 수 (나머지는 더보기)
const CHIP_CAP = 8;    // 영화당 최초 노출 회차 수
const MIN_SKELETON = 320;

const kstYmd = () => {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};

// 조회 중 점 3개 바운스 (정적 "…" 대체)
const LoadingDots: React.FC = () => (
  <span className="inline-flex items-end gap-[3px] ml-1" aria-hidden>
    {[0, 1, 2].map((i) => (
      <span key={i} className="w-[3px] h-[3px] rounded-full bg-current animate-bounce" style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }} />
    ))}
  </span>
);

// ── 커스텀 드롭다운 (글래스 + 검색) ──────────────────────────
const BranchDropdown: React.FC<{ list: Branch[]; current: Branch; color: string; onPick: (b: Branch) => void }> = ({ list, current, color, onPick }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    setQ('');
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const f = q.trim().toLowerCase();
    return f ? list.filter((x) => x.nm.toLowerCase().includes(f)) : list;
  }, [q, list]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 min-w-[140px] max-w-[210px] px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-white/15 backdrop-blur hover:border-current transition-colors"
        style={{ color: open ? color : undefined }}
      >
        <span className="flex-1 text-left truncate text-slate-700 dark:text-slate-200">{current.nm || '지점 선택'}</span>
        <span className={`text-[9px] opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 z-30 w-[250px] max-w-[82vw] rounded-xl border border-slate-200 dark:border-white/15 bg-white/95 dark:bg-[#0e162a]/95 shadow-2xl backdrop-blur-xl overflow-hidden">
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="지점 검색"
            className="w-full px-3 py-2.5 text-xs bg-transparent text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-white/10 outline-none placeholder:text-slate-400"
          />
          <div className="max-h-[270px] overflow-y-auto p-1.5">
            {filtered.length ? filtered.map((x) => {
              const sel = x.code === current.code;
              return (
                <div
                  key={x.code}
                  onClick={() => { onPick(x); setOpen(false); }}
                  className={`px-2.5 py-1.5 rounded-lg text-[12.5px] cursor-pointer truncate text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 ${sel ? 'font-bold' : ''}`}
                  style={sel ? { background: `color-mix(in srgb, ${color} 22%, transparent)` } : undefined}
                >
                  {x.nm}
                </div>
              );
            }) : <div className="px-2.5 py-2.5 text-xs text-slate-400">검색 결과 없음</div>}
          </div>
        </div>
      )}
    </div>
  );
};

// ── 회차 칩 ──────────────────────────────────────────────────
const Chip: React.FC<{ s: Showtime; color: string }> = ({ s, color }) => {
  const seat = s.total ? `${s.left}/${s.total}` : s.left ? `${s.left}석` : '';
  const low = !!(s.total && s.left / s.total < 0.15);
  return (
    <span className={`flex items-baseline gap-1.5 min-w-0 px-2 py-1 rounded-lg text-[10px] bg-slate-100/80 dark:bg-white/[0.07] border ${low ? 'border-red-400/70 dark:border-red-400/60' : 'border-slate-200 dark:border-white/10'}`}>
      <b className="text-[11.5px] font-bold text-slate-900 dark:text-white shrink-0">{s.start}</b>
      {s.screen && <u className="no-underline text-[8.5px] font-semibold truncate flex-1 min-w-0" style={{ color }} title={s.screenFull || s.screen}>{s.screen}</u>}
      {seat && <em className={`not-italic text-[8.5px] shrink-0 ml-auto ${low ? 'text-red-500 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300'}`}>{seat}</em>}
    </span>
  );
};

// ── 영화 카드 ────────────────────────────────────────────────
const MovieCard: React.FC<{ m: MovieEntry; color: string; today: string }> = ({ m, color, today }) => {
  const [showAll, setShowAll] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const st = useMemo(() => m.showtimes.slice().sort((a, b) => (a.start || '').localeCompare(b.start || '')), [m.showtimes]);
  const visible = showAll ? st : st.slice(0, CHIP_CAP);
  const isLotte = m.chain === '롯데시네마';

  return (
    <article className="flex items-start rounded-xl overflow-hidden bg-white/60 dark:bg-white/[0.04] border border-slate-200 dark:border-white/10">
      <div className="w-[72px] min-w-[72px] aspect-[2/3] bg-slate-100 dark:bg-white/5 flex items-center justify-center">
        {m.poster && imgOk
          ? <img src={m.poster} alt="" loading="lazy" onError={() => setImgOk(false)} className="w-full h-full object-cover" />
          : <span className="text-2xl opacity-40">🎬</span>}
      </div>
      <div className="flex-1 min-w-0 p-2.5 px-3">
        <header className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          {isLotte
            ? <span className="text-[9.5px] font-bold px-1.5 py-px rounded-full bg-white dark:bg-transparent border-[1.5px]" style={{ color, borderColor: color }}>{m.chain}</span>
            : <span className="text-[9.5px] font-bold text-white px-2 py-0.5 rounded-full" style={{ background: color }}>{m.chain}</span>}
          {m.rating && <span className="text-[9.5px] text-red-500 dark:text-red-300 border border-red-300/50 dark:border-red-500/40 rounded px-1 py-px">{m.rating}</span>}
          <span className="text-[9.5px] text-slate-500 dark:text-slate-400 border border-slate-300/60 dark:border-white/15 rounded px-1 py-px">{m.format}</span>
          {m.date && m.date !== today && <span className="text-[9.5px] text-white rounded px-1.5 py-px" style={{ background: color }}>내일</span>}
        </header>
        <h3 className="text-[13.5px] font-bold text-slate-900 dark:text-white truncate mb-1">{m.movie}</h3>
        <p className="text-[10.5px] text-slate-500 dark:text-slate-400 mb-2">📍 {m.cinema}</p>
        {/* 칩: 모바일 1열(상영관명 잘림 방지) / 데스크톱 2열(가로 폭 활용) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {visible.map((s, i) => <Chip key={i} s={s} color={color} />)}
        </div>
        {st.length > CHIP_CAP && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="mt-1.5 w-full py-1.5 rounded-lg text-[10.5px] text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-white/20 hover:text-slate-700 dark:hover:text-slate-200"
          >
            {showAll ? '접기' : `더보기 +${st.length - CHIP_CAP}`}
          </button>
        )}
      </div>
    </article>
  );
};

const SkeletonCard: React.FC = () => (
  <article className="flex items-start rounded-xl overflow-hidden bg-white/40 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 animate-pulse">
    <div className="w-[72px] min-w-[72px] aspect-[2/3] bg-slate-200 dark:bg-white/10" />
    <div className="flex-1 min-w-0 p-2.5 px-3">
      <div className="h-2.5 w-1/3 rounded bg-slate-200 dark:bg-white/10 mb-2" />
      <div className="h-3.5 w-3/5 rounded bg-slate-200 dark:bg-white/10 mb-2" />
      <div className="h-2 w-2/5 rounded bg-slate-200 dark:bg-white/10 mb-3" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-6 rounded-lg bg-slate-200 dark:bg-white/10" />)}
      </div>
    </div>
  </article>
);

// ── 체인 섹션 ────────────────────────────────────────────────
const ChainSection: React.FC<{ chainKey: ChainKey; nm: string; color: string; initial?: Branch }> = ({ chainKey, nm, color, initial }) => {
  const list = useMemo(() => flatBranches(chainKey), [chainKey]);
  const start = useMemo(() => initial?.code ? initial : (list[0] || { code: '', nm: '' }), [initial, list]);
  const [branch, setBranch] = useState<Branch>(start);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllMovies, setShowAllMovies] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    let alive = true;
    const id = ++reqId.current;
    setLoading(true);
    setShowAllMovies(false);
    const t0 = performance.now();
    (async () => {
      try {
        const r = await fetch(`/api/showtimes?chain=${chainKey}&code=${encodeURIComponent(branch.code)}&nm=${encodeURIComponent(branch.nm)}`);
        const j: Payload = await r.json();
        const wait = MIN_SKELETON - (performance.now() - t0);
        if (wait > 0) await new Promise((res) => setTimeout(res, wait));
        if (alive && id === reqId.current) {
          setPayload(j);
          setLoading(false);
          // 멀티턴 후속 질문용: 화면 표시 상영표를 클라 스토어에 적재
          setChainShowtimes(chainKey, (j.list && j.list.length)
            ? { chainName: nm, cinema: j.cinema || `${nm} ${branch.nm}`, movies: j.list.map((m) => ({ movie: m.movie, rating: m.rating, format: m.format, showtimes: m.showtimes.map((s) => ({ start: s.start, screen: s.screen, left: s.left, total: s.total })) })) }
            : null);
        }
      } catch (e: any) {
        if (alive && id === reqId.current) { setPayload({ error: e?.message || '조회 실패', list: [] }); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [chainKey, branch.code, branch.nm]);

  const today = kstYmd();
  const movies = payload?.list || [];
  const visibleMovies = showAllMovies ? movies : movies.slice(0, MOVIE_CAP);
  const at = payload && !loading ? new Date(Date.now() - (payload.age || 0)).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <section className="rounded-xl bg-slate-50/60 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 border-t-2 p-3" style={{ borderTopColor: color }}>
      <div className="flex items-center gap-2 flex-wrap mb-2.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">{nm}</h2>
        <BranchDropdown list={list} current={branch} color={color} onPick={setBranch} />
        <a
          href={branchUrl(chainKey, branch.code)}
          target="_blank"
          rel="noopener noreferrer"
          title={`${nm} ${branch.nm} 페이지 열기`}
          className="text-[10px] text-slate-400 dark:text-slate-500 transition-colors"
          onMouseEnter={(e) => { e.currentTarget.style.color = color; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = ''; }}
        >
          <i className="fa-solid fa-arrow-up-right-from-square" />
        </a>
        <span className="inline-flex items-center text-[11px] text-slate-500 dark:text-slate-400">
          {loading ? <>{branch.nm} 조회 중<LoadingDots /></>
            : payload?.error ? `조회 실패`
            : `${payload?.cinema || branch.nm} · 영화 ${payload?.movies || 0} · 회차 ${payload?.total || 0}${at ? ` · ${at} 조회` : ''}`}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {loading
          ? <><SkeletonCard /><SkeletonCard /></>
          : payload?.error
            ? <p className="text-xs text-slate-500 dark:text-slate-400 py-3">조회 실패: {payload.error}</p>
            : movies.length === 0
              ? <p className="text-xs text-slate-500 dark:text-slate-400 py-3">상영 회차 없음 (오늘/내일 모두)</p>
              : visibleMovies.map((m, i) => <MovieCard key={`${m.movie}-${i}`} m={m} color={color} today={today} />)}
      </div>

      {!loading && movies.length > MOVIE_CAP && (
        <button
          onClick={() => setShowAllMovies((v) => !v)}
          className="mt-2 w-full py-1.5 rounded-lg text-[11.5px] font-semibold text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-white/20 hover:text-slate-700 dark:hover:text-slate-200 hover:border-current"
          style={{ borderColor: undefined }}
        >
          {showAllMovies ? '접기' : `영화 ${movies.length - MOVIE_CAP}개 더보기`}
        </button>
      )}
    </section>
  );
};

export const MovieRenderer: React.FC<{ data: MovieData }> = ({ data }) => {
  return (
    <div className="my-4 flex flex-col gap-3.5">
      {CHAINS.map((ch) => (
        <ChainSection key={ch.key} chainKey={ch.key} nm={ch.nm} color={ch.color} initial={data?.defaults?.[ch.key]} />
      ))}
    </div>
  );
};

export default MovieRenderer;
