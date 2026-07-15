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
 * 이게 없으면 원하는 계정을 **아예 못 고른다.** 비대칭이 명확해서 항상 켠다.
 */
const oauthOptions = () => ({
  redirectTo: window.location.origin,
  queryParams: { prompt: 'select_account' },
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
   */
  const signInWithGoogle = useCallback(async () => {
    const { error } = await getSupabaseClient().auth.signInWithOAuth({
      provider: 'google',
      options: oauthOptions(),
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await getSupabaseClient().auth.signOut();
    // 🔴 대화 캐시를 반드시 지운다. 안 지우면 새 게스트가 이전 유저의 **대화 제목을**
    //    그대로 본다(실측). RLS 는 DB 를 지키지만 localStorage 는 못 지킨다.
    clearSessionsCache();
    // 리로드하지 않으면 currentUser=null 상태로 남아 에러 화면이 뜬다.
    // 새로고침하면 ensureSession()이 새 게스트를 만든다.
    window.location.reload();
  }, []);

  return {
    currentUser,
    setCurrentUser,
    isAuthLoading,
    updateProfile,
    linkGoogle,
    signInWithGoogle,
    signOut,
    hydratedUserProfile: useMemo(() => currentUser ? buildUserProfile(currentUser) : null, [currentUser]),
  };
};
