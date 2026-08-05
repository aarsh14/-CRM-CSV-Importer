import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set in environment variables");
}

// Single shared client instance — both csvMappingService.js and
// aiService.js import this rather than each creating their own.
export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Using gemini-3.1-flash-lite: confirmed via live testing to have a far
// higher free-tier daily quota (500 RPD) than gemini-3.5-flash or
// gemini-2.5-flash (both only 20 RPD on this project) — see README
// section 10c. Good fit for structured extraction/classification tasks,
// not just quota-wise.
//export const MAPPING_MODEL = "gemini-3.1-flash-lite";
export const MAPPING_MODEL = "gemini-3.5-flash";
export const CLASSIFICATION_MODEL = "gemini-3.1-flash-lite";
