const { GoogleGenAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// Helper to load scenario metadata
function getScenarioMetadata(scenarioId) {
  try {
    const metaPath = path.resolve(__dirname, '..', '..', 'scenarios', scenarioId, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }
  } catch (err) {
    console.error(`Failed to load metadata for ${scenarioId}:`, err);
  }
  return null;
}

// Fallback regex matcher for deterministic results
function fallbackAnalyze(logText) {
  const text = logText.toLowerCase();

  if (text.includes('database_url') || text.includes('config_missing') || text.includes('undefined') && text.includes('database')) {
    return {
      matched: true,
      scenarioId: 'missing-config',
      confidence: 0.95,
      explanation: 'Detected missing configuration. The application is trying to access a database but the DATABASE_URL environment variable is undefined.'
    };
  }

  if (text.includes('column') && text.includes('does not exist') || text.includes('subscription')) {
    return {
      matched: true,
      scenarioId: 'db-schema',
      confidence: 0.98,
      explanation: 'Detected database schema mismatch. The application is trying to query a column ("subscription") that does not exist in the current database schema.'
    };
  }

  if (text.includes('econnrefused') || text.includes('redis') || text.includes('connection refused')) {
    return {
      matched: true,
      scenarioId: 'service-down',
      confidence: 0.92,
      explanation: 'Detected service dependency failure. The application is attempting to connect to a Redis cache instance, but the connection was refused because the Redis service is offline.'
    };
  }

  // If no match, return a default mock/fallback analysis pointing to missing-config
  return {
    matched: false,
    scenarioId: 'missing-config',
    confidence: 0.40,
    explanation: 'Could not confidently identify the error type. Falling back to the Missing Configuration scenario for demonstration purposes.'
  };
}

async function analyzeError(logText) {
  const apiKey = process.env.GEMINI_API_KEY;

  // If API key is missing or invalid, use deterministic parser
  if (!apiKey) {
    console.log('No GEMINI_API_KEY found, using deterministic pattern matching fallback.');
    const match = fallbackAnalyze(logText);
    const meta = getScenarioMetadata(match.scenarioId);
    return {
      ...meta,
      analysis: {
        ai_powered: false,
        confidence: match.confidence,
        explanation: match.explanation
      }
    };
  }

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
You are the AI engine of "IT WORKED IN PROD", a production failure reproduction assistant.
Analyze the following production error evidence (logs, stacktrace, etc.) and classify it into one of these three supported reproduction scenarios:
1. "missing-config" (Missing DATABASE_URL env var)
2. "db-schema" (Database column subscription does not exist)
3. "service-down" (Redis connection refused)

Provide the output strictly in JSON format with the following keys:
- "scenario_id": string (must be exactly "missing-config", "db-schema", or "service-down")
- "confidence": number (between 0.0 and 1.0)
- "explanation": string (explain why you mapped it to this scenario and what the root cause is)
- "suggested_fix": string (suggest how to resolve the issue)

Error evidence to analyze:
"""
${logText}
"""
    `;

    const result = await model.generateContent(prompt);
    const textResult = result.response.text().trim();
    
    // Parse JSON safely
    const cleanJsonText = textResult.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleanJsonText);

    const scenarioId = parsed.scenario_id || 'missing-config';
    const meta = getScenarioMetadata(scenarioId);

    return {
      ...meta,
      analysis: {
        ai_powered: true,
        confidence: parsed.confidence || 0.9,
        explanation: parsed.explanation || 'Analyzed successfully.',
        suggested_fix_custom: parsed.suggested_fix
      }
    };

  } catch (err) {
    console.error('LLM analysis failed, falling back to pattern matching:', err.message);
    const match = fallbackAnalyze(logText);
    const meta = getScenarioMetadata(match.scenarioId);
    return {
      ...meta,
      analysis: {
        ai_powered: false,
        confidence: match.confidence,
        explanation: match.explanation,
        error: err.message
      }
    };
  }
}

module.exports = {
  analyzeError,
  getScenarioMetadata
};
