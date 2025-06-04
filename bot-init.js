// bot-init.js - Helper script to initialize the bot's knowledge base for all workspaces
const { App } = require('@slack/bolt');
const dotenv = require('dotenv');
const knowledgeLearner = require('./knowledge-learner');
const channelHandler = require('./dynamic-channel-handler');
const db = require('./db');

// Load environment variables
dotenv.config();

// Initialize bot for a specific workspace
async function initializeWorkspace(installation) {
  const workspaceId = installation.team.id;
  const workspaceName = installation.team.name;
  
  console.log(`\n=== Initializing workspace: ${workspaceName} (${workspaceId}) ===`);
  
  try {
    // Create app instance for this workspace
    const app = new App({
      token: installation.bot.token,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
    });
    
    // Learn from channel history
    console.log('Learning from channel history...');
    const learnedCount = await knowledgeLearner.learnFromChannelHistory(app.client, workspaceId);
    console.log(`Learned ${learnedCount} Q&A pairs from channel history.`);
    
    // Learn from bot history
    console.log('Learning from bot history...');
    const botLearnedCount = await knowledgeLearner.learnFromBotHistory(workspaceId);
    console.log(`Learned ${botLearnedCount} Q&A pairs from bot history.`);
    
    // Scan channels for context if handler supports workspace ID
    console.log('Scanning channels for program information and resources...');
    const channelsResult = await app.client.conversations.list({
      types: 'public_channel'
    });
    
    if (channelsResult.channels && channelsResult.channels.length > 0) {
      for (const channel of channelsResult.channels) {
        console.log(`Scanning channel: ${channel.name}`);
        // Pass workspace ID if your channel handler supports it
        if (channelHandler.scanChannelContent.length === 3) {
          await channelHandler.scanChannelContent(channel.id, app.client, workspaceId);
        } else {
          await channelHandler.scanChannelContent(channel.id, app.client);
        }
      }
    }
    
    return {
      workspace: workspaceName,
      workspaceId,
      channelHistory: learnedCount,
      botHistory: botLearnedCount,
      success: true
    };
  } catch (error) {
    console.error(`Error initializing workspace ${workspaceName}:`, error);
    return {
      workspace: workspaceName,
      workspaceId,
      error: error.message,
      success: false
    };
  }
}

// Main initialization function
async function initializeBot() {
  console.log('=== Bot Multi-Workspace Initialization ===');
  console.log(`Time: ${new Date().toISOString()}`);
  
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await db.connectToDatabase();
    
    // Connect knowledge learner
    const connected = await knowledgeLearner.connectToMongoDB(process.env.MONGODB_URI);
    if (!connected) {
      console.error('Failed to connect knowledge learner to MongoDB. Exiting.');
      process.exit(1);
    }
    
    // Check if we're in single or multi-workspace mode
    const installations = await db.getAllInstallations();
    
    if (installations.length === 0) {
      // Single workspace mode - use environment token
      if (process.env.SLACK_BOT_TOKEN) {
        console.log('No installations found. Running in single-workspace mode...');
        
        const app = new App({
          token: process.env.SLACK_BOT_TOKEN,
          signingSecret: process.env.SLACK_SIGNING_SECRET,
          socketMode: process.env.SLACK_APP_TOKEN ? true : false,
          appToken: process.env.SLACK_APP_TOKEN
        });
        
        // Initialize for single workspace
        const result = await initializeWorkspace({
          team: { id: 'default', name: 'Default Workspace' },
          bot: { token: process.env.SLACK_BOT_TOKEN }
        });
        
        console.log('\n=== Initialization Summary ===');
        if (result.success) {
          console.log(`✅ Initialized successfully`);
          console.log(`   Channel Q&As: ${result.channelHistory}`);
          console.log(`   Bot Q&As: ${result.botHistory}`);
        } else {
          console.log(`❌ Initialization failed: ${result.error}`);
        }
      } else {
        console.log('No installations found and no SLACK_BOT_TOKEN set.');
        console.log('Please either:');
        console.log('1. Install the bot to a workspace using the OAuth flow');
        console.log('2. Set SLACK_BOT_TOKEN for single-workspace mode');
      }
    } else {
      // Multi-workspace mode
      console.log(`Found ${installations.length} workspace installations.`);
      
      const results = [];
      for (const installation of installations) {
        const result = await initializeWorkspace(installation);
        results.push(result);
        
        // Small delay between workspaces
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Summary
      console.log('\n=== Initialization Summary ===');
      console.log(`Total workspaces: ${results.length}`);
      console.log(`Successful: ${results.filter(r => r.success).length}`);
      console.log(`Failed: ${results.filter(r => !r.success).length}`);
      
      results.forEach(result => {
        if (result.success) {
          console.log(`✅ ${result.workspace}: ${result.channelHistory} channel Q&As, ${result.botHistory} bot Q&As`);
        } else {
          console.log(`❌ ${result.workspace}: ${result.error}`);
        }
      });
    }
    
    console.log('\nBot initialization complete.');
    process.exit(0);
  } catch (error) {
    console.error('Error during bot initialization:', error);
    process.exit(1);
  } finally {
    await db.closeConnection();
  }
}

// Run initialization
initializeBot();
