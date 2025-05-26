// knowledge-learner.js
// Module for reading historical conversations and building knowledge base
// CLEANED VERSION: Only handles learning and searching, NO response generation

const { MongoClient } = require('mongodb');
const NodeCache = require('node-cache');

// Cache for learned Q&A pairs
const learnedQACache = new NodeCache({ stdTTL: 24 * 60 * 60 });

// MongoDB connection info
let mongoClient = null;
let questionsCollection = null;
let learnedQACollection = null;
let isConnected = false;

/**
 * Connect to MongoDB
 * @param {string} mongoURI - MongoDB connection string
 * @returns {Promise<boolean>} - Connection success
 */
async function connectToMongoDB(mongoURI) {
  if (!mongoURI) {
    console.log('No MongoDB URI provided for knowledge learner');
    return false;
  }
  
  try {
    mongoClient = new MongoClient(mongoURI);
    await mongoClient.connect();
    console.log('Knowledge Learner connected to MongoDB');
    
    const db = mongoClient.db('botlogs');
    questionsCollection = db.collection('questions');
    learnedQACollection = db.collection('learned_qa');
    
    isConnected = true;
    return true;
  } catch (error) {
    console.error('Error connecting Knowledge Learner to MongoDB:', error);
    return false;
  }
}

/**
 * Ensure database indexes are created
 * @returns {Promise<boolean>} - Success status
 */
async function ensureIndexes() {
  if (!isConnected || !learnedQACollection) {
    console.log('Cannot create indexes: MongoDB not connected');
    return false;
  }
  
  try {
    // Create indexes for better performance
    await learnedQACollection.createIndex({ question: 'text' });
    await learnedQACollection.createIndex({ confidence: -1 });
    await learnedQACollection.createIndex({ useCount: -1 });
    await learnedQACollection.createIndex({ lastUpdated: -1 });
    
    console.log('Knowledge base indexes created successfully');
    return true;
  } catch (error) {
    console.error('Error creating knowledge base indexes:', error);
    return false;
  }
}

/**
 * Learn from historical conversations in Slack - ONLY channels where bot is a member
 * @param {object} client - Slack client
 * @returns {Promise<number>} - Number of Q&A pairs learned
 */
async function learnFromChannelHistory(client) {
  console.log('Starting to learn from channel history (bot member channels only)...');
  let learnedCount = 0;
  
  try {
    // Get list of channels where the bot is a member
    const channelsResult = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000
    });
    
    if (!channelsResult.channels || channelsResult.channels.length === 0) {
      console.log('No channels found to learn from');
      return 0;
    }
    
    // Filter to only channels where the bot is a member
    const memberChannels = channelsResult.channels.filter(channel => {
      return channel.is_member === true;
    });
    
    console.log(`Found ${memberChannels.length} channels where bot is a member`);
    
    // Process each channel where the bot is a member
    for (const channel of memberChannels) {
      console.log(`Learning from channel: ${channel.name} (${channel.is_private ? 'Private' : 'Public'})`);
      
      try {
        // Get conversation history
        const historyResult = await client.conversations.history({
          channel: channel.id,
          limit: 1000
        });
        
        if (!historyResult.messages || historyResult.messages.length === 0) {
          continue;
        }
        
        // Group messages into Q&A pairs
        const qaGroups = identifyQAPairs(historyResult.messages, channel.id, channel.name);
        
        // Store learned Q&A pairs
        if (qaGroups.length > 0) {
          const channelLearnedCount = await storeLearnedQA(qaGroups, channel.name);
          learnedCount += channelLearnedCount;
          console.log(`Learned ${channelLearnedCount} Q&A pairs from channel ${channel.name}`);
        }
      } catch (channelError) {
        console.error(`Error learning from channel ${channel.name}:`, channelError.message);
        continue;
      }
    }
    
    console.log(`Completed learning from channel history. Learned ${learnedCount} Q&A pairs.`);
    return learnedCount;
  } catch (error) {
    console.error('Error during channel history learning:', error);
    return 0;
  }
}

/**
 * Identify question-answer pairs from message history
 * @param {Array} messages - Array of Slack messages
 * @param {string} channelId - Channel ID
 * @param {string} channelName - Channel name
 * @returns {Array} - Array of Q&A pairs
 */
