const { App } = require('@slack/bolt');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');
const knowledgeLearner = require('./knowledge-learner');
const channelHandler = require('./dynamic-channel-handler');

// Load environment variables
dotenv.config();

// MongoDB Connection Configuration
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'botlogs';
const COLLECTION_NAME = 'questions';

// MongoDB Client
let mongoClient = null;
let questionsCollection = null;
let isConnected = false;

// Connect to MongoDB
async function connectToMongoDB() {
  if (!MONGODB_URI) {
    console.log('No MongoDB URI provided. Skipping database connection.');
    return false;
  }
  
  try {
    console.log('Connecting to MongoDB...');
    console.log('Connection string starts with:', MONGODB_URI.substring(0, 20) + '...');
    
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    console.log('Connected to MongoDB Atlas');
    
    const db = mongoClient.db(DB_NAME);
    questionsCollection = db.collection(COLLECTION_NAME);
    
    // Create indexes for better query performance
    await questionsCollection.createIndex({ timestamp: -1 });
    await questionsCollection.createIndex({ question: 'text' });
    await questionsCollection.createIndex({ userId: 1 });
    
    // Connect knowledge learner to MongoDB
    await knowledgeLearner.connectToMongoDB(MONGODB_URI);
    
    isConnected = true;
    return true;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    return false;
  }
}

// Log a question to MongoDB
async function logQuestion(userId, username, channelId, channelName, question, response, matched, programName = 'General') {
  if (!isConnected || !questionsCollection) return null;
  
  try {
    const result = await questionsCollection.insertOne({
      userId,
      username,
      channelId,
      channelName,
      programName,
      question,
      response,
      matched,
      timestamp: new Date()
    });
    
    // Also record as a Q&A pair for future learning
    if (matched) {
      await knowledgeLearner.recordQAPair(question, response, programName, 0.9);
    }
    
    console.log(`Question logged with ID: ${result.insertedId}`);
    return result.insertedId;
  } catch (error) {
    console.error('Error logging question:', error);
    return null;
  }
}

// Get frequent questions (for admin reporting)
async function getFrequentQuestions(limit = 10) {
  // Same as before
  // ...
}

// Get unanswered questions (questions that didn't match any pattern)
async function getUnansweredQuestions(limit = 10) {
  // Same as before
  // ...
}

// Get question statistics
async function getQuestionStats() {
  // Same as before
  // ...
}

// Test database connection
async function pingDatabase() {
  // Same as before
  // ...
}

// Initialize the Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Simple message handler with advanced pattern matching and learning
app.message(async ({ message, say, client }) => {
  // Skip messages from bots
  if (message.subtype === 'bot_message') return;
  
  console.log('Received message:', message.text);
  
  try {
    const text = message.text?.toLowerCase() || '';
    let response = "I'm not sure I understand that question. Could you rephrase it or ask about Zoom, ILT sessions, recordings, or the learning portal?";
    let matched = false;
    
    // Get message context from channel handler
    const context = await channelHandler.getMessageContext(message, client);
    const programName = context.programInfo?.programName || 'General';
    
    // ADMIN COMMANDS handling - unchanged
    if (text === '!dbping' && (message.user === process.env.ADMIN_USER_ID)) {
      // Same as before
      // ...
    }
    
    // Check for learned answers from previous questions
    const learnedResponse = await knowledgeLearner.findLearnedAnswer(text, programName);
    
    if (learnedResponse && learnedResponse.confidence > 0.7) {
      // Use the learned answer
      response = learnedResponse.answer;
      matched = true;
      
      // Customize with program context if available
      if (context.programInfo) {
        response = channelHandler.customizeResponse(response, context);
      }
    }
    // If no learned answer, check for resource links
    else if (context.programInfo) {
      const linkResponse = channelHandler.getLinkResponse(text, context);
      
      if (linkResponse) {
        response = linkResponse;
        matched = true;
      }
      else {
        // Existing pattern matching logic - unchanged
        // CASUAL CONVERSATION PATTERNS
        if (text.match(/\b(hi|hello|hey|greetings|howdy)\b/i)) {
          // ...existing patterns
        }
        // And so on with all existing patterns...
      }
    }
    
    // Send the response
    await say(response);
    console.log('Sent response:', response);
    
    // Log the question to MongoDB if connected
    if (isConnected) {
      try {
        // Get user info for better logging
        const userInfo = await client.users.info({ user: message.user });
        let username = 'unknown';

try {
  const userInfo = await client.users.info({ user: message.user });
  username = userInfo.user.name || userInfo.user.real_name || 'unknown';
} catch (error) {
  if (error.data && error.data.error === 'missing_scope') {
    console.warn('Missing users:read scope; cannot fetch user info. Using "unknown" as username.');
  } else {
    // Re-throw other errors so they can be handled or logged elsewhere
    throw error;
  }
}

        
        // Get channel info
        let channelName = 'direct-message';
        if (message.channel.startsWith('C')) {
          try {
            const channelInfo = await client.conversations.info({ channel: message.channel });
            channelName = channelInfo.channel.name || 'unknown-channel';
          } catch (channelError) {
            console.error('Error getting channel info:', channelError);
          }
        }
        
        // Log to MongoDB
        await logQuestion(
          message.user,
          username,
          message.channel,
          channelName,
          message.text,
          response,
          matched,
          programName
        );
      } catch (loggingError) {
        console.error('Error logging question to database:', loggingError);
      }
    }
  } catch (error) {
    console.error('Error processing message:', error);
    try {
      await say("I'm sorry, I encountered an error while processing your message. Please try again.");
    } catch (sayError) {
      console.error('Error sending error message:', sayError);
    }
  }
});

