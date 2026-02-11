
import { GoogleGenAI, Type } from "@google/genai";
import { SubtitleEntry } from "../types";

export async function translateSubtitleBatchGemini(
  subtitles: SubtitleEntry[],
  customPrompt: string,
  apiKey: string
): Promise<{ id: number; translatedText: string }[]> {
  
  const ai = new GoogleGenAI({ apiKey });
  
  const systemInstruction = `You are an expert subtitle translator.
Your task is to translate subtitle entries into Vietnamese.

STRICT STRUCTURAL RULES:
1. NO SKIPPING: Translate and include EVERY SINGLE entry. Output count MUST be exactly ${subtitles.length}.
2. ID MATCHING: Keep the original IDs.
3. FORMAT: Return a JSON object with a "translations" key.

USER STYLE: ${customPrompt || "Natural Vietnamese."}`;

  const inputData = subtitles.map(s => ({ id: s.id, text: s.text }));

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite-latest",
      contents: `Translate these entries: ${JSON.stringify(inputData)}`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            translations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.NUMBER },
                  translatedText: { type: Type.STRING }
                },
                required: ["id", "translatedText"]
              }
            }
          },
          required: ["translations"]
        }
      }
    });

    const content = JSON.parse(response.text || "{}");
    
    if (content.translations && Array.isArray(content.translations)) {
      return content.translations;
    }
    
    throw new Error("Gemini returned invalid structure.");
  } catch (error: any) {
    console.error("Gemini Error:", error);
    throw new Error(error.message || "Failed to connect to Gemini.");
  }
}