function identifyQAPairs(messages, channelId, channelName) {
  const qaGroups = [];
  let currentGroup = null;
  
  // Sort messages by timestamp (oldest first)
  const sortedMessages = [...messages].sort((a, b) => 
    parseFloat(a.ts) - parseFloat(b.ts)
  );
  
  for (const message of sortedMessages) {
    // Skip bot messages except for our own bot
    if (message.subtype === 'bot_message' && !message.bot_id?.includes('EnquBuddy')) {
      continue;
    }
    
    // Check if message looks like a question
    if (isLikelyQuestion(message.text) && !message.bot_id) {
      // Start a new Q&A group
      currentGroup = {
        question: message.text,
        answers: [],
        userId: message.user,
        ts: message.ts,
        channelId: channelId,
        channelName: channelName
      };
      qaGroups.push(currentGroup);
    } 
    // If we have a current group and this is a potential answer
    else if (currentGroup && 
             (message.bot_id || // Bot answers
              message.text?.includes(currentGroup.question.substring(0, 10)) || // Quoted reply
              message.thread_ts === currentGroup.ts)) { // Threaded reply
      
      // Add this as an answer to the current question
      currentGroup.answers.push({
        text: message.text,
        userId: message.user,
        isBotAnswer: !!message.bot_id,
        ts: message.ts
      });
      
      // If this is our bot's answer, prioritize it
      if (message.bot_id && message.bot_id.includes('EnquBuddy')) {
        currentGroup.botAnswer = message.text;
        currentGroup.confidence = 0.9;
      }
    }
  }
  
  // Filter out groups with no answers
  return qaGroups.filter(group => group.answers.length > 0);
}

/**
 * Check if a message is likely a question
 * @param {string} text - Message text
 * @returns {boolean} - Whether message looks like a question
 */
function isLikelyQuestion(text) {
  if (!text) return false;
  
  // Check for question marks
  if (text.includes('?')) return true;
  
  // Check for question words at the beginning
  const questionWords = ['what', 'how', 'where', 'when', 'why', 'who', 'can', 'could', 'do', 'does', 'is', 'are'];
  const firstWord = text.trim().toLowerCase().split(' ')[0];
  if (questionWords.includes(firstWord)) return true;
  
  // Check for phrases that indicate questions
  const questionPhrases = [
    'i need help', 'help me', 'looking for', 'trying to figure out',
    'can anyone', 'does anyone', 'is there', 'tell me', 'explain'
  ];
  
  return questionPhrases.some(phrase => text.toLowerCase().includes(phrase));
}

/**
 * Store learned Q&A pairs in database
 * @param {Array} qaGroups - Array of Q&A pairs
 * @param {string} channelName - Channel name for context
 * @returns {Promise<number>} - Number of Q&A pairs stored
 */
async function storeLearnedQA(qaGroups, channelName) {
  if (!isConnected || !learnedQACollection) {
    console.log('Cannot store learned Q&A: MongoDB not connected');
    return 0;
  }
  
  let storedCount = 0;
  
  for (const group of qaGroups) {
    // Skip if there's no bot answer and no clear human answer
    if (!group.botAnswer && group.answers.length < 1) continue;
    
    // Use bot answer if available, otherwise use the best human answer
    const answer = group.botAnswer || group.answers[0].text;
    
    // Set confidence score
    const confidence = group.confidence || 
                      (group.botAnswer ? 0.9 : 
                       (group.answers.length > 2 ? 0.8 : 0.6));
    
    try {
      // Check if this Q&A pair already exists
      const existing = await learnedQACollection.findOne({
        $text: { $search: group.question }
      });
      
      if (existing) {
        // Update existing entry if this one has higher confidence
        if (confidence > existing.confidence) {
          await learnedQACollection.updateOne(
            { _id: existing._id },
            { 
              $set: { 
                answer: answer,
                confidence: confidence,
                lastUpdated: new Date()
              },
              $inc: { useCount: 1 }
            }
          );
          storedCount++;
        }
      } else {
        // Insert new entry
        await learnedQACollection.insertOne({
          question: group.question,
          answer: answer,
          channelName: channelName,
          confidence: confidence,
          useCount: 1,
          createdAt: new Date(),
          lastUpdated: new Date()
        });
        storedCount++;
      }
      
      // Also add to cache
      const cacheKey = `general:${group.question.toLowerCase().substring(0, 30)}`;
      learnedQACache.set(cacheKey, {
        answer: answer,
        confidence: confidence
      });
      
    } catch (error) {
      console.error('Error storing learned Q&A:', error);
    }
  }
  
  return storedCount;
}

/**
 * Learn from the bot's own Q&A history
 * @returns {Promise<number>} - Number of Q&A pairs learned
 */
async function learnFromBotHistory() {
  if (!isConnected || !questionsCollection || !learnedQACollection) {
    console.log('Cannot learn from bot history: MongoDB not connected');
    return 0;
  }
  
  try {
    console.log('Learning from bot history...');
    let learnedCount = 0;
    
    // Get questions that received matched responses
    const matchedQuestions = await questionsCollection.find({
      matched: true
    }).limit(5000).toArray();
    
    for (const qa of matchedQuestions) {
      try {
        // Check if this Q&A pair already exists
        const existing = await learnedQACollection.findOne({
          $text: { $search: qa.question }
        });
        
        if (existing) {
          // Update existing entry
          await learnedQACollection.updateOne(
            { _id: existing._id },
            { 
              $set: { lastUpdated: new Date() },
              $inc: { useCount: 1 }
            }
          );
        } else {
          // Insert new entry
          await learnedQACollection.insertOne({
            question: qa.question,
            answer: qa.response,
            confidence: 0.95, // High confidence for our own matched answers
            useCount: 1,
            createdAt: new Date(),
            lastUpdated: new Date()
          });
          learnedCount++;
          
          // Also add to cache
          const cacheKey = `general:${qa.question.toLowerCase().substring(0, 30)}`;
          learnedQACache.set(cacheKey, {
            answer: qa.response,
            confidence: 0.95
          });
        }
      } catch (error) {
        console.error('Error learning from bot history:', error);
      }
    }
    
    console.log(`Learned ${learnedCount} new Q&A pairs from bot history`);
    return learnedCount;
  } catch (error) {
    console.error('Error in learnFromBotHistory:', error);
    return 0;
  }
}

