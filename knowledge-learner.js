// knowledge-learner.js
// Module for reading historical conversations and building knowledge base
// FIXED: Only reads channels where the bot is a member

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
    await learnedQACollection.createIndex({ programName: 1 });
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
    // Get list of channels where the bot is a member (both public and private)
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
      // For public channels, check is_member
      // For private channels, if we can see them in the list, we're likely a member
      return channel.is_member === true || channel.is_private === true;
    });
    
    console.log(`Found ${memberChannels.length} channels where bot is a member (out of ${channelsResult.channels.length} total)`);
    
    // Process each channel where the bot is a member
    for (const channel of memberChannels) {
      console.log(`Learning from channel: ${channel.name} (${channel.id}) - ${channel.is_private ? 'Private' : 'Public'}`);
      
      try {
        // Double-check that we can access the channel before trying to read history
        try {
          await client.conversations.info({ channel: channel.id });
        } catch (accessError) {
          console.log(`Cannot access channel ${channel.name}, skipping...`);
          continue;
        }
        
        // Get conversation history
        const historyResult = await client.conversations.history({
          channel: channel.id,
          limit: 1000 // maximum allowed
        });
        
        if (!historyResult.messages || historyResult.messages.length === 0) {
          console.log(`No messages found in channel ${channel.name}`);
          continue;
        }
        
        // Group messages into Q&A pairs
        const qaGroups = identifyQAPairs(historyResult.messages, channel.id, channel.name, channel.is_private);
        
        // Store learned Q&A pairs
        if (qaGroups.length > 0) {
          const channelLearnedCount = await storeLearnedQA(qaGroups, channel.name);
          learnedCount += channelLearnedCount;
          console.log(`Learned ${channelLearnedCount} Q&A pairs from channel ${channel.name}`);
        } else {
          console.log(`No Q&A pairs found in channel ${channel.name}`);
        }
      } catch (channelError) {
        console.error(`Error learning from channel ${channel.name}:`, channelError.message);
        // Continue with next channel
      }
    }
    
    console.log(`Completed learning from channel history. Learned ${learnedCount} Q&A pairs from ${memberChannels.length} channels.`);
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
 * @param {boolean} isPrivate - Whether the channel is private
 * @returns {Array} - Array of Q&A pairs
 */
