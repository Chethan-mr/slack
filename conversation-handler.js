// conversation-handler.js
const NodeCache = require('node-cache');
const { getKnowledgeBaseAnswer } = require('./enhanced-knowledge-base');

// Initialize cache for conversations
const conversationCache = new NodeCache({ stdTTL: 3600 }); // 1 hour TTL

// Process incoming message and generate a response
async function processMessage(message, userId, channelId) {
  // Get the text from the message
  const text = message.text || '';
  console.log('Processing message:', text);
  
  // Try to get answer from knowledge base
  const knowledgeBaseAnswer = getKnowledgeBaseAnswer(text);
  console.log('Knowledge base answer:', knowledgeBaseAnswer);
  
  if (knowledgeBaseAnswer) {
    console.log('Using knowledge base answer');
    return knowledgeBaseAnswer;
  }
  
  // Default response if no match is found
  return "I'm not sure I understand that question. Could you rephrase it or ask something more specific about the course, assignments, or resources?";
}

module.exports = {
  processMessage
};
