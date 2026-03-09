
import React from 'react';

interface YoutubeEmbedProps {
  url: string;
}

const YoutubeEmbed: React.FC<YoutubeEmbedProps> = ({ url }) => {
  const getYoutubeId = (url: string) => {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?)|(shorts\/))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[8].length === 11) ? match[8] : null;
  };

  const videoId = getYoutubeId(url);

  if (!videoId) return null;

  return (
    <div className="w-full my-4 animate-in fade-in slide-in-from-bottom-2 duration-700">
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-slate-200/50 dark:border-white/10 shadow-2xl bg-black group">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`}
          title="YouTube video player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute top-0 left-0 w-full h-full border-0"
        ></iframe>
        
        {/* Decorative Overlay for Glassmorphism feel */}
        <div className="absolute inset-0 pointer-events-none border border-white/5 rounded-2xl"></div>
      </div>
      
      <div className="mt-2 flex items-center gap-2 px-1">
        <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">YouTube Video Player</span>
      </div>
    </div>
  );
};

export default YoutubeEmbed;
