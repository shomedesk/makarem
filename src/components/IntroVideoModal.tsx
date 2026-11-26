import React, { useEffect, useRef, useState } from 'react';
import { Volume2, X, Play } from 'lucide-react';

interface IntroVideoModalProps {
  videoUrl: string;
  isOpen: boolean;
  onClose: () => void;
  language: 'en' | 'ar';
}

export function extractYouTubeVideoId(rawUrl: string): string | null {
  const url = String(rawUrl || '').trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace(/^\//, '').split('/')[0] || null;
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const parts = u.pathname.split('/').filter(Boolean);
      const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'live');
      if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1];
    }
  } catch {
    const match = url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([A-Za-z0-9_-]{6,})/);
    if (match) return match[1];
  }
  return null;
}

export const IntroVideoModal: React.FC<IntroVideoModalProps> = ({
  videoUrl,
  isOpen,
  onClose,
  language,
}) => {
  const isAr = language === 'ar';
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const [needsSoundTap, setNeedsSoundTap] = useState(false);

  const youtubeId = extractYouTubeVideoId(videoUrl);

  useEffect(() => {
    if (!isOpen || !youtubeId) return;

    let cancelled = false;
    setNeedsSoundTap(false);

    const mountPlayer = () => {
      if (cancelled || !playerContainerRef.current) return;
      const YT = (window as any).YT;
      if (!YT || !YT.Player) return;

      try {
        ytPlayerRef.current?.destroy?.();
      } catch {
        // ignore cleanup error
      }

      ytPlayerRef.current = new YT.Player(playerContainerRef.current, {
        videoId: youtubeId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: (ev: any) => {
            try {
              ev.target.unMute();
              ev.target.setVolume(100);
              ev.target.playVideo();
              // Verify shortly after whether browser paused/blocked unmuted autoplay
              setTimeout(() => {
                if (cancelled) return;
                try {
                  const st = ev.target.getPlayerState?.();
                  if (st !== 1 && st !== 3) {
                    setNeedsSoundTap(true);
                  }
                } catch {
                  // ignore
                }
              }, 900);
            } catch {
              setNeedsSoundTap(true);
            }
          },
          onStateChange: (ev: any) => {
            if (ev.data === 1) {
              setNeedsSoundTap(false);
            }
            // YT.PlayerState.ENDED === 0 -> auto close popup cleanly when video finishes
            if (ev.data === 0) {
              onClose();
            }
          },
          onError: () => {
            onClose();
          },
        },
      });
    };

    if ((window as any).YT && (window as any).YT.Player) {
      mountPlayer();
    } else {
      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!existingScript) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      const prevCallback = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        if (typeof prevCallback === 'function') prevCallback();
        mountPlayer();
      };
    }

    return () => {
      cancelled = true;
      try {
        ytPlayerRef.current?.destroy?.();
      } catch {
        // ignore
      }
      ytPlayerRef.current = null;
    };
  }, [isOpen, youtubeId, onClose]);

  if (!isOpen || !videoUrl.trim()) return null;

  const handleTapPlayWithSound = () => {
    try {
      ytPlayerRef.current?.unMute?.();
      ytPlayerRef.current?.setVolume?.(100);
      ytPlayerRef.current?.playVideo?.();
      setNeedsSoundTap(false);
    } catch {
      setNeedsSoundTap(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border border-white/15 animate-fadeIn">
        {/* Top Bar with Prominent Close Button */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-950/90 text-white border-b border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="font-extrabold text-xs sm:text-sm truncate">
              {isAr ? 'أهلاً بكم في بقالة مكارم الخير الحديثة' : 'Welcome to Makarem Al-Khair Modern'}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/15 hover:bg-rose-600 text-white text-xs font-extrabold transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
            <span>{isAr ? 'إغلاق' : 'Close'}</span>
          </button>
        </div>

        {/* Centered Responsive Video Frame */}
        <div className="relative aspect-video bg-black flex items-center justify-center">
          {youtubeId ? (
            <>
              <div ref={playerContainerRef} className="w-full h-full" />
              {needsSoundTap && (
                <button
                  type="button"
                  onClick={handleTapPlayWithSound}
                  className="absolute inset-0 bg-slate-950/55 flex flex-col items-center justify-center gap-3 text-white cursor-pointer group"
                >
                  <div className="w-16 h-16 rounded-full bg-emerald-600 group-hover:bg-emerald-500 flex items-center justify-center shadow-xl transition transform group-hover:scale-105">
                    <Play className="w-7 h-7 fill-white ms-0.5" />
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-slate-900/90 border border-white/20 text-xs font-extrabold">
                    <Volume2 className="w-4 h-4 text-emerald-400" />
                    <span>{isAr ? 'اضغط للتشغيل بالصوت' : 'Tap to Play with Sound'}</span>
                  </span>
                </button>
              )}
            </>
          ) : (
            <video
              src={videoUrl}
              autoPlay
              controls
              playsInline
              onEnded={onClose}
              className="w-full h-full object-contain"
            />
          )}
        </div>
      </div>
    </div>
  );
};