// App mention handler - modified to use learned responses
app.event('app_mention', async ({ event, say, client }) => {
  try {
    console.log('Received mention:', event.text);
    
    // Extract the actual message (remove the mention)
    const text = event.text.replace(/<@[A-Z0-9]+>/, '').trim();
    
    // If the mention contains a specific question, process it
    if (text.length > 0) {
      // Get message context
      const context = await channelHandler.getMessageContext({
        text: text,
        user: event.user,
        channel: event.channel,
        ts: event.ts
      }, client);
      
      const programName = context.programInfo?.programName || 'General';
      
      // Check for learned answers
      const learnedResponse = await knowledgeLearner.findLearnedAnswer(text, programName);
      
      let response = "I'm not sure I understand that question. Could you rephrase it or ask about Zoom, ILT sessions, recordings, or the learning portal?";
      let matched = false;
      
      if (learnedResponse && learnedResponse.confidence > 0.7) {
        // Use the learned answer
        response = learnedResponse.answer;
        matched = true;
        
        // Customize with program context if available
        if (context.programInfo) {
          response = channelHandler.customizeResponse(response, context);
        }
      }
      else {
        // Use existing pattern matching logic
        // This section remains unchanged
      }
      
      // Send the response in thread
      await say({
        text: response,
        thread_ts: event.ts
      });
      
      // Log to MongoDB if connected
      // This section remains unchanged
    } else {
      // Just a mention with no specific question
      await say({
        text: "Hi there! I'm EnquBuddy, your learning assistant for the Enqurious Databricks program. How can I help you today?",
        thread_ts: event.ts
      });
    }
  } catch (error) {
    console.error('Error processing mention:', error);
    try {
      await say({
        text: "I'm sorry, I encountered an error while processing your mention. Please try again.",
        thread_ts: event.ts
      });
    } catch (sayError) {
      console.error('Error sending error message for mention:', sayError);
    }
  }
});

// Home tab - remains largely unchanged
app.event('app_home_opened', async ({ event, client }) => {
  // Existing implementation
  // ...
});

// Define the port - use the one Render provides
const PORT = process.env.PORT || 3000;

// Start the Slack app
(async () => {
  try {
    // First try to connect to MongoDB
    const dbConnected = await connectToMongoDB();
    if (dbConnected) {
      console.log('MongoDB connected successfully');
      isConnected = true;
      
      // Initialize knowledge learner's periodic learning
      knowledgeLearner.schedulePeriodicLearning(app.client);
      
      // Initialize channel handler's periodic scanning
      channelHandler.scheduleChannelScans(app.client);
      
      // Initial learning from history
      console.log('Starting initial learning from channel history...');
      await knowledgeLearner.learnFromChannelHistory(app.client);
      await knowledgeLearner.learnFromBotHistory();
      console.log('Initial learning completed.');
    } else {
      console.warn('MongoDB connection failed, continuing without question logging');
      isConnected = false;
    }
    
    // Then start the Slack app
    await app.start(PORT);
    console.log(`⚡️ Educational Bot is running on port ${PORT}!`);
  } catch (error) {
    console.error('Error starting the app:', error);
  }
})();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  try {
    if (mongoClient) {
      await mongoClient.close();
      console.log('MongoDB connection closed');
    }
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});
