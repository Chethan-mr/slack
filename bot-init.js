// bot-init.js - Helper script to initialize the bot's knowledge base
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

// Connect to MongoDB
async function initializeBot() {
  try {
    console.log('Connecting to MongoDB...');
    const connected = await knowledgeLearner.connectToMongoDB(process.env.MONGODB_URI);
    
    if (!connected) {
      console.error('Failed to connect to MongoDB. Exiting.');
      process.exit(1);
    }
    
    console.log('MongoDB connected successfully. Learning from channel history...');
    
    // Learn from channel history
    const learnedCount = await knowledgeLearner.learnFromChannelHistory(app.client);
    console.log(`Learned ${learnedCount} Q&A pairs from channel history.`);
    
    // Learn from bot history
    const botLearnedCount = await knowledgeLearner.learnFromBotHistory();
    console.log(`Learned ${botLearnedCount} Q&A pairs from bot history.`);
    
    // Scan channels for context
    console.log('Scanning channels for program information and resources...');
    const channelsResult = await app.client.conversations.list({
      types: 'public_channel'
    });
    
    if (channelsResult.channels && channelsResult.channels.length > 0) {
      for (const channel of channelsResult.channels) {
        console.log(`Scanning channel: ${channel.name}`);
        await channelHandler.scanChannelContent(channel.id, app.client);
      }
    }
    
    console.log('Bot initialization complete. You can now start the main app.');
    process.exit(0);
  } catch (error) {
    console.error('Error during bot initialization:', error);
    process.exit(1);
  }
}

// Run initialization
initializeBot();
