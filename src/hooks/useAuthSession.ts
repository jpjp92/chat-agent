import { useEffect, useState, useMemo, useCallback } from 'react';
import { getSupabaseClient, ensureSession } from '../../lib/supabase/client';
import { clearSessionsCache } from './useChatSessions';
import { UserProfile } from '../../types';

/** auth.users + public.profiles 를 합친 클라이언트 표현. id 는 uuid. */
export interface SupabaseUser {
  id: string;
  display_name: string;
  avatar_url?: string | null;
  is_guest: boolean;
  /** profiles 에는 없다. auth 세션에서 채운다 — 설정에서 "어느 계정인가"를 보여주는 용도. */
  email?: string | null;
}

const defaultAvatarUrl = 'https://images.unsplash.com/photo-1591160690555-5debfba289f0?w=72&h=72&fit=crop&fm=webp&q=55';

const buildUserProfile = (user: SupabaseUser): UserProfile => ({
  name: user.display_name,
  avatarUrl: user.avatar_url || defaultAvatarUrl,
});

/**
 * link/signIn 공통 OAuth 옵션.
 *
 * prompt=select_account: 없으면 브라우저에 이미 로그인된 Google 계정이 **묻지도 않고**
 * 선택된다. 계정이 하나인 사용자에겐 클릭이 한 번 늘 뿐이지만, 여러 개인 사용자는
 * 이게 없으면 원하는 계정을 **아예 못 고른다.** 그래서 첫 로그인·전환엔 항상 켠다.
 *
 * 예외 — 충돌 재시도(chooseAccount=false): 이미 방금 계정을 골라 돌아왔는데
 * `identity_already_exists` 로 튕긴 경우다. 여기서 또 select_account 를 켜면
 * **같은 계정을 두 번 고르게** 되어 "두 번 로그인하는" 체감이 난다. 어느 계정인지
 * 아니까 프롬프트를 빼서 Google 이 자동 통과하게 둔다 → 사용자 조작은 한 번.
 */
/**
 * 새로고침하되 **주소의 인증 해시(#access_token=…)를 버린다.**
 * 🔴 카카오(리다이렉트, implicit) 로그인 뒤 주소에 `#access_token…` 이 남는다. 그 상태에서 로그아웃·GIS 로그인이
 *   `reload()` 하면 **끝난 세션의 토큰을 다시 싣고** 열려 detectSessionInUrl 이 그 토큰으로 세션을 되살리거나
 *   새 세션과 엇갈렸다(10-11 실측: 카카오 → 로그아웃 → Google 로그인이 안 들어감).
 */
const AUTH_HASH = /(^|&)(access_token|refresh_token|provider_token|expires_at|token_type|error_code)=/;
export const stripAuthHash = () => {
  if (typeof window === 'undefined') return;
  if (AUTH_HASH.test(window.location.hash.replace(/^#/, ''))) {
    window.history.replaceState({}, '', window.location.pathname + window.location.search);
  }
};
const reloadWithoutAuthHash = () => {
  window.location.replace(window.location.pathname + window.location.search);
};

/**
 * 리다이렉트 OAuth 를 어느 공급자로 시도했나 — 돌아온 충돌(identity_already_exists)에 같은 공급자로 로그인시키려고.
 * sessionStorage: 탭 단위·리다이렉트 왕복에는 살아남는다. 실패해도 기본(google)으로 동작한다.
 */
const OAUTH_PROVIDER_KEY = 'chatagent.oauthProvider';
export type OAuthProviderId = 'google' | 'kakao';
const rememberOAuthProvider = (p: OAuthProviderId) => { try { sessionStorage.setItem(OAUTH_PROVIDER_KEY, p); } catch { /* 저장 불가 */ } };
export const lastOAuthProvider = (): OAuthProviderId => {
  try { return sessionStorage.getItem(OAUTH_PROVIDER_KEY) === 'kakao' ? 'kakao' : 'google'; } catch { return 'google'; }
};

/**
 * 카카오 OAuth 옵션. 🔴 scopes 를 **명시한다**(2026-10-11 실측): 동의 화면엔 프로필 사진이 보였는데
 *   Supabase identity_data 에 `avatar_url`·`picture` 가 없었다(사진 있는 계정). 동의항목 ID 그대로 요청한다.
 */
const KAKAO_OAUTH_OPTIONS = () => ({
  redirectTo: window.location.origin,
  scopes: 'profile_nickname profile_image account_email',
});

const oauthOptions = (chooseAccount = true) => ({
  redirectTo: window.location.origin,
  ...(chooseAccount ? { queryParams: { prompt: 'select_account' } } : {}),
});

/**
 * 게스트는 Supabase Anonymous Sign-in 으로 만든다(가입 없이 즉시 사용 UX 유지).
 * 정식 계정 전환은 linkIdentity 로 같은 uuid 를 유지하므로 대화가 승계된다.
 *
 * profiles 행은 auth.users INSERT 트리거가 만들고, 승격 시 동기화 트리거가 맞춘다.
 * 클라이언트는 읽기만 한다.
 */
export const useAuthSession = () => {
  const [currentUser, setCurrentUser] = useState<SupabaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  // 로그아웃은 의도적으로 currentUser 를 null 로 만든다. 그 순간을 "인증 실패"
  // 에러 화면과 구분하지 않으면, 리로드 직전 한 프레임 "연결 실패"가 번쩍인다.
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const supabase = getSupabaseClient();

    const loadProfile = async (userId: string): Promise<SupabaseUser | null> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, is_guest')
        .eq('id', userId)
        .maybeSingle();
      if (error) {
        console.error('Profile load failed:', error.message);
        return null;
      }
      if (!data) return null;

      // getSession() 은 로컬 캐시에서 읽는다 — 네트워크 왕복 없음.
      const { data: { session } } = await supabase.auth.getSession();
      return { ...(data as SupabaseUser), email: session?.user?.email ?? null };
    };

    const initAuth = async () => {
      // 재방문자는 로컬 저장소에서 즉시 복원되고, 신규 방문자만 익명 로그인 왕복 1회.
      // ensureSession()이 진행 중인 로그인을 공유하므로 StrictMode 이중 실행에도
      // 익명 유저가 하나만 생긴다.
      const userId = await ensureSession();
      // 세션을 URL 에서 읽어 들인 뒤엔 토큰을 주소에 남기지 않는다(새로고침·공유·히스토리에 토큰 노출 방지).
      stripAuthHash();
      if (!userId) throw new Error('No user after sign-in');

      const profile = await loadProfile(userId);
      if (!isMounted) return;

      setCurrentUser(profile);
      setIsAuthLoading(false);
    };

    initAuth().catch(error => {
      console.error('initAuth failed:', error);
      if (isMounted) {
        // currentUser 를 명시적으로 null 로 확정해야 에러 화면이 표시됨
        setCurrentUser(null);
        setIsAuthLoading(false);
      }
    });

    // 콜백 안에서 다른 supabase 호출을 하면 데드락 위험 → 상태만 세팅하고 밖에서 처리.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      if (event === 'SIGNED_OUT' || !session?.user) {
        setCurrentUser(null);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        const uid = session.user.id;
        queueMicrotask(() => {
          loadProfile(uid).then(p => { if (isMounted && p) setCurrentUser(p); });
        });
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  /** display_name / avatar_url 갱신. RLS 가 본인 행만 허용하므로 라우트가 필요 없다. */
  const updateProfile = useCallback(async (patch: { display_name?: string; avatar_url?: string }) => {
    if (!currentUser) return;
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', currentUser.id)
      .select('id, display_name, avatar_url, is_guest')
      .single();
    if (error) throw new Error(`Profile update failed: ${error.message}`);
    setCurrentUser(data as SupabaseUser);
  }, [currentUser]);

  // ── 🔴 link 냐 signIn 이냐 ────────────────────────────────────────────────
  // 무엇을 부를지는 **호출부가 정한다.** 기준은 딱 하나: 승계할 게스트 데이터가 있는가.
  //
  //   있다 → linkIdentity     같은 uuid 에 신원을 붙여 대화를 살린다
  //   없다 → signInWithOAuth  고아가 될 게 없다. 그냥 로그인이 맞다
  //
  // 예전 주석은 "활성 세션이 있으면 signInWithOAuth 금지"였는데, 그건 목적을 잘못
  // 일반화한 문장이다. 막으려던 건 세션의 존재가 아니라 **게스트 대화가 주인 없이
  // 남는 것**이다. 대화 0개 게스트(= 캐시를 지운 사용자)나 이미 정식인 사용자에겐
  // 잃을 게 없으므로 signInWithOAuth 는 금지가 아니라 정답이다.
  // 이 구분을 지우면 App.tsx 의 분기가 버그처럼 보여 되돌려진다.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * 게스트를 Google 계정에 연결한다 — 같은 uuid 를 유지하므로 대화가 승계된다.
   *
   * 대상 Google 계정이 이미 다른 유저의 것이면 Supabase 가 거부한다 →
   * 호출부가 충돌 분기(기존 계정으로 로그인, 게스트 데이터 미승계)를 띄운다.
   */
  const linkGoogle = useCallback(async () => {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No session to link');

    rememberOAuthProvider('google');
    const { error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: oauthOptions(),
    });
    if (error) throw error;
  }, []);

  /**
   * Google 계정으로 로그인한다. **현재 세션의 데이터는 승계되지 않는다.**
   *
   * 두 자리에서 쓴다:
   *  - 대화 0개 게스트의 로그인 (승계할 게 없다)
   *  - 이미 로그인한 사용자의 계정 전환 (원래 계정의 대화는 그 uuid 에 그대로
   *    남아 다시 로그인하면 돌아온다. 로그아웃을 선행할 필요가 없다.)
   *
   * chooseAccount=false 는 충돌 재시도 전용 — 방금 고른 계정으로 자동 통과시켜
   * 계정을 두 번 고르는 체감을 없앤다.
   */
  const signInWithGoogle = useCallback(async (opts?: { chooseAccount?: boolean }) => {
    rememberOAuthProvider('google');
    const { error } = await getSupabaseClient().auth.signInWithOAuth({
      provider: 'google',
      options: oauthOptions(opts?.chooseAccount ?? true),
    });
    if (error) throw error;
  }, []);

  // ── 카카오 — 리다이렉트 OAuth(2026-10-11, DEV_261011 §6) ─────────────────────────────
  // Google 과 달리 리다이렉트로 둔다: 카카오 동의 화면에는 Supabase 주소가 아니라 **앱 이름**("Chat Agent")이 뜬다.
  // link/signIn 기준은 Google 과 같다(호출부 shouldLinkGuest). 충돌은 돌아온 URL 의 error_code 로 오므로
  // 어느 공급자로 시도했는지 남겨 둔다 → 충돌 화면의 "기존 계정으로 로그인" 이 같은 공급자로 간다.

  /** 게스트에 카카오 신원을 붙인다(같은 uuid, 대화 승계). */
  const linkKakao = useCallback(async () => {
    rememberOAuthProvider('kakao');
    const { error } = await getSupabaseClient().auth.linkIdentity({ provider: 'kakao', options: KAKAO_OAUTH_OPTIONS() });
    if (error) throw error;
  }, []);

  /** 카카오로 로그인(현재 세션 데이터는 승계되지 않음). */
  const signInWithKakao = useCallback(async () => {
    rememberOAuthProvider('kakao');
    const { error } = await getSupabaseClient().auth.signInWithOAuth({ provider: 'kakao', options: KAKAO_OAUTH_OPTIONS() });
    if (error) throw error;
  }, []);

  // ── ID 토큰 경로(GIS) — 리다이렉트 없이 앱 안에서 끝난다(src/lib/google-id.ts) ──────────
  // link/signIn 의 선택 기준은 위와 같다(호출부가 정한다). 성공하면 **새로고침**한다 —
  // 리다이렉트 경로는 돌아오며 페이지를 새로 그렸고, 세션·대화 캐시·프로필이 그 전제로 짜여 있다.
  // 제자리 갱신으로 바꾸면 그 전제가 조용히 깨질 수 있으므로 같은 끝맺음을 유지한다.

  /** 게스트에 Google 신원을 붙인다(같은 uuid, 대화 승계). 충돌이면 throw → 호출부가 충돌 분기. */
  const linkGoogleIdToken = useCallback(async (cred: { token: string; nonce: string }) => {
    const { error } = await getSupabaseClient().auth.linkIdentity({ provider: 'google', token: cred.token, nonce: cred.nonce });
    if (error) throw error;
    reloadWithoutAuthHash();
  }, []);

  /** ID 토큰으로 로그인(현재 세션 데이터는 승계되지 않음). 충돌 재시도에서 같은 토큰을 다시 쓴다 → 계정을 두 번 안 고른다. */
  const signInGoogleIdToken = useCallback(async (cred: { token: string; nonce: string }) => {
    const { error } = await getSupabaseClient().auth.signInWithIdToken({ provider: 'google', token: cred.token, nonce: cred.nonce });
    if (error) throw error;
    reloadWithoutAuthHash();
  }, []);

  const signOut = useCallback(async () => {
    // 이 플래그로 App 이 에러 화면 대신 "로그아웃 중" 로딩을 그린다.
    // signOut() 이 onAuthStateChange(SIGNED_OUT)로 currentUser 를 null 로 만들면
    // `!currentUser && !isAuthLoading` 이 참이 되어 에러 화면이 뜨는데, 리로드가
    // 즉시가 아니라서 그 프레임이 보인다("연결 실패" 번쩍).
    setIsSigningOut(true);
    try {
      await getSupabaseClient().auth.signOut();
    } catch (e) {
      console.error('signOut error:', e);
    } finally {
      // 🔴 대화 캐시를 반드시 지운다. 안 지우면 새 게스트가 이전 유저의 **대화 제목을**
      //    그대로 본다(실측). RLS 는 DB 를 지키지만 localStorage 는 못 지킨다.
      clearSessionsCache();
      // 네트워크 signOut 이 실패해도 로컬 세션은 지워졌으니 리로드로 마무리한다.
      // 새로고침하면 ensureSession()이 새 게스트를 만든다.
      reloadWithoutAuthHash();
    }
  }, []);

  return {
    currentUser,
    setCurrentUser,
    isAuthLoading,
    isSigningOut,
    updateProfile,
    linkGoogle,
    signInWithGoogle,
    linkGoogleIdToken,
    signInGoogleIdToken,
    linkKakao,
    signInWithKakao,
    signOut,
    hydratedUserProfile: useMemo(() => currentUser ? buildUserProfile(currentUser) : null, [currentUser]),
  };
};
