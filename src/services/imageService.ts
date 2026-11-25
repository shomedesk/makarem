import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { bumpCatalogMetaTimestamp, loadCachedFirestoreMedia } from './translationService';

export interface ProductMediaRecord {
  productId: string;
  imageUrl: string;
  updatedAt: string;
}

// Compress file to base64 data url using HTML5 Canvas
export async function compressImageFile(
  file: File,
  maxWidth = 640,
  quality = 0.85
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image element'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// Save image override to Firestore + bump catalog_meta + Backend
export async function saveProductImage(productId: string, imageUrl: string): Promise<boolean> {
  try {
    const safeId = productId.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const docRef = doc(db, 'product_media', safeId);
    await setDoc(docRef, {
      productId: safeId,
      imageUrl,
      updatedAt: new Date().toISOString(),
    });

    const cached = { ...loadCachedFirestoreMedia(), [safeId]: imageUrl };
    try {
      localStorage.setItem('makarem_fs_media_v1', JSON.stringify(cached));
    } catch {
      // ignore storage quota
    }

    await bumpCatalogMetaTimestamp();

    await fetch('/api/salesplay/update-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, imageUrl }),
    }).catch(() => null);

    return true;
  } catch (error) {
    console.error('Failed to save product image:', error);
    await fetch('/api/salesplay/update-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, imageUrl }),
    }).catch(() => null);
    return true;
  }
}
