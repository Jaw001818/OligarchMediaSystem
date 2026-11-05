import { GoogleGenAI } from "@google/genai";
import { Employee } from "../types";

/**
 * Client-side Gemini fallback for AI attendance scanning.
 * Used when deploying as a static SPA to Vercel or when backend API routes are unavailable.
 */
export async function scanAttendanceClientSide(
  imageBase64: string,
  targetYear: number,
  employees: Employee[]
): Promise<any> {
  const apiKey = 
    (import.meta as any).env?.VITE_GEMINI_API_KEY || 
    (import.meta as any).env?.GEMINI_API_KEY || 
    localStorage.getItem("om_gemini_api_key") || 
    "";

  if (!apiKey) {
    throw new Error(
      "Missing Gemini API Key for Vercel deployment. Please set VITE_GEMINI_API_KEY or GEMINI_API_KEY in your Vercel Project Environment Variables."
    );
  }

  let cleanBase64 = imageBase64;
  let effectiveMime = "image/jpeg";

  if (imageBase64.startsWith("data:")) {
    const matchMime = imageBase64.match(/^data:([^;]+);base64,/);
    if (matchMime && matchMime[1]) {
      effectiveMime = matchMime[1];
    }
    cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
  }

  const knownListText = Array.isArray(employees) && employees.length > 0
    ? `Known Company Employees in System:\n${employees.map(e => `${e.fullName} (#${e.employeeNumber})`).join('\n')}`
    : "";

  const prompt = `You are a professional HR timesheet data extractor.
Analyze this attendance spreadsheet screenshot image very carefully.
Extract every employee and their attendance status for each day/date column shown in the sheet.

${knownListText}

Rules:
1. Column Headers / Dates:
   - Identify all dates in the column headers.
   - Standardize all dates to strict "YYYY-MM-DD" format.
   - If the year is not mentioned on the header, use target year ${targetYear || 2025}.
2. Row Headers / Employee Names & Nicknames:
   - "JR MALLARI" or "HERMINIO MALLARI" -> "MALLARI, HERMINIO JR L"
   - "ROLAND JHON" or "ROLAND JOHN" -> "CUBOL, ROLAND JHON G"
   - "ISRAEL" or "ISRAEL LAXA" -> "LAXA, ISRAEL P"
   - "JAO" or "JAO PANGAN" -> "PANGAN, JOEMARIE G."
   - "OSBORN" -> "LLANES, OSBORN B."
   - "LANZ" -> "CULALA, LANZ ROIE S."
   - "JOHN CEDRIC" or "CEDRIC" -> "ROQUE, JOHN CEDRIC M."
3. Status Mapping:
   - "PRESENT" -> "Present"
   - "BIRTHDAY" -> "Birthday Leave"
   - "PAID LEAVE" -> "Paid Leave"
   - "ABSENT" -> "Absent"
   - "OFF" or "REST" -> "Rest Day"

Return ONLY a valid JSON object matching this exact structure:
{
  "detectedYear": ${targetYear || 2025},
  "datesFound": ["YYYY-MM-DD"],
  "aggregatedEmployees": [
    {
      "employeeName": "NAME IN SHEET",
      "matchedCanonicalName": "OPTIONAL FULL CANONICAL NAME IF RECOGNIZED",
      "records": [
        {
          "date": "YYYY-MM-DD",
          "status": "Present",
          "hoursWorked": 8.0
        }
      ],
      "totalWorkingHours": 40
    }
  ]
}`;

  const ai = new GoogleGenAI({ apiKey });
  const modelsToTry = ["gemini-2.5-flash", "gemini-flash-latest"];
  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { mimeType: effectiveMime, data: cleanBase64 } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = response.text || "";
      if (responseText) {
        const cleaned = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(cleaned);
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`[Client-Side AI Scan] Model ${model} retry:`, err?.message);
    }
  }

  throw lastError || new Error("Failed to scan image using Gemini Vision.");
}

/**
 * Client-side Gemini fallback for spreadsheet text parsing.
 */
export async function parseSpreadsheetTextClientSide(
  rawText: string,
  targetYear: number,
  employees: Employee[]
): Promise<any> {
  const apiKey = 
    (import.meta as any).env?.VITE_GEMINI_API_KEY || 
    (import.meta as any).env?.GEMINI_API_KEY || 
    localStorage.getItem("om_gemini_api_key") || 
    "";

  if (!apiKey) {
    throw new Error(
      "Missing Gemini API Key for Vercel deployment. Please set VITE_GEMINI_API_KEY or GEMINI_API_KEY in your Vercel Project Environment Variables."
    );
  }

  const knownListText = Array.isArray(employees) && employees.length > 0
    ? `Known Company Employees in System:\n${employees.map(e => `${e.fullName} (#${e.employeeNumber})`).join('\n')}`
    : "";

  const prompt = `Parse this copied spreadsheet attendance table text into structured attendance JSON.
Target year: ${targetYear}.

${knownListText}

Return ONLY a valid JSON object matching:
{
  "detectedYear": ${targetYear},
  "datesFound": ["YYYY-MM-DD"],
  "aggregatedEmployees": [
    {
      "employeeName": "NAME IN SHEET",
      "matchedCanonicalName": "OPTIONAL FULL CANONICAL NAME IF RECOGNIZED",
      "records": [
        { "date": "YYYY-MM-DD", "status": "Present", "hoursWorked": 8.0 }
      ],
      "totalWorkingHours": 40
    }
  ]
}

Data text:
${rawText}`;

  const ai = new GoogleGenAI({ apiKey });
  const modelsToTry = ["gemini-2.5-flash", "gemini-flash-latest"];
  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = response.text || "";
      if (responseText) {
        const cleaned = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(cleaned);
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error("Failed to parse spreadsheet text using Gemini.");
}
