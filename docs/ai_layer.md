# HealStep AI Layer (The "Brain")

This document details the artificial intelligence pipeline that powers HealStep's automated medical report analysis, historical comparison, and recovery plan generation.

## 1. Provider & Model
- **Provider**: OpenRouter
- **Model**: `google/gemini-2.0-flash-exp:free`
- **Why**: Gemini 2.0 Flash excels at vision tasks (reading uploaded medical reports) and fast, structured JSON generation. OpenRouter provides a unified API wrapper to interface with it seamlessly.

## 2. AI Logic & Prompt Engineering
The system utilizes a single-pass inference architecture to reduce latency and API costs. When a user uploads a new report (`/api/reports/upload`):

1. **History Retrieval**: The backend queries the `reports` table to find the user's most recent `extracted_summary`.
2. **Context Injection**: 
   - If a previous report exists, the AI is prompted with: *"Here is the patient's new report image, and their previous report text: [Historical Summary]. Compare the two and state if the condition is improving or worsening."*
   - If no history exists, it provides a standalone analysis.
3. **Plain English Requirement**: The prompt strictly asks the AI to *"explain the findings in 2-5 simple sentences using plain English (no jargon)"* to ensure the patient can easily understand their health status.

## 3. Strict JSON Formatting
To prevent the frontend UI from breaking, the AI prompt enforces a strict JSON schema using explicit instructions:
```text
You MUST return ONLY valid JSON. Do not use markdown blocks. Use this EXACT structure and keys:
{
  "simple_summary": "<your plain English summary>",
  "comparison": "<your comparison, or null if no previous report>",
  "recovery_plan": {
    "diet": ["item 1", "item 2"],
    "exercise": ["item 1"],
    "precautions": ["item 1"]
  }
}
```
The use of explicit arrays for `diet`, `exercise`, and `precautions` allows the frontend to dynamically render multi-step checklists for daily feedback tracking.

## 4. The Safety Net (`cleanAndParseJSON`)
Large Language Models occasionally wrap JSON responses in markdown code fences (e.g., ` ```json ... ``` `) or append conversational text ("Here is your recovery plan:"). To prevent `JSON.parse()` crashes, the backend employs a robust utility function:

- **Regex / Substring Extraction**: `cleanAndParseJSON(rawString)` finds the first `{` or `[` and the last `}` or `]`. It slices out everything outside these bounds, aggressively stripping out backticks and conversational fluff.
- **Safe Object Navigation**: When inserting the AI's response into PostgreSQL, the backend uses optional chaining and fallback arrays:
  ```javascript
  const diet = aiResult?.recovery_plan?.diet || aiResult?.meal_plan || ["General healthy diet"];
  ```
  This guarantees that even if the AI hallucinates a slightly different key structure, the database will never fail due to an `undefined` value, and the frontend will always receive a valid array to map over.
