import React, { useState, useEffect } from 'react';
import { Download, Share2, PlusSquare, X, Smartphone, ExternalLink } from 'lucide-react';

interface PwaInstallPromptProps {
  language: 'en' | 'ar';
}

export const PwaInstallPrompt: React.FC<PwaInstallPromptProps> = ({ language }) => {
  const isAr = language === 'ar';
  const [deferredPrompt, setDeferredPrompt] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      return (window as any).__makaremDeferredPrompt || null;
    }
    return null;
  });
  const [isInstallable, setIsInstallable] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return Boolean((window as any).__makaremDeferredPrompt);
    }
    return false;
  });
  const [isIOS, setIsIOS] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem('makarem_pwa_dismissed') === 'true';
  });

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      setIsInIframe(true);
    }

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIosDevice);

    if ((window as any).__makaremDeferredPrompt) {
      setDeferredPrompt((window as any).__makaremDeferredPrompt);
      setIsInstallable(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).__makaremDeferredPrompt = e;
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      (window as any).__makaremDeferredPrompt = null;
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
      setShowGuideModal(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (isInstalled || dismissed) return null;

  const isMobileBrowser =
    typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent);

  // Show banner when native prompt is ready, or on iOS, or inside preview iframe (so user can open directly),
  // or on mobile Chrome before/when SW finishes activating
  const shouldShowBanner = isInstallable || isIOS || isInIframe || isMobileBrowser;
  if (!shouldShowBanner) return null;

  const handleInstallClick = async () => {
    const promptEvent = deferredPrompt || (window as any).__makaremDeferredPrompt;
    if (promptEvent) {
      try {
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        if (outcome === 'accepted') {
          setIsInstalled(true);
        }
      } catch {
        setShowGuideModal(true);
      }
      (window as any).__makaremDeferredPrompt = null;
      setDeferredPrompt(null);
      setIsInstallable(false);
    } else {
      setShowGuideModal(true);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('makarem_pwa_dismissed', 'true');
  };

  return (
    <>
      {/* Native PWA Install Strip Banner */}
      <div className="bg-slate-900 text-white px-3 py-2 sm:px-4 sm:py-2.5 border-b border-emerald-500/30 flex items-center justify-between gap-2 shadow-xs text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
            <Smartphone className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0 truncate">
            <span className="font-extrabold text-white text-xs block truncate">
              {isAr ? 'تثبيت تطبيق مكارم الخير' : 'Install Makarem Al-Khair App'}
            </span>
            <span className="text-[10px] text-slate-300 block truncate">
              {isInIframe
                ? isAr
                  ? 'افتح المتجر في تبويب مستقل لتثبيت التطبيق على جهازك'
                  : 'Open full store tab to install as standalone app'
                : isAr
                ? 'تثبيت مباشر كتطبيق مستقل سريع على هاتفك'
                : 'Install as a full standalone app on your phone'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isInIframe ? (
            <a
              href={typeof window !== 'undefined' ? window.location.href : '/'}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-[11px] sm:text-xs transition flex items-center gap-1.5 shadow-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{isAr ? 'فتح للتثبيت' : 'Open to Install'}</span>
            </a>
          ) : (
            <button
              type="button"
              onClick={handleInstallClick}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-[11px] sm:text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isAr ? 'تثبيت التطبيق' : 'Install App'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleDismiss}
            className="p-1 text-slate-400 hover:text-white cursor-pointer"
            title={isAr ? 'إغلاق' : 'Dismiss'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Browser / iOS Install Instructions Modal when native prompt not yet ready */}
      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="font-black text-sm text-slate-900 flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-600" />
                <span>
                  {isIOS
                    ? isAr
                      ? 'تثبيت على الآيفون (iOS)'
                      : 'Install on iPhone / iPad'
                    : isAr
                    ? 'تثبيت تطبيق مكارم الخير'
                    : 'Install Standalone App'}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-3 text-xs text-slate-700">
                <div className="flex items-center gap-2.5 p-2.5 bg-slate-50 rounded-xl">
                  <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-xs shrink-0">
                    1
                  </span>
                  <p>
                    {isAr
                      ? 'اضغط على زر المشاركة في شريط Safari:'
                      : 'Tap the Share icon at the bottom of Safari:'}
                    <Share2 className="w-4 h-4 inline-block mx-1.5 text-blue-600" />
                  </p>
                </div>

                <div className="flex items-center gap-2.5 p-2.5 bg-slate-50 rounded-xl">
                  <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-xs shrink-0">
                    2
                  </span>
                  <p>
                    {isAr
                      ? 'اختر "إضافة إلى الشاشة الرئيسية":'
                      : 'Scroll and select "Add to Home Screen":'}
                    <PlusSquare className="w-4 h-4 inline-block mx-1.5 text-emerald-600" />
                  </p>
                </div>

                <div className="flex items-center gap-2.5 p-2.5 bg-slate-50 rounded-xl">
                  <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-xs shrink-0">
                    3
                  </span>
                  <p>
                    {isAr
                      ? 'اضغط على "إضافة" ليفتح التطبيق بملء الشاشة!'
                      : 'Tap "Add" in the top right to install!'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs text-slate-700">
                <p className="text-slate-600 leading-relaxed">
                  {isAr
                    ? 'إذا ظهر "إضافة إلى الشاشة الرئيسية" بدل "تثبيت التطبيق"، استخدم متصفح Chrome وانتظر ثانيتين بعد فتح الرابط المباشر ثم اضغط قائمة المتصفح (⋮) واختر "تثبيت التطبيق" (Install app).'
                    : 'Open this store URL directly in Google Chrome (not inside an in-app preview), wait 2 seconds, then tap the Chrome menu (⋮) and choose "Install app" (or tap Download icon in address bar).'}
                </p>
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-semibold">
                  {isAr
                    ? 'ملاحظة: متصفح فيسبوك/واتساب الداخلي لا يدعم التثبيت — افتح الرابط في Chrome أولاً.'
                    : 'Note: In-app browsers (WhatsApp/Facebook) only create shortcuts. Tap ⋮ -> Open in Chrome for full app install.'}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold text-xs cursor-pointer"
            >
              {isAr ? 'فهمت، حسناً' : 'Got it'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
