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

const SYSTEM_PROMPT = `Kamu adalah AI yang mencatat pengeluaran dari chat casual bahasa Indonesia/Jaksel.

PARSING RULES:
1. Amount: "20k" = 20000, "1.5jt" = 1500000, "50rb" = 50000, "80ribu" = 80000
2. Jika 1 harga untuk multiple items, gabung jadi 1 expense (contoh: "bebek + jus 80k")
3. Mood: detect dari context - "nyesel", "males", "seneng", "puas", dll
4. Story: ambil reasoning/feeling dari pesan, bukan deskripsi item
5. Place: lokasi pembelian jika disebutkan
6. Date: "kemarin" = yesterday, "tadi/barusan" = today, default = today
7. Jika ada multiple expense TERPISAH dengan harga masing-masing, return multiple items

MOOD OPTIONS:
- happy, excited, satisfied (positive vibes)
- neutral (no strong emotion)
- reluctant, regret, guilty (negative vibes)

SLANG/GAUL MAPPING:
- "gw/gue/w" = saya
- "nyesel" = regret
- "males" = reluctant
- "asik/seru/mantep" = happy
- "puas/worth" = satisfied
- "k/rb/ribu" = 000
- "jt/juta" = 000000

OUTPUT FORMAT (JSON):
{
  "expenses": [{
    "amount": number,
    "item": string,
    "category": "food"|"coffee"|"transport"|"shopping"|"entertainment"|"bills"|"health"|"groceries"|"snack"|"drink"|"other",
    "place": string|null,
    "withPerson": string|null,
    "mood": string|null,
    "story": string|null,
    "date": "YYYY-MM-DD"
  }]
}

CONTOH:

Input: "beli makan bebek bakar di kantin kantor 80k udah sama minum jus tomat, mahal banget dah, nyesel beli disitu lagi, tapi enak"
Output: {"expenses":[{"amount":80000,"item":"bebek bakar + jus tomat","category":"food","place":"kantin kantor","mood":"regret","story":"mahal banget tapi enak","date":"2024-02-08"}]}

Input: "grab 45k males jalan kaki hujan"
Output: {"expenses":[{"amount":45000,"item":"grab","category":"transport","place":null,"mood":"reluctant","story":"males jalan kaki karena hujan","date":"2024-02-08"}]}

Input: "kopi 35k sama temen di starbucks seru banget ngobrolnya"
Output: {"expenses":[{"amount":35000,"item":"kopi","category":"coffee","place":"starbucks","withPerson":"temen","mood":"happy","story":"seru ngobrol","date":"2024-02-08"}]}

Input: "makan 20k"
Output: {"expenses":[{"amount":20000,"item":"makan","category":"food","place":null,"mood":null,"story":null,"date":"2024-02-08"}]}

Input: "makan 50k, kopi 25k, grab 30k"
Output: {"expenses":[{"amount":50000,"item":"makan","category":"food","place":null,"mood":null,"story":null,"date":"2024-02-08"},{"amount":25000,"item":"kopi","category":"coffee","place":null,"mood":null,"story":null,"date":"2024-02-08"},{"amount":30000,"item":"grab","category":"transport","place":null,"mood":null,"story":null,"date":"2024-02-08"}]}

Input: "kemarin kopi 35k di starbucks sama pacar"
Output: {"expenses":[{"amount":35000,"item":"kopi","category":"coffee","place":"starbucks","withPerson":"pacar","mood":null,"story":null,"date":"YESTERDAY_DATE"}]}

PENTING:
- Selalu extract expense meskipun pesan panjang/rumit
- Jika ada multiple expense terpisah dengan harga masing2, return multiple items
- Jika 1 harga untuk beberapa item (paket/bundling), gabung jadi 1 item
- Jangan return array kosong kecuali benar-benar tidak ada info expense
- "story" = emosi/alasan, bukan repeat deskripsi item`;

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
      model: "anthropic/claude-sonnet-4.5",
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

    // Extract JSON from response (Claude 4.5 sometimes wraps in markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { expenses: [], error: "No JSON in response" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as ParseResult;
    return parsed;
  } catch (error) {
    console.error("AI parsing error:", error);
    return { expenses: [], error: String(error) };
  }
}

const RECEIPT_PROMPT = `Kamu adalah AI yang membaca struk/invoice/receipt dari foto dan mengekstrak pengeluaran.

TUGAS:
1. Baca semua item dari struk/invoice
2. Extract setiap item dengan harga masing-masing
3. Detect toko/merchant dari header struk
4. Categorize setiap item

KATEGORI:
- food: makanan berat
- coffee: kopi, minuman cafe
- snack: cemilan, dessert
- drink: minuman non-kopi
- groceries: belanja bulanan, supermarket
- shopping: barang non-makanan
- transport: ojol, taxi, bensin
- entertainment: hiburan, game
- bills: tagihan, pulsa
- health: obat, apotek
- other: lainnya

OUTPUT FORMAT (JSON):
{
  "expenses": [{
    "amount": number,
    "item": string,
    "category": string,
    "place": string|null,
    "mood": null,
    "story": null,
    "date": "YYYY-MM-DD"
  }],
  "merchant": string|null,
  "total": number|null
}

CONTOH OUTPUT:
{
  "expenses": [
    {"amount": 25000, "item": "Nasi Goreng Special", "category": "food", "place": "ShopeeFood", "mood": null, "story": null, "date": "2024-02-08"},
    {"amount": 8000, "item": "Es Teh Manis", "category": "drink", "place": "ShopeeFood", "mood": null, "story": null, "date": "2024-02-08"}
  ],
  "merchant": "Warung Pak Kumis",
  "total": 33000
}

PENTING:
- Baca SEMUA item yang terlihat di struk
- Harga harus dalam Rupiah (tanpa Rp, tanpa titik)
- Jika ada ongkir/fee, masukkan sebagai item terpisah dengan category "transport"
- Jika struk tidak jelas/buram, tetap coba extract yang terbaca`;

export async function getCredits(): Promise<{ total_credits: number; total_usage: number; remaining: number } | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_MGMT_KEY}` },
    });
    if (!res.ok) return null;
    const { data } = await res.json();
    return {
      total_credits: data.total_credits,
      total_usage: data.total_usage,
      remaining: data.total_credits - data.total_usage,
    };
  } catch {
    return null;
  }
}

export async function parseReceipt(
  imageBase64: string,
  caption?: string,
  today: Date = new Date()
): Promise<ParseResult & { merchant?: string; total?: number }> {
  try {
    const todayStr = today.toISOString().split("T")[0];

    const response = await openai.chat.completions.create({
      model: "anthropic/claude-sonnet-4.5",
      messages: [
        { role: "system", content: RECEIPT_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
            {
              type: "text",
              text: `Tanggal hari ini: ${todayStr}\n\nExtract semua expense dari struk/invoice ini.${caption ? `\n\nCatatan user: ${caption}` : ""}`,
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { expenses: [], error: "No response from AI" };
    }

    // Extract JSON from response (sometimes wrapped in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { expenses: [], error: "No JSON in response" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed;
  } catch (error) {
    console.error("Receipt parsing error:", error);
    return { expenses: [], error: String(error) };
  }
}
