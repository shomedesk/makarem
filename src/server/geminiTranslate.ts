import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

export interface ProductToTranslate {
  id: string;
  name: string;
  category?: string;
}

export interface TranslatedProductEntry {
  id: string;
  arabicName: string;
  arabicCategory: string;
}

export async function translateProductsWithGemini(
  items: ProductToTranslate[]
): Promise<Record<string, { arabicName: string; arabicCategory: string }>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  if (!items || items.length === 0) {
    return {};
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const results: Record<string, { arabicName: string; arabicCategory: string }> = {};
  const BATCH_SIZE = 40;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const prompt = `Translate the following Omani grocery store product names and categories from English into natural, clear, idiomatic Gulf/Omani Arabic suitable for a modern supermarket/bakkala storefront.
Keep sizes, weights, and volumes clear in Arabic (e.g., 150 GM -> ١٥٠ جم or 150 جم, ML -> مل, Ltr -> لتر, pcs -> حبة, Pack -> عبوة, Carton -> كرتون).
Keep well-known brand names accurate in Arabic script (e.g., Pepsi -> بيبسي, Indomie -> إندومي, Almarai -> المراعي, Kinza -> كينزا, Pran -> بران, Chips Oman -> شيبس عمان).
Return JSON matching the schema with each item's exact "id".

Items:
${JSON.stringify(batch)}`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              arabicName: { type: Type.STRING },
              arabicCategory: { type: Type.STRING },
            },
            required: ['id', 'arabicName', 'arabicCategory'],
          },
        },
      },
    });

    const text = response.text?.trim() || '[]';
    try {
      const parsed = JSON.parse(text) as TranslatedProductEntry[];
      for (const entry of parsed) {
        if (entry?.id && entry?.arabicName) {
          results[entry.id] = {
            arabicName: entry.arabicName.trim(),
            arabicCategory: (entry.arabicCategory || 'أصناف متنوعة').trim(),
          };
        }
      }
    } catch (parseErr) {
      console.error('Failed to parse Gemini translation batch:', parseErr);
    }
  }

  return results;
}
