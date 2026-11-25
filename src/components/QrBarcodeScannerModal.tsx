import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera, QrCode, Search } from 'lucide-react';

interface QrBarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanResult: (decodedText: string) => void;
  title?: string;
  subtitle?: string;
  language: 'en' | 'ar';
}

export const QrBarcodeScannerModal: React.FC<QrBarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScanResult,
  title,
  subtitle,
  language,
}) => {
  const isAr = language === 'ar';
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = 'makarem-qr-barcode-reader';

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;
    let started = false;
    setCameraError(null);

    const startScanner = async () => {
      try {
        // Delay slightly to ensure DOM container is mounted
        await new Promise((r) => setTimeout(r, 150));
        if (isCancelled) return;
        const el = document.getElementById(containerId);
        if (!el) return;

        const scanner = new Html5Qrcode(containerId);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 240, height: 180 },
          },
          (decodedText) => {
            if (!isCancelled && decodedText) {
              isCancelled = true;
              scanner
                .stop()
                .then(() => scanner.clear())
                .catch(() => null)
                .finally(() => {
                  onScanResult(decodedText.trim());
                  onClose();
                });
            }
          },
          () => {
            // ignore frame decode misses
          }
        );
        started = true;
      } catch (err: any) {
        if (!isCancelled) {
          setCameraError(
            err?.message ||
              (isAr
                ? 'تعذر فتح الكاميرا. يمكنك استخدام قارئ الباركود اليدوي أو كتابة الرقم أدناه.'
                : 'Camera unavailable or permission denied. Use hardware scanner or enter ID/Barcode below.')
          );
        }
      }
    };

    startScanner();

    return () => {
      isCancelled = true;
      if (scannerRef.current) {
        const ref = scannerRef.current;
        scannerRef.current = null;
        if (started) {
          ref.stop().then(() => ref.clear()).catch(() => null);
        }
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    onScanResult(manualCode.trim());
    setManualCode('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
      <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-200 animate-fadeIn">
        <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm">
                {title || (isAr ? 'مسح QR أو الباركود' : 'Scan QR Code or Barcode')}
              </h3>
              <p className="text-[11px] text-slate-300">
                {subtitle ||
                  (isAr
                    ? 'وجّه الكاميرا نحو بطاقة العائلة أو استخدم جهاز المسح'
                    : 'Point camera at card QR/Barcode or use handheld scanner')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="rounded-2xl overflow-hidden bg-slate-950 border border-slate-200 min-h-[240px] flex items-center justify-center relative">
            <div id={containerId} className="w-full" />
            {cameraError && (
              <div className="p-5 text-center space-y-2 text-slate-200">
                <Camera className="w-8 h-8 mx-auto text-slate-400" />
                <p className="text-xs leading-relaxed">{cameraError}</p>
              </div>
            )}
          </div>

          <form onSubmit={handleManualSubmit} className="space-y-2">
            <label className="block text-[11px] font-bold text-slate-500">
              {isAr
                ? 'أو امسح بجهاز الباركود / أدخل الرقم مباشرة:'
                : 'Or scan with USB/Bluetooth scanner / type ID:'}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute start-3 top-2.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  autoFocus
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder={isAr ? '001 أو رقم الجوال...' : 'e.g. 001 or phone...'}
                  className="w-full ps-9 pe-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl font-mono focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-600/30"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer shrink-0"
              >
                {isAr ? 'بحث' : 'Go'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
