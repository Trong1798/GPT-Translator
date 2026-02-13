
import { GoogleGenAI, Type } from "@google/genai";
import { SubtitleEntry } from "../types";

export async function translateSubtitleBatch(
  subtitles: SubtitleEntry[],
  customPrompt: string,
  apiKey: string
): Promise<{ id: number; translatedText: string }[]> {
  
  const ai = new GoogleGenAI({ apiKey: apiKey || process.env.API_KEY || '' });
  const model = "gemini-2.5-flash";
  
  // Nâng cấp Instruction để cực kỳ khắt khe về số lượng và ID
  const systemInstruction = `
    You are a professional subtitle translator. 
    Task: Translate the following subtitle segments into Vietnamese.

    CRITICAL CONSTRAINTS:
    1. EXACT COUNT: You MUST return exactly ${subtitles.length} translated segments. Do not skip any.
    2. ID PERSISTENCE: Use the EXACT same numerical 'id' for each segment as provided in the input.
    3. NO MERGING: Do not combine multiple input segments into one. Each 'id' must have its own 'translatedText'.
    4. STYLE: ${customPrompt || "Dịch một cách tự nhiên, trôi chảy, phù hợp với ngữ cảnh phim/video."}
    5. FORMAT: Return ONLY a JSON array of objects with 'id' (integer) and 'translatedText' (string).
  `;

  const inputData = subtitles.map(s => ({ id: s.id, text: s.text }));
  const prompt = `Translate these ${subtitles.length} segments: ${JSON.stringify(inputData)}`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              translatedText: { type: Type.STRING }
            },
            required: ["id", "translatedText"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("AI không trả về nội dung.");
    
    try {
      const results = JSON.parse(text);
      
      // Kiểm tra xem AI có trả về thiếu dòng không
      if (Array.isArray(results) && results.length < subtitles.length) {
        console.warn(`AI trả về thiếu dòng: Nhận ${results.length}/${subtitles.length}`);
      }
      
      return results;
    } catch (e) {
      console.error("JSON parse error:", text);
      throw new Error("Lỗi cấu trúc dữ liệu từ AI. Đang thử lại...");
    }
  } catch (error: any) {
    console.error("Gemini Error:", error);
    if (error.message?.includes("429")) {
      throw new Error("Tần suất yêu cầu quá nhanh. Vui lòng đợi giây lát.");
    }
    throw new Error(error.message || "Lỗi kết nối AI");
  }
}
