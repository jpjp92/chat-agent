import React from 'react';

interface LoadingScreenProps {
    message: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ message }) => {
    return (
        <div className="flex h-dvh items-center justify-center bg-white dark:bg-[#131314]">
            <div className="flex flex-col items-center justify-center space-y-8 animate-in fade-in duration-700">
                <div className="relative">
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-500 via-primary-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-primary-500/30 animate-pulse">
                        <i className="fa-solid fa-comment-dots text-white text-4xl"></i>
                    </div>
                    <div className="absolute inset-0 bg-primary-500 blur-2xl opacity-20 animate-pulse"></div>
                </div>

                <div className="flex items-center space-x-2">
                    <p className="text-slate-500 dark:text-slate-400 font-medium text-lg">
                        {message}
                    </p>
                    <div className="flex space-x-1 pt-2">
                        <div className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                        <div className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                        <div className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce"></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LoadingScreen;
