// conversation-handler.js
const NodeCache = require('node-cache');
const { HfInference } = require('@huggingface/inference');
const { getKnowledgeBaseAnswer } = require('./enhanced-knowledge-base');
const knowledgeLearner = require('./knowledge-learner');

// Initialize cache for conversations
const conversationCache = new NodeCache({ stdTTL: 3600 }); // 1 hour TTL

// Initialize Hugging Face if API key is available
let hf = null;
if (process.env.HUGGINGFACE_API_KEY) {
  hf = new HfInference(process.env.HUGGINGFACE_API_KEY);
}

// Generate AI response if available
async function generateAIResponse(query, conversation, programName = 'General') {
  // First check if we have a learned answer
  const learnedResponse = await knowledgeLearner.findLearnedAnswer(query, programName);
  
  if (learnedResponse && learnedResponse.confidence > 0.7) {
    return learnedResponse.answer;
  }

  // If no learned answer, try Hugging Face if available
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
    
    // Record this as a new Q&A pair
    if (response.generated_text) {
      await knowledgeLearner.recordQAPair(query, response.generated_text, programName, 0.8);
    }
    
    return response.generated_text;
  } catch (error) {
    console.error("Error generating AI response:", error);
    return null;
  }
}

// Get response based on conversation context
async function getContextualResponse(query, userId, channelId, client) {
  try {
    // Create a message object for context retrieval
    const message = {
      text: query,
      user: userId,
      channel: channelId
    };
    
    // Get message context from channelHandler
    const channelHandler = require('./dynamic-channel-handler');
    const context = await channelHandler.getMessageContext(message, client);
    
    // Get program name from context
    const programName = context.programInfo?.programName || 'General';
    
    // Try to find a learned answer first
    const learnedResponse = await knowledgeLearner.findLearnedAnswer(query, programName);
    
    if (learnedResponse && learnedResponse.confidence > 0.7) {
      // Customize with program context if available
      if (context.programInfo) {
        return channelHandler.customizeResponse(learnedResponse.answer, context);
      }
      return learnedResponse.answer;
    }
    
    // Check for resource links based on context
    if (context.programInfo) {
      const linkResponse = channelHandler.getLinkResponse(query, context);
      if (linkResponse) {
        return linkResponse;
      }
    }
    
    // Try knowledge base
    const kbResponse = getKnowledgeBaseAnswer(query);
    if (kbResponse) {
      // Record this for future learning
      await knowledgeLearner.recordQAPair(query, kbResponse, programName, 0.9);
      
      // Customize with program context if available
      if (context.programInfo) {
        return channelHandler.customizeResponse(kbResponse, context);
      }
      return kbResponse;
    }
    
    // Generate AI response as a last resort
    const aiResponse = await generateAIResponse(query, null, programName);
    if (aiResponse) {
      // Customize with program context if available
      if (context.programInfo) {
        return channelHandler.customizeResponse(aiResponse, context);
      }
      return aiResponse;
    }
    
    // Default fallback
    return "I'm not sure I understand that question. Could you rephrase it or ask about Zoom, ILT sessions, recordings, or the learning portal?";
  } catch (error) {
    console.error('Error getting contextual response:', error);
    return "Sorry, I encountered an error processing your request. Please try again.";
  }
}

module.exports = {
  generateAIResponse,
  getContextualResponse
};
