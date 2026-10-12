/**
 * Google ID 토큰 로그인(GIS) 하니스 — `npx tsx tests/test-google-id.mts`
 * DEV_261011 §5: 리다이렉트 OAuth 는 계정 선택 화면에 "…supabase.co(으)로 이동" 이 뜬다 → 앱 안에서 ID 토큰.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { makeRawNonce, sha256Hex, isIdentityConflict, gisLocale } from '../src/lib/google-id.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`);
};

console.log('── ① nonce ──');
const a = makeRawNonce(), b = makeRawNonce();
check('원문 nonce 는 매번 다르다', a !== b);
check('원문 nonce 는 URL-safe·충분한 길이', /^[A-Za-z0-9_-]{40,}$/.test(a), a);
const h = await sha256Hex(a);
check('🔴 Google 에 주는 값 = 원문의 SHA-256 hex (Supabase 가 같은 방식으로 비교)', h === createHash('sha256').update(a).digest('hex'));
check('해시는 원문과 다르다(원문을 Google 에 보내지 않는다)', h !== a && /^[0-9a-f]{64}$/.test(h));

console.log('\n── ② 충돌 판정 ──');
check('identity_already_exists → 충돌', isIdentityConflict({ code: 'identity_already_exists' }));
check('"Identity is already linked to another user" → 충돌', isIdentityConflict({ message: 'Identity is already linked to another user' }));
check('일반 오류는 충돌 아님', !isIdentityConflict({ code: 'bad_jwt', message: 'invalid nonce' }));
check('undefined 안전', !isIdentityConflict(undefined));
check('로케일 매핑', gisLocale('ko') === 'ko' && gisLocale('fr') === 'fr' && gisLocale('xx') === 'en');

console.log('\n── ③ 배선 ──');
const btn = fs.readFileSync('components/GoogleIdButton.tsx', 'utf8');
check('Google 에는 해시 nonce, 콜백엔 원문 nonce', /nonce: hashed/.test(btn) && /nonce: raw/.test(btn));
check('클라이언트 ID 없음·로드 실패 → onUnavailable(리다이렉트 폴백)', /if \(!GOOGLE_CLIENT_ID\) \{ cb\.current\.onUnavailable\(\)/.test(btn) && /catch[\s\S]*onUnavailable\(\)/.test(btn));
check('innerHTML 미사용', !btn.includes('innerHTML'));
const hook = fs.readFileSync('src/hooks/useAuthSession.ts', 'utf8');
check('link 는 linkIdentity({ provider, token, nonce })', /linkIdentity\(\{ provider: 'google', token: cred\.token, nonce: cred\.nonce \}\)/.test(hook));
check('signIn 은 signInWithIdToken({ provider, token, nonce })', /signInWithIdToken\(\{ provider: 'google', token: cred\.token, nonce: cred\.nonce \}\)/.test(hook));
check('기존 리다이렉트 함수 유지(폴백)', hook.includes('signInWithOAuth') && hook.includes('linkIdentity({\n      provider: \'google\',\n      options: oauthOptions()'));
const modal = fs.readFileSync('components/AuthModal.tsx', 'utf8');
check('충돌 재시도는 받은 토큰을 다시 쓴다(계정 두 번 고르지 않음)', /if \(lastCred\.current\) await onSignInWithCredential\(lastCred\.current\)/.test(modal));
check('리다이렉트로 돌아온 충돌(토큰 없음)은 기존 onSignIn', /else await onSignIn\(\)/.test(modal));
check('GIS 실패 시 기존 버튼', /!gisFailed \?/.test(modal) && /onClick=\{handleLink\}/.test(modal));
check('계정 전환 모드 없음(로그아웃 → 로그인으로 대체)', !/switch/i.test(modal));
const app = fs.readFileSync('App.tsx', 'utf8');
check('🔴 link 는 게스트에게만 — 정식 계정에 다른 신원을 붙이지 않는다',
    /shouldLinkGuest = \(currentUser\?\.is_guest \?\? true\) && guestHasData;/.test(app));
check('onLink·onCredential 이 같은 기준', app.includes('onLink={shouldLinkGuest ? linkGoogle : signInWithGoogle}') && app.includes('onCredential={shouldLinkGuest ? linkGoogleIdToken : signInGoogleIdToken}'));
const header = fs.readFileSync('components/Header.tsx', 'utf8');
check('헤더에 "다른 계정으로 로그인" 없음(로그아웃만)', !/onSwitchAccount|switchAccount/.test(header) && !/onSwitchAccount/.test(app));
check('CSP frame-src 에 accounts.google.com', /frame-src[^"]*https:\/\/accounts\.google\.com/.test(fs.readFileSync('next.config.ts', 'utf8')));

console.log('\n── ④ 카카오(리다이렉트 OAuth) ──');
check('카카오 link 는 linkIdentity({ provider: kakao })', /linkIdentity\(\{ provider: 'kakao'/.test(hook));
check('카카오 scopes 명시(사진 누락 대응)', /scopes: 'profile_nickname profile_image account_email'/.test(hook) && (hook.match(/KAKAO_OAUTH_OPTIONS\(\)/g) || []).length === 2);
check('카카오 signIn 은 signInWithOAuth({ provider: kakao })', /signInWithOAuth\(\{ provider: 'kakao'/.test(hook));
check('시도한 공급자를 남긴다(google·kakao 모두)', (hook.match(/rememberOAuthProvider\('kakao'\)/g) || []).length === 2 && (hook.match(/rememberOAuthProvider\('google'\)/g) || []).length === 2);
check('🔴 리다이렉트 충돌은 시도한 공급자로 다시 로그인', app.includes("lastOAuthProvider() === 'kakao' ? signInWithKakao() : signInWithGoogle({ chooseAccount: false })"));
check('카카오도 link/signIn 기준이 같다', app.includes('onKakao={shouldLinkGuest ? linkKakao : signInWithKakao}'));
check('카카오 버튼 — 디자인 가이드 색(#FEE500)·4개 언어 문구', modal.includes('bg-[#FEE500]') && (modal.match(/kakao: '/g) || []).length === 4);

check('🔴 새로고침은 인증 해시를 버린다(reload 금지)', !hook.includes('window.location.reload()') && hook.includes('window.location.replace(window.location.pathname + window.location.search)'));
check('세션 확보 뒤 주소의 토큰 해시 제거', /await ensureSession\(\);\s*\n[^\n]*\n\s*stripAuthHash\(\);/.test(hook));
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