/**
 * Find answer from learned knowledge - ONLY returns data, no response customization
 * @param {string} question - User's question
 * @param {string} programName - Program context (ignored to avoid conflicts)
 * @returns {Promise<object|null>} - Answer or null if not found
 */
async function findLearnedAnswer(question, programName = 'General') {
  if (!question) return null;
  
  // Check cache first
  const questionLower = question.toLowerCase();
  const cacheKey = `general:${questionLower.substring(0, 30)}`;
  const cachedAnswer = learnedQACache.get(cacheKey);
  
  if (cachedAnswer) {
    return {
      answer: cachedAnswer.answer,
      confidence: cachedAnswer.confidence,
      source: 'cache'
    };
  }
  
  // If not in cache and MongoDB is connected, search database
  if (isConnected && learnedQACollection) {
    try {
      // Search for similar questions with high confidence only
      const result = await learnedQACollection.findOne(
        {
          $text: { $search: question },
          confidence: { $gt: 0.7 }
        },
        {
          projection: {
            answer: 1,
            confidence: 1,
            score: { $meta: "textScore" }
          },
          sort: { score: { $meta: "textScore" } }
        }
      );
      
      if (result && result.answer) {
        // Add to cache for future use
        learnedQACache.set(cacheKey, {
          answer: result.answer,
          confidence: result.confidence
        });
        
        // Update usage count
        await learnedQACollection.updateOne(
          { _id: result._id },
          { $inc: { useCount: 1 } }
        );
        
        return {
          answer: result.answer,
          confidence: result.confidence,
          source: 'database'
        };
      }
    } catch (error) {
      console.error('Error finding learned answer:', error);
    }
  }
  
  return null;
}

/**
 * Search knowledge base for debugging purposes
 * @param {string} searchTerm - Search term
 * @returns {Promise<Array>} - Array of matching Q&A pairs
 */
async function debugSearch(searchTerm) {
  if (!isConnected || !learnedQACollection) {
    console.log('Cannot search: MongoDB not connected');
    return [];
  }
  
  try {
    const results = await learnedQACollection.find(
      {
        $text: { $search: searchTerm }
      },
      {
        projection: {
          question: 1,
          answer: 1,
          confidence: 1,
          useCount: 1,
          score: { $meta: "textScore" }
        },
        sort: { score: { $meta: "textScore" } }
      }
    ).limit(10).toArray();
    
    return results;
  } catch (error) {
    console.error('Error in debug search:', error);
    return [];
  }
}

/**
 * Record a new Q&A pair from current interaction
 * @param {string} question - User's question
 * @param {string} answer - Bot's answer
 * @param {string} programName - Program context (ignored to avoid conflicts)
 * @param {number} confidence - Confidence level (0-1)
 * @returns {Promise<boolean>} - Success status
 */
async function recordQAPair(question, answer, programName = 'General', confidence = 0.9) {
  if (!question || !answer) return false;
  
  // Add to cache immediately
  const cacheKey = `general:${question.toLowerCase().substring(0, 30)}`;
  learnedQACache.set(cacheKey, {
    answer: answer,
    confidence: confidence
  });
  
  // Store in database if connected
  if (isConnected && learnedQACollection) {
    try {
      // Check if this Q&A pair already exists
      const existing = await learnedQACollection.findOne({
        $text: { $search: question }
      });
      
      if (existing) {
        // Update existing entry
        await learnedQACollection.updateOne(
          { _id: existing._id },
          { 
            $set: { lastUpdated: new Date() },
            $inc: { useCount: 1 }
          }
        );
      } else {
        // Insert new entry
        await learnedQACollection.insertOne({
          question: question,
          answer: answer,
          confidence: confidence,
          useCount: 1,
          createdAt: new Date(),
          lastUpdated: new Date()
        });
      }
      
      return true;
    } catch (error) {
      console.error('Error recording Q&A pair:', error);
    }
  }
  
  return false;
}

module.exports = {
  connectToMongoDB,
  ensureIndexes,
  learnFromChannelHistory,
  learnFromBotHistory,
  findLearnedAnswer,
  recordQAPair,
  debugSearch
};
