
import { GoogleGenAI, Type } from "@google/genai";
import { SubtitleEntry } from "../types";

export async function translateSubtitleBatchGemini(
  subtitles: SubtitleEntry[],
  customPrompt: string,
  apiKey: string,
  modelName: string = "gemini-3-flash-preview"
): Promise<{ id: number; translatedText: string }[]> {
  
  const ai = new GoogleGenAI({ apiKey });
  
  const systemInstruction = `You are an expert subtitle translator.
Your task is to translate subtitle entries into Vietnamese.

STRICT STRUCTURAL RULES:
1. NO SKIPPING: Translate and include EVERY SINGLE entry provided.
2. ID MATCHING: You must return the EXACT same IDs as provided.
3. OUTPUT FORMAT: You MUST return a valid JSON object with a "translations" key.

USER STYLE & CONTEXT: ${customPrompt || "Dịch một cách tự nhiên, trôi chảy, phù hợp ngữ cảnh Việt Nam."}`;

  const inputData = subtitles.map(s => ({ id: s.id, text: s.text }));

  const response = await ai.models.generateContent({
    model: modelName,
    contents: `Translate the following subtitle batch: ${JSON.stringify(inputData)}`,
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

  const responseText = response.text;
  if (!responseText) throw new Error("Empty response from Gemini");
  const content = JSON.parse(responseText);
  
  if (content.translations && Array.isArray(content.translations)) {
    return content.translations;
  }
  throw new Error("Invalid structure from Gemini");
}
