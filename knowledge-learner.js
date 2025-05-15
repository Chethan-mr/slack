// knowledge-learner.js
// Module for reading historical conversations and building knowledge base

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
    
    // Create indexes for better performance
    await learnedQACollection.createIndex({ question: 'text' });
    await learnedQACollection.createIndex({ programName: 1 });
    await learnedQACollection.createIndex({ confidence: -1 });
    
    isConnected = true;
    return true;
  } catch (error) {
    console.error('Error connecting Knowledge Learner to MongoDB:', error);
    return false;
  }
}

/**
 * Learn from historical conversations in Slack
 * @param {object} client - Slack client
 * @returns {Promise<number>} - Number of Q&A pairs learned
 */
async function learnFromChannelHistory(client) {
  console.log('Starting to learn from channel history...');
  let learnedCount = 0;
  
  try {
    // Get list of all public channels
    const channelsResult = await client.conversations.list({
      types: 'public_channel'
    });
    
    if (!channelsResult.channels || channelsResult.channels.length === 0) {
      console.log('No channels found to learn from');
      return 0;
    }
    
    // Process each channel
    for (const channel of channelsResult.channels) {
      console.log(`Learning from channel: ${channel.name} (${channel.id})`);
      
      try {
        // Get conversation history
        const historyResult = await client.conversations.history({
          channel: channel.id,
          limit: 1000 // maximum allowed
        });
        
        if (!historyResult.messages || historyResult.messages.length === 0) {
          continue;
        }
        
        // Group messages into Q&A pairs
        const qaGroups = identifyQAPairs(historyResult.messages, channel.id, channel.name);
        
        // Store learned Q&A pairs
        if (qaGroups.length > 0) {
          learnedCount += await storeLearnedQA(qaGroups, channel.name);
        }
      } catch (channelError) {
        console.error(`Error learning from channel ${channel.name}:`, channelError);
        // Continue with next channel
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
  
  // Extract program name from channel
  let programName = channelName;
  // Clean up program name from channel name
  programName = programName
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  for (const message of sortedMessages) {
    // Skip bot messages except for our own bot
    if (message.subtype === 'bot_message' && !message.bot_id.includes('EnquBuddy')) {
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
        programName: programName
      };
      qaGroups.push(currentGroup);
    } 
    // If we have a current group and this is a potential answer
    else if (currentGroup && 
             (message.bot_id || // Bot answers
              message.text.includes(currentGroup.question.substring(0, 10)) || // Quoted reply
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
    
    // Set confidence score
    const confidence = group.confidence || 
                      (group.botAnswer ? 0.9 : 
                       (group.answers.length > 2 ? 0.8 : 0.6));
    
    try {
      // Check if this Q&A pair already exists
      const existing = await learnedQACollection.findOne({
        question: { $text: { $search: group.question } },
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
          programName: group.programName,
          channelName: channelName,
          confidence: confidence,
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
          question: { $text: { $search: qa.question } },
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
 * Find answer from learned knowledge
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
      // Search for similar questions in this program
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
            score: { $meta: "textScore" }
          },
          sort: { score: { $meta: "textScore" } }
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
          source: 'database'
        };
      }
      
      // If no match in program, try general knowledge
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
        question: { $text: { $search: question } },
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
 * Schedule periodic learning from channel history
 * @param {object} client - Slack client
 */
function schedulePeriodicLearning(client) {
  // Learn from channel history daily
  const LEARNING_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  
  // Initial learning
  setTimeout(async () => {
    console.log('Starting initial learning from channels and history...');
    await learnFromChannelHistory(client);
    await learnFromBotHistory();
  }, 5 * 60 * 1000); // 5 minutes after startup
  
  // Schedule periodic learning
  setInterval(async () => {
    console.log('Running scheduled learning from channels and history...');
    await learnFromChannelHistory(client);
    await learnFromBotHistory();
  }, LEARNING_INTERVAL);
}

module.exports = {
  connectToMongoDB,
  learnFromChannelHistory,
  learnFromBotHistory,
  findLearnedAnswer,
  recordQAPair,
  schedulePeriodicLearning
};
