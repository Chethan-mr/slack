// conversation-handler.js
const NodeCache = require('node-cache');
const { HfInference } = require('@huggingface/inference');
const { getKnowledgeBaseAnswer } = require('./enhanced-knowledge-base');

// Initialize cache for conversations
const conversationCache = new NodeCache({ stdTTL: 3600 }); // 1 hour TTL

// Initialize Hugging Face if API key is available
let hf = null;
if (process.env.HUGGINGFACE_API_KEY) {
  hf = new HfInference(process.env.HUGGINGFACE_API_KEY);
}

// Generate AI response if available
async function generateAIResponse(query, conversation) {
  if (!hf) {
    return null; // Hugging Face not configured
  }
  
  try {
    // Prepare conversation context for AI
    const messages = [
      { role: "system", content: "You are an educational assistant bot helping learners with their questions." },
      { role: "user", content: query }
    ];
    
    // Convert messages to a text format Hugging Face can understand
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    
    // Use a suitable conversational model
    const response = await hf.textGeneration({
      model: "google/flan-t5-large", // A good free model
      inputs: prompt,
      parameters: {
        max_new_tokens: 200,
        temperature: 0.7
      }
    });
    
    return response.generated_text;
  } catch (error) {
    console.error("Error generating AI response:", error);
    return null;
  }
}

// Rest of your conversation handler code...
