import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const DefaultInlineFallback: React.FC = () => (
  <div className="w-full my-4 p-4 rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/10">
    <div className="flex items-center gap-2 text-red-500 dark:text-red-400">
      <i className="fa-solid fa-triangle-exclamation text-sm" />
      <span className="text-sm font-medium">이 콘텐츠를 표시할 수 없습니다.</span>
    </div>
  </div>
);

export const AppErrorFallback: React.FC = () => (
  <div className="fixed inset-0 flex flex-col items-center justify-center bg-white dark:bg-slate-950 gap-6 p-8 text-center">
    <i className="fa-solid fa-circle-exclamation text-4xl text-red-400" />
    <div className="space-y-2">
      <p className="text-slate-800 dark:text-slate-200 font-semibold text-lg">
        화면에 오류가 발생했습니다
      </p>
      <p className="text-slate-500 dark:text-slate-400 text-sm">
        An unexpected error occurred
      </p>
    </div>
    <button
      onClick={() => window.location.reload()}
      className="px-5 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium transition-colors"
    >
      새로고침 · Reload
    </button>
  </div>
);

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? <DefaultInlineFallback />;
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
