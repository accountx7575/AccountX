export interface ExtractedBillData {
  supplier_name?: string;
  bill_number?: string;
  bill_date?: string; // YYYY-MM-DD
  due_date?: string;
  items: Array<{
    name: string;
    quantity: number;
    rate: number;
    tax_rate: number;
  }>;
  notes?: string;
}

export async function extractBillDataWithGemini(file: File, apiKey: string): Promise<ExtractedBillData> {
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      resolve(res.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const mimeType = file.type || 'image/jpeg';

  const prompt = `
Extract structured purchase bill/invoice details from this document.
Return ONLY a valid JSON object matching this schema without markdown fences:
{
  "supplier_name": "Supplier or Vendor Name",
  "bill_number": "Invoice or Bill Number",
  "bill_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD",
  "items": [
    {
      "name": "Product or item description",
      "quantity": 1,
      "rate": 100,
      "tax_rate": 18
    }
  ],
  "notes": "Any payment terms or notes"
}
If any field is not found, leave it as null or empty. Ensure dates are strictly YYYY-MM-DD format.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Failed to scan bill');
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(text) as ExtractedBillData;
}