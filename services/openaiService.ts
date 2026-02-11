
import { SubtitleEntry } from "../types";

export async function translateSubtitleBatch(
  subtitles: SubtitleEntry[],
  customPrompt: string,
  apiKey: string
): Promise<{ id: number; translatedText: string }[]> {
  
  const systemInstruction = `You are an expert subtitle translator and linguist.
Your primary objective is to translate subtitle entries into Vietnamese while strictly adhering to both the user's stylistic instructions and the structural integrity of the data.

CRITICAL STRUCTURAL RULES (COMPULSORY):
1. NO SKIPPING: You MUST translate and include EVERY SINGLE entry provided in the input array.
2. EXACT COUNT: The output "translations" array MUST contain exactly ${subtitles.length} items.
3. ID MATCHING: You must return the EXACT same IDs as provided.
4. PLACEHOLDERS: If a line contains only numbers, names, or sound effects that don't need translation, return the original text but DO NOT omit the ID from the JSON.

STRICT STYLE REQUIREMENTS (USER-DEFINED):
- FOLLOW THIS STYLE: ${customPrompt || "Dịch một cách tự nhiên, trôi chảy, phù hợp ngữ cảnh văn hóa Việt Nam."}
- You must prioritize the style above for tone, vocabulary selection, and character personality.

OUTPUT SPECIFICATION:
Return ONLY a valid JSON object with this exact structure: {"translations": [{"id": number, "translatedText": string}, ...]}`;

  const inputData = subtitles.map(s => ({ id: s.id, text: s.text }));

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: `Translate these ${subtitles.length} entries according to the style rules: ${JSON.stringify(inputData)}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || "Lỗi API OpenAI");
    }

    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);
    
    if (content.translations && Array.isArray(content.translations)) {
      // Logic kiểm tra chéo số lượng dòng để đảm bảo tính toàn vẹn
      if (content.translations.length !== subtitles.length) {
        console.warn(`AI missing entries: ${content.translations.length}/${subtitles.length}`);
      }
      return content.translations;
    }
    
    throw new Error("Phản hồi từ AI không đúng cấu trúc yêu cầu.");
  } catch (error: any) {
    console.error("OpenAI Error:", error);
    throw new Error(error.message || "Không thể kết nối với OpenAI.");
  }
}
