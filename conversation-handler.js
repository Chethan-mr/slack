// conversation-handler.js
// SIMPLIFIED VERSION: Only provides utility functions, NO response generation
const NodeCache = require('node-cache');
const knowledgeLearner = require('./knowledge-learner');

// Initialize cache for conversations
const conversationCache = new NodeCache({ stdTTL: 3600 }); // 1 hour TTL

/**
 * Simple utility function to check if learned knowledge exists
 * @param {string} query - User's query
 * @returns {Promise<object|null>} - Learned answer or null
 */
async function checkLearnedKnowledge(query) {
  try {
    const learnedResponse = await knowledgeLearner.findLearnedAnswer(query, 'General');
    
    if (learnedResponse && learnedResponse.confidence > 0.8) {
      return learnedResponse;
    }
    
    return null;
  } catch (error) {
    console.error("Error checking learned knowledge:", error);
    return null;
  }
}

/**
 * Cache a conversation entry (for future reference)
 * @param {string} userId - User ID
 * @param {string} query - User's query
 * @param {string} response - Bot's response
 * @param {boolean} matched - Whether the response was matched
 */
function cacheConversation(userId, query, response, matched) {
  try {
    const cacheKey = `conv_${userId}_${Date.now()}`;
    conversationCache.set(cacheKey, {
      query,
      response,
      matched,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error caching conversation:', error);
  }
}

/**
 * Get recent conversations for a user (for context if needed)
 * @param {string} userId - User ID
 * @returns {Array} - Array of recent conversations
 */
function getRecentConversations(userId) {
  try {
    const allKeys = conversationCache.keys();
    const userKeys = allKeys.filter(key => key.startsWith(`conv_${userId}_`));
    
    return userKeys.map(key => conversationCache.get(key)).filter(Boolean);
  } catch (error) {
    console.error('Error getting recent conversations:', error);
    return [];
  }
}

module.exports = {
  checkLearnedKnowledge,
  cacheConversation,
  getRecentConversations
};