function identifyQAPairs(messages, channelId, channelName, isPrivate = false) {
  const qaGroups = [];
  let currentGroup = null;
  
  // Sort messages by timestamp (oldest first)
  const sortedMessages = [...messages].sort((a, b) => 
    parseFloat(a.ts) - parseFloat(b.ts)
  );
  
  // Extract program name from channel - prioritize private channels
  let programName = 'General';
  if (isPrivate && channelName) {
    // For private channels, extract meaningful program name
    programName = channelName
      .replace(/[-_]/g, ' ')
      .replace(/\b(databricks|announcements|general|public)\b/gi, '') // Remove common public channel terms
      .trim()
      .split(' ')
      .filter(word => word.length > 0)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ') || 'Learning Program';
  }
  // For public channels, use generic program name to avoid exposing channel names
  
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
        channelName: channelName,
        programName: programName,
        isPrivateChannel: isPrivate
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
        currentGroup.confidence = 0.9; // High confidence for our own answers
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
    
    // Set confidence score - higher for private channels
    const baseConfidence = group.confidence || 
                          (group.botAnswer ? 0.9 : 
                           (group.answers.length > 2 ? 0.8 : 0.6));
    
    // Boost confidence for private channels (more relevant context)
    const confidence = group.isPrivateChannel ? Math.min(baseConfidence + 0.1, 1.0) : baseConfidence;
    
    try {
      // Check if this Q&A pair already exists
      const existing = await learnedQACollection.findOne({
        $text: { $search: group.question },
        programName: group.programName
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
                lastUpdated: new Date(),
                isFromPrivateChannel: group.isPrivateChannel
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
          programName: group.programName,
          channelName: channelName,
          confidence: confidence,
          isFromPrivateChannel: group.isPrivateChannel,
          useCount: 1,
          createdAt: new Date(),
          lastUpdated: new Date()
        });
        storedCount++;
      }
      
      // Also add to cache
      const cacheKey = `${group.programName}:${group.question.toLowerCase().substring(0, 30)}`;
      learnedQACache.set(cacheKey, {
        answer: answer,
        confidence: confidence,
        programName: group.programName
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
      // Create a Q&A entry
      try {
        // Check if this Q&A pair already exists
        const existing = await learnedQACollection.findOne({
          $text: { $search: qa.question },
          programName: qa.programName || 'General'
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
            programName: qa.programName || 'General',
            confidence: 0.95, // High confidence for our own matched answers
            isFromPrivateChannel: qa.channelName !== 'public-channel',
            useCount: 1,
            createdAt: new Date(),
            lastUpdated: new Date()
          });
          learnedCount++;
          
          // Also add to cache
          const cacheKey = `${qa.programName || 'General'}:${qa.question.toLowerCase().substring(0, 30)}`;
          learnedQACache.set(cacheKey, {
            answer: qa.response,
            confidence: 0.95,
            programName: qa.programName || 'General'
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
 * Find answer from learned knowledge - prioritize private channel context
 * @param {string} question - User's question
 * @param {string} programName - Program context
 * @returns {Promise<object|null>} - Answer or null if not found
 */
async function findLearnedAnswer(question, programName) {
  if (!question) return null;
  
  // Check cache first
  const questionLower = question.toLowerCase();
  const cacheKey = `${programName}:${questionLower.substring(0, 30)}`;
  const cachedAnswer = learnedQACache.get(cacheKey);
  
  if (cachedAnswer && cachedAnswer.programName === programName) {
    return {
      answer: cachedAnswer.answer,
      confidence: cachedAnswer.confidence,
      source: 'cache'
    };
  }
  
  // If not in cache and MongoDB is connected, search database
  if (isConnected && learnedQACollection) {
    try {
      // Search for similar questions in this program - prioritize private channel answers
      const result = await learnedQACollection.findOne(
        {
          $text: { $search: question },
          programName: programName,
          confidence: { $gt: 0.7 } // Only use high confidence answers
        },
        {
          projection: {
            answer: 1,
            confidence: 1,
            isFromPrivateChannel: 1,
            score: { $meta: "textScore" }
          },
          sort: { 
            score: { $meta: "textScore" },
            isFromPrivateChannel: -1, // Prioritize private channel answers
            confidence: -1 
          }
        }
      );
      
      if (result && result.answer) {
        // Add to cache for future use
        learnedQACache.set(cacheKey, {
          answer: result.answer,
          confidence: result.confidence,
          programName: programName
        });
        
        // Update usage count
        await learnedQACollection.updateOne(
          { _id: result._id },
          { $inc: { useCount: 1 } }
        );
        
        return {
          answer: result.answer,
          confidence: result.confidence,
          source: result.isFromPrivateChannel ? 'database-private' : 'database-public'
        };
      }
      
      // If no match in program, try general knowledge (lower priority)
      if (programName !== 'General') {
        const generalResult = await learnedQACollection.findOne(
          {
            $text: { $search: question },
            programName: 'General',
            confidence: { $gt: 0.8 } // Higher threshold for general knowledge
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
        
        if (generalResult && generalResult.answer) {
          return {
            answer: generalResult.answer,
            confidence: generalResult.confidence * 0.9, // Slightly lower confidence for general knowledge
            source: 'database-general'
          };
        }
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
          programName: 1,
          confidence: 1,
          useCount: 1,
          isFromPrivateChannel: 1,
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
 * Search knowledge base (general search)
 * @param {string} searchTerm - Search term
 * @param {string} programName - Optional program context
 * @returns {Promise<object|null>} - Best matching answer or null
 */
async function searchKnowledgeBase(searchTerm, programName = null) {
  if (!isConnected || !learnedQACollection) {
    console.log('Cannot search: MongoDB not connected');
    return null;
  }
  
  try {
    const searchQuery = {
      $text: { $search: searchTerm }
    };
    
    // Add program filter if specified
    if (programName) {
      searchQuery.programName = programName;
    }
    
    const result = await learnedQACollection.findOne(
      searchQuery,
      {
        projection: {
          answer: 1,
          confidence: 1,
          programName: 1,
          useCount: 1,
          isFromPrivateChannel: 1,
          score: { $meta: "textScore" }
        },
        sort: { 
          score: { $meta: "textScore" },
          isFromPrivateChannel: -1, // Prioritize private channel answers
          confidence: -1 
        }
      }
    );
    
    if (result) {
      // Update usage count
      await learnedQACollection.updateOne(
        { _id: result._id },
        { $inc: { useCount: 1 } }
      );
      
      return {
        answer: result.answer,
        confidence: result.confidence,
        programName: result.programName,
        useCount: result.useCount,
        isFromPrivateChannel: result.isFromPrivateChannel
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error searching knowledge base:', error);
    return null;
  }
}

/**
 * Record a new Q&A pair from current interaction
 * @param {string} question - User's question
 * @param {string} answer - Bot's answer
 * @param {string} programName - Program context
 * @param {number} confidence - Confidence level (0-1)
 * @returns {Promise<boolean>} - Success status
 */
async function recordQAPair(question, answer, programName, confidence = 0.9) {
  if (!question || !answer || !programName) return false;
  
  // Add to cache immediately
  const cacheKey = `${programName}:${question.toLowerCase().substring(0, 30)}`;
  learnedQACache.set(cacheKey, {
    answer: answer,
    confidence: confidence,
    programName: programName
  });
  
  // Store in database if connected
  if (isConnected && learnedQACollection) {
    try {
      // Check if this Q&A pair already exists
      const existing = await learnedQACollection.findOne({
        $text: { $search: question },
        programName: programName
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
          programName: programName,
          confidence: confidence,
          isFromPrivateChannel: false, // New recordings are from current interactions
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

/**
 * Schedule periodic learning from channel history - ONLY bot member channels
 * @param {object} client - Slack client
 */
function schedulePeriodicLearning(client) {
  // Learn from channel history daily
  const LEARNING_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  
  // Initial learning (delayed to allow bot to fully start)
  setTimeout(async () => {
    console.log('Starting initial learning from bot member channels and history...');
    try {
      await learnFromChannelHistory(client);
      await learnFromBotHistory();
    } catch (error) {
      console.error('Error in initial learning:', error);
    }
  }, 5 * 60 * 1000); // 5 minutes after startup
  
  // Schedule periodic learning
  setInterval(async () => {
    console.log('Running scheduled learning from bot member channels and history...');
    try {
      await learnFromChannelHistory(client);
      await learnFromBotHistory();
    } catch (error) {
      console.error('Error in scheduled learning:', error);
    }
  }, LEARNING_INTERVAL);
}

module.exports = {
  connectToMongoDB,
  ensureIndexes,
  learnFromChannelHistory,
  learnFromBotHistory,
  findLearnedAnswer,
  recordQAPair,
  schedulePeriodicLearning,
  debugSearch,
  searchKnowledgeBase
};
