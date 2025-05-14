// conversation-handler.js
// This file manages the conversational aspects of the chatbot,
// including state tracking and contextual responses

const NodeCache = require('node-cache');
const { OpenAI } = require('openai');
const { getKnowledgeBaseAnswer } = require('./knowledge-base');
const { getKnowledgeBaseAnswer: getAnswer } = require('./enhanced-knowledge-base');

// Initialize cache for conversations
const conversationCache = new NodeCache({ stdTTL: 3600 }); // 1 hour TTL

// Initialize OpenAI if API key is available
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// Define conversation states
const CONVERSATION_STATES = {
  INITIAL: 'initial',
  ASKING_TOPIC: 'asking_topic',
  ANSWERING: 'answering',
  FEEDBACK: 'feedback',
  FOLLOWUP: 'followup'
};

// Initialize or get conversation state
function getConversationState(userId, channelId) {
  const cacheKey = `${userId}-${channelId}`;
  let conversation = conversationCache.get(cacheKey);
  
  if (!conversation) {
    conversation = {
      state: CONVERSATION_STATES.INITIAL,
      history: [],
      topic: null,
      lastQuery: null,
      lastResponse: null
    };
    conversationCache.set(cacheKey, conversation);
  }
  
  return conversation;
}

// Update conversation state
function updateConversationState(userId, channelId, updates) {
  const cacheKey = `${userId}-${channelId}`;
  const conversation = getConversationState(userId, channelId);
  
  // Apply updates
  Object.assign(conversation, updates);
  
  // Add to history if there's a query and response
  if (updates.lastQuery && updates.lastResponse) {
    conversation.history.push({
      query: updates.lastQuery,
      response: updates.lastResponse,
      timestamp: new Date().toISOString()
    });
    
    // Keep history limited to last 10 interactions
    if (conversation.history.length > 10) {
      conversation.history.shift();
    }
  }
  
  // Save updated conversation
  conversationCache.set(cacheKey, conversation);
  return conversation;
}

// Detect if the message is a greeting
function isGreeting(message) {
  const greetings = ['hi', 'hello', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening'];
  return greetings.some(greeting => message.toLowerCase().includes(greeting));
}

// Detect if the message is a thank you
function isThankYou(message) {
  const thanks = ['thank', 'thanks', 'appreciate', 'grateful'];
  return thanks.some(term => message.toLowerCase().includes(term));
}

// Detect if the message is asking for help
function isHelpRequest(message) {
  const helpTerms = ['help', 'assist', 'support', 'guide', 'how do i', 'how to'];
  return helpTerms.some(term => message.toLowerCase().includes(term));
}

// Generate AI response if available
async function generateAIResponse(query, conversation) {
  if (!openai) {
    return null; // OpenAI not configured
  }
  
  try {
    // Prepare conversation context for AI
    const messages = [
      { 
        role: "system", 
        content: `You are an educational assistant bot helping learners with their questions. 
                  Current conversation topic: ${conversation.topic || 'General learning'}. 
                  Be concise, helpful, and educational. Include examples when useful.`
      }
    ];
    
    // Add conversation history for context
    conversation.history.forEach(item => {
      messages.push({ role: "user", content: item.query });
      messages.push({ role: "assistant", content: item.response });
    });
    
    // Add current query
    messages.push({ role: "user", content: query });
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      max_tokens: 300
    });
    
    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Error generating AI response:", error);
    return null;
  }
}

// Process incoming message and generate a response
async function processMessage(message, userId, channelId) {
  // Get current conversation state
  const conversation = getConversationState(userId, channelId);
  const text = message.text || '';
  
  // Handle based on current state
  if (isGreeting(text)) {
    // Handle greetings
    const response = "Hello! 👋 I'm your learning assistant bot. How can I help you today? You can ask me about assignments, deadlines, course materials, or any other course-related questions.";
    
    updateConversationState(userId, channelId, {
      state: CONVERSATION_STATES.ASKING_TOPIC,
      lastQuery: text,
      lastResponse: response
    });
    
    return response;
  } else if (isThankYou(text)) {
    // Handle thank you messages
    const response = "You're welcome! Is there anything else I can help you with?";
    
    updateConversationState(userId, channelId, {
      state: CONVERSATION_STATES.FOLLOWUP,
      lastQuery: text,
      lastResponse: response
    });
    
    return response;
  } else if (isHelpRequest(text)) {
    // Handle help requests
    const response = "I can help with course information, assignments, deadlines, study resources, and technical issues. What specifically would you like help with?";
    
    updateConversationState(userId, channelId, {
      state: CONVERSATION_STATES.ASKING_TOPIC,
      lastQuery: text,
      lastResponse: response
    });
    
    return response;
  }
  
  // Try to get answer from knowledge base
  const knowledgeBaseAnswer = getKnowledgeBaseAnswer(text);
  
  if (knowledgeBaseAnswer) {
    // We have a predefined answer
    updateConversationState(userId, channelId, {
      state: CONVERSATION_STATES.ANSWERING,
      lastQuery: text,
      lastResponse: knowledgeBaseAnswer
    });
    
    return knowledgeBaseAnswer;
  }
  
  // Try to generate AI response
  const aiResponse = await generateAIResponse(text, conversation);
  
  if (aiResponse) {
    // We have an AI-generated response
    updateConversationState(userId, channelId, {
      state: CONVERSATION_STATES.ANSWERING,
      lastQuery: text,
      lastResponse: aiResponse
    });
    
    return aiResponse;
  }
  
  // Fallback response
  const fallbackResponse = "I'm not sure I understand that question. Could you rephrase it or ask something more specific about the course, assignments, or resources?";
  
  updateConversationState(userId, channelId, {
    state: CONVERSATION_STATES.ASKING_TOPIC,
    lastQuery: text,
    lastResponse: fallbackResponse
  });
  
  return fallbackResponse;
}

// Determine if a follow-up question would be appropriate
function shouldAskFollowUp(conversation) {
  // Don't ask follow-ups after greetings or thank-yous
  if (isGreeting(conversation.lastQuery) || isThankYou(conversation.lastQuery)) {
    return false;
  }
  
  // Ask follow-up if we've answered a question
  return conversation.state === CONVERSATION_STATES.ANSWERING;
}

// Generate a follow-up question based on conversation
function generateFollowUpQuestion(conversation) {
  const followUps = [
    "Did that answer your question?",
    "Is there anything else you'd like to know about this topic?",
    "Can I help clarify anything from my response?",
    "Do you have any follow-up questions?",
    "Was this explanation helpful?"
  ];
  
  // Choose a random follow-up
  return followUps[Math.floor(Math.random() * followUps.length)];
}

module.exports = {
  processMessage,
  getConversationState,
  updateConversationState,
  shouldAskFollowUp,
  generateFollowUpQuestion,
  CONVERSATION_STATES
};
