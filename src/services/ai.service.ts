import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { inspections, inspectionResults } from '../lib/db/schema';

/**
 * Service to handle AI-powered features using Google Gemini.
 */
export class AIService {
    constructor(private db: D1Database, private apiKey: string) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Internal helper to call Gemini API.
     */
    private async callGemini(prompt: string) {
        if (!this.apiKey || this.apiKey.includes('your_api_key')) {
            throw new Error('Gemini API Key missing');
        }

        const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.2,
                    topP: 0.8,
                    topK: 40,
                    maxOutputTokens: 1024,
                }
            })
        });

        if (!res.ok) {
            const error = await res.text();
            console.error('Gemini API Error:', error);
            throw new Error('Failed to generate content from AI');
        }

        const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
        return data.candidates[0].content.parts[0].text.trim();
    }

    /**
     * Rewrites a rough note into a professional report comment.
     */
    async generateProfessionalComment(text: string, context?: string) {
        const prompt = `You are a professional home inspector. Rewrite the following rough observation into a professional, clear, and objective report comment. 
Keep it concise but informative. 
Context: ${context || 'General inspection'}
Rough Note: "${text}"
Professional Comment:`;

        return this.callGemini(prompt);
    }

    /**
     * Generates a high-level summary of defects found in an inspection.
     */
    async generateInspectionSummary(tenantId: string, inspectionId: string) {
        const db = this.getDrizzle();

        // 1. Verify ownership and existence
        const inspection = await db.select().from(inspections).where(eq(inspections.id, inspectionId)).get();
        if (!inspection || inspection.tenantId !== tenantId) {
            throw new Error('Inspection not found or access denied');
        }

        // 2. Fetch results
        const results = await db.select().from(inspectionResults).where(eq(inspectionResults.inspectionId, inspectionId)).get();
        if (!results) return 'No significant defects observed during this inspection.';

        const data = results.data as Record<string, { status: string; notes?: string }>;
        const defects = Object.entries(data)
            .filter(([_, val]) => val.status === 'Defect')
            .map(([_, val]) => `- ${val.notes || 'No description provided'}`)
            .join('\n');

        if (!defects) return 'No significant defects observed during this inspection.';

        const prompt = `You are a professional home inspector. Analyze the following list of defects found during an inspection and provide a high-level summary (2-3 sentences) focusing on the most critical issues for the home buyer.
Defects:
${defects}
Summary:`;

        return this.callGemini(prompt);
    }
}
