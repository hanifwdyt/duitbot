import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

export interface ParsedExpense {
  amount: number;
  item: string;
  category: string;
  place?: string;
  withPerson?: string;
  mood?: string;
  story?: string;
  date: string; // ISO date string
}

export interface ParseResult {
  expenses: ParsedExpense[];
  error?: string;
}

const SYSTEM_PROMPT = `Kamu adalah AI assistant yang membantu mencatat pengeluaran dari pesan casual bahasa Indonesia.

Tugasmu:
1. Extract semua pengeluaran dari pesan user
2. Parse amount dalam Rupiah (20k = 20000, 1.5jt = 1500000)
3. Detect mood/emosi dari context (happy, satisfied, neutral, reluctant, regret, guilty, excited, etc)
4. Extract cerita/alasan di balik pengeluaran sebagai "story"
5. Kategorikan expense: food, coffee, transport, shopping, entertainment, bills, health, etc
6. Handle tanggal relatif: "kemarin" = yesterday, "tadi" = today, etc

Output HARUS dalam format JSON valid:
{
  "expenses": [
    {
      "amount": 35000,
      "item": "hot chocolate hazelnut",
      "category": "coffee",
      "place": "Arah Coffee",
      "withPerson": "temen kantor",
      "mood": "satisfied",
      "story": "lagi butuh me time karena kerjaan hectic",
      "date": "2024-02-07"
    }
  ]
}

Rules:
- Jika ada multiple expenses dalam 1 pesan, extract semua
- "story" adalah konteks emosional/alasan, bukan deskripsi item
- Jika tidak ada info, set null (jangan string kosong)
- Amount HARUS angka (bukan string)
- Date dalam format ISO (YYYY-MM-DD)`;

export async function parseExpense(
  message: string,
  today: Date = new Date()
): Promise<ParseResult> {
  try {
    const todayStr = today.toISOString().split("T")[0];
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const response = await openai.chat.completions.create({
      model: "anthropic/claude-3.5-haiku",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Tanggal hari ini: ${todayStr}
Tanggal kemarin: ${yesterdayStr}

Pesan user:
${message}`,
        },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { expenses: [], error: "No response from AI" };
    }

    const parsed = JSON.parse(content) as ParseResult;
    return parsed;
  } catch (error) {
    console.error("AI parsing error:", error);
    return { expenses: [], error: String(error) };
  }
}
