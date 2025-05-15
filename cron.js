// cron.js - Scheduled tasks for regular learning and maintenance
const { App } = require('@slack/bolt');
const dotenv = require('dotenv');
const knowledgeLearner = require('./knowledge-learner');
const channelHandler = require('./dynamic-channel-handler');

// Load environment variables
dotenv.config();

// Initialize the Slack app without starting the server
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Schedule learning tasks
async function scheduledLearning() {
  try {
    console.log('Connecting to MongoDB...');
    const connected = await knowledgeLearner.connectToMongoDB(process.env.MONGODB_URI);
    
    if (!connected) {
      console.error('Failed to connect to MongoDB. Exiting.');
      process.exit(1);
    }
    
    console.log('MongoDB connected successfully. Running scheduled learning...');
    
    // Learn from channel history
    const learnedCount = await knowledgeLearner.learnFromChannelHistory(app.client);
    console.log(`Learned ${learnedCount} Q&A pairs from channel history.`);
    
    // Learn from bot history
    const botLearnedCount = await knowledgeLearner.learnFromBotHistory();
    console.log(`Learned ${botLearnedCount} Q&A pairs from bot history.`);
    
    // Scan channels for content
    console.log('Scanning channels for new content...');
    await channelHandler.scheduleChannelScans(app.client);
    
    console.log('Scheduled learning completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error during scheduled learning:', error);
    process.exit(1);
  }
}

// Run the scheduled task
scheduledLearning();
