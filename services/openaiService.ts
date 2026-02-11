
import { SubtitleEntry } from "../types";

export async function translateSubtitleBatch(
  subtitles: SubtitleEntry[],
  customPrompt: string,
  apiKey: string
): Promise<{ id: number; translatedText: string }[]> {
  
  const systemInstruction = `You are a professional subtitle translator.
Your task is to translate the provided subtitle entries into Vietnamese.

STRICT RULES:
1. You MUST translate EVERY SINGLE entry provided.
2. The number of output entries MUST be EXACTLY ${subtitles.length}.
3. Maintain the exact ID for each entry.
4. If an entry's text is a name, a sound effect, or shouldn't be translated, keep the original text but STILL include the entry in the output.
5. Tone/Style: ${customPrompt || "Natural and fluent Vietnamese."}
6. RESPONSE FORMAT: You must respond with a valid JSON object containing a "translations" key which is an array of objects with "id" and "translatedText".`;

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
          { role: "user", content: `Translate these entries: ${JSON.stringify(inputData)}` }
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
      return content.translations;
    }
    
    throw new Error("Phản hồi từ AI không đúng định dạng JSON yêu cầu.");
  } catch (error: any) {
    console.error("OpenAI Error:", error);
    throw new Error(error.message || "Không thể kết nối với OpenAI.");
  }
}
