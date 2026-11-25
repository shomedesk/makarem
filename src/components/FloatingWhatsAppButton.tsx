import React from 'react';
import { MessageCircle } from 'lucide-react';
import { formatWhatsAppUrl } from '../services/storeConfigService';

interface FloatingWhatsAppButtonProps {
  whatsappNumber: string;
  language: 'en' | 'ar';
  liftForCartBar?: boolean;
}

export const FloatingWhatsAppButton: React.FC<FloatingWhatsAppButtonProps> = ({
  whatsappNumber,
  language,
  liftForCartBar = false,
}) => {
  const isAr = language === 'ar';
  const defaultGreeting = isAr
    ? 'السلام عليكم، أود الاستفسار من بقالة مكارم الخير الحديثة'
    : 'Hello Makarem Al-Khair Modern Grocery, I have a question.';

  const href = formatWhatsAppUrl(whatsappNumber, defaultGreeting);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={isAr ? 'تواصل عبر واتساب' : 'Chat on WhatsApp'}
      title={isAr ? 'تواصل معنا عبر واتساب' : 'Chat with us on WhatsApp'}
      className={`fixed z-40 end-4 sm:end-6 transition-all duration-200 inline-flex items-center gap-2 rounded-full bg-[#25D366] hover:bg-[#1EBE5D] text-white shadow-lg hover:shadow-xl ring-2 ring-white px-3.5 py-3 sm:px-4 sm:py-3 font-extrabold text-xs sm:text-sm active:scale-95 ${
        liftForCartBar ? 'bottom-24 sm:bottom-24' : 'bottom-5 sm:bottom-6'
      }`}
    >
      <MessageCircle className="w-5 h-5 fill-white/15 shrink-0" />
      <span className="hidden sm:inline whitespace-nowrap">
        {isAr ? 'واتساب البقالة' : 'WhatsApp'}
      </span>
    </a>
  );
};
