import { useEffect, useState, useMemo } from 'react';
import { loginUser } from '../../services/geminiService';
import { UserProfile } from '../../types';

export interface SupabaseUser {
  id: number;
  nickname: string;
  created_at: string;
  display_name?: string;
  avatar_url?: string;
}

const defaultAvatarUrl = 'https://images.unsplash.com/photo-1591160690555-5debfba289f0?w=72&h=72&fit=crop&fm=webp&q=55';

const buildUserProfile = (user: SupabaseUser): UserProfile => ({
  name: user.display_name || user.nickname,
  avatarUrl: user.avatar_url || defaultAvatarUrl,
});

export const useAuthSession = () => {
  const [currentUser, setCurrentUser] = useState<SupabaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      let user: SupabaseUser | null = null;
      const savedUser = localStorage.getItem('gemini_chat_user');

      if (savedUser) {
        try {
          user = JSON.parse(savedUser);
        } catch (error) {
          console.error('Failed to parse saved user:', error);
          localStorage.removeItem('gemini_chat_user');
        }
      } else {
        const randomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        const guestNickname = `사용자_${randomId}`;

        try {
          const { user: newUser, error } = await loginUser(guestNickname);
          if (!error && newUser) {
            user = newUser;
            localStorage.setItem('gemini_chat_user', JSON.stringify(newUser));
          } else if (error) {
            console.error('Auto-login error:', error);
          }
        } catch (error) {
          console.error('Auto-login failed:', error);
        }
      }

      if (!isMounted) {
        return;
      }

      setCurrentUser(user);
      setIsAuthLoading(false);
    };

    initAuth().catch(error => {
      console.error('initAuth failed:', error);
      if (isMounted) {
        setIsAuthLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const clearStoredUser = () => {
    localStorage.removeItem('gemini_chat_user');
    setCurrentUser(null);
  };

  return {
    currentUser,
    setCurrentUser,
    isAuthLoading,
    clearStoredUser,
    hydratedUserProfile: useMemo(() => currentUser ? buildUserProfile(currentUser) : null, [currentUser]),
  };
};