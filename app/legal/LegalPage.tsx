/**
 * 약관·개인정보처리방침 공용 레이아웃.
 *
 * 왜 별도 컴포넌트인가: 두 문서가 같은 골격을 쓰고, Google OAuth 동의 화면 심사에서
 * **두 URL 모두** 접근 가능해야 한다(브랜딩 구성 필수 항목). 골격이 갈리면 한쪽만
 * 손보다가 다른 쪽이 낡는다.
 *
 * 앱 본문(App.tsx)과 분리된 정적 페이지다 — 인증·Supabase 호출이 없어야 한다.
 * 로그인 전(그리고 심사 봇)에도 열려야 하기 때문이다.
 */
import Link from 'next/link';

/** 문의처 — 🔴 배포 전 실제 주소로 교체할 것. Google 심사는 연락 가능한 곳을 요구한다. */
export const CONTACT_EMAIL = 'CHANGE_ME@example.com';

/** 최종 개정일 — 내용을 고치면 반드시 함께 올린다. */
export const LAST_UPDATED = '2026-08-01';

export function LegalPage({
    title,
    titleEn,
    children,
}: {
    title: string;
    titleEn: string;
    children: React.ReactNode;
}) {
    return (
        <main className="min-h-screen bg-slate-50 dark:bg-[#0b1020] text-slate-800 dark:text-slate-200">
            <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:underline dark:text-indigo-400"
                >
                    ← Chat Agent
                </Link>

                <h1 className="mt-6 text-2xl font-bold sm:text-3xl">{title}</h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{titleEn}</p>
                <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                    최종 개정일 / Last updated: {LAST_UPDATED}
                </p>

                <div className="legal-body mt-10 space-y-8 text-[15px] leading-7">{children}</div>

                <footer className="mt-16 border-t border-slate-200 pt-6 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <p>
                        문의 / Contact:{' '}
                        <a className="text-indigo-600 hover:underline dark:text-indigo-400" href={`mailto:${CONTACT_EMAIL}`}>
                            {CONTACT_EMAIL}
                        </a>
                    </p>
                    <p className="mt-2">
                        <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href="/privacy">
                            개인정보처리방침
                        </Link>
                        {' · '}
                        <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href="/terms">
                            이용약관
                        </Link>
                    </p>
                </footer>
            </div>
        </main>
    );
}

/** 절(節) 하나. 제목은 국문 + 영문 병기 — Google 심사자가 영어권일 수 있다. */
export function Section({ n, title, titleEn, children }: {
    n: number; title: string; titleEn: string; children: React.ReactNode;
}) {
    return (
        <section>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {n}. {title}
                <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">({titleEn})</span>
            </h2>
            <div className="mt-3 space-y-3">{children}</div>
        </section>
    );
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
    return (
        <ul className="list-disc space-y-2 pl-5 marker:text-slate-400">
            {items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
    );
}

export function Notice({ children }: { children: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-[14px] dark:border-amber-500/40 dark:bg-amber-500/10">
            {children}
        </div>
    );
}
