// app.js

const { App } = require('@slack/bolt');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');
const knowledgeLearner = require('./knowledge-learner');
const channelHandler = require('./dynamic-channel-handler');
const enhancedKnowledgeBase = require('./enhanced-knowledge-base');

// Load environment variables from .env file
dotenv.config();

// MongoDB Connection Configuration
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'botlogs';
const COLLECTION_NAME = 'questions';

// MongoDB Client and collection references
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

    // Record as Q&A pair for future learning if matched
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

// Initialize Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Message handler with learned answers, simple matching, and fallback
app.message(async ({ message, say, client }) => {
  if (message.subtype === 'bot_message') return;

  console.log('Received message:', message.text);

  try {
    const text = message.text?.toLowerCase() || '';
    let response = "I'm not sure I understand that question. Could you rephrase it or ask about Zoom, ILT sessions, recordings, or the learning portal?";
    let matched = false;

    const context = await channelHandler.getMessageContext(message, client);
    const programName = context.programInfo?.programName || 'General';

    // 1. Learned answer from knowledgeLearner
    const learnedResponse = await knowledgeLearner.findLearnedAnswer(text, programName);
    if (learnedResponse && learnedResponse.confidence > 0.7) {
      response = learnedResponse.answer;
      matched = true;

      if (context.programInfo) {
        response = channelHandler.customizeResponse(response, context);
      }
    }
    else {
      // 2. Simple keyword matching from enhancedKnowledgeBase
      const simpleResponse = enhancedKnowledgeBase.getSimpleMatch(text);
      if (simpleResponse) {
        response = simpleResponse;
        matched = true;
      }
      else {
        // 3. Link response based on context
        if (context.programInfo) {
          const linkResponse = channelHandler.getLinkResponse(text, context);
          if (linkResponse) {
            response = linkResponse;
            matched = true;
          }
        }
      }
    }

    await say(response);
    console.log('Sent response:', response);

    // Log question safely
    if (isConnected) {
      try {
        let username = 'unknown';

        try {
          const userInfo = await client.users.info({ user: message.user });
          username = userInfo.user.name || userInfo.user.real_name || 'unknown';
        } catch (error) {
          if (error.data && error.data.error === 'missing_scope') {
            console.warn('Missing users:read scope; cannot fetch user info. Using "unknown" as username.');
          } else {
            throw error;
          }
        }

        let channelName = 'direct-message';
        if (message.channel.startsWith('C')) {
          try {
            const channelInfo = await client.conversations.info({ channel: message.channel });
            channelName = channelInfo.channel.name || 'unknown-channel';
          } catch (channelError) {
            console.error('Error getting channel info:', channelError);
          }
        }

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

// Start the Slack app and listen on Render's assigned port
const PORT = process.env.PORT || 3000;

(async () => {
  const dbConnected = await connectToMongoDB();
  if (dbConnected) {
    console.log('MongoDB connected successfully');
    isConnected = true;

    // Initialize any periodic tasks (optional)
    knowledgeLearner.schedulePeriodicLearning(app.client);
    channelHandler.scheduleChannelScans(app.client);

    // Initial learning (optional)
    console.log('Starting initial learning from channel history...');
    await knowledgeLearner.learnFromChannelHistory(app.client);
    await knowledgeLearner.learnFromBotHistory();
    console.log('Initial learning completed.');
  }

  await app.start(PORT);
  console.log(`⚡️ Slack Bolt app is running on port ${PORT}!`);
})();

