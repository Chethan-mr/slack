// cron.js - Scheduled tasks for regular learning and maintenance (Multi-workspace version)
const { App } = require('@slack/bolt');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');
const knowledgeLearner = require('./knowledge-learner');
const channelHandler = require('./dynamic-channel-handler');
const MongoInstallationStore = require('./installation-store');

// Load environment variables
dotenv.config();

// MongoDB client
let mongoClient = null;
let installationStore = null;

// Connect to MongoDB and get installation store
async function connectToDatabase() {
  try {
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    console.log('Connected to MongoDB');
    
    // Initialize installation store
    installationStore = new MongoInstallationStore(mongoClient);
    await installationStore.init();
    
    return true;
  } catch (error) {
    console.error('Error connecting to database:', error);
    return false;
  }
}

// Get all workspace installations
async function getAllInstallations() {
  if (!installationStore || !installationStore.collection) {
    console.error('Installation store not initialized');
    return [];
  }
  
  try {
    const installations = await installationStore.collection.find({}).toArray();
    console.log(`Found ${installations.length} workspace installations`);
    return installations;
  } catch (error) {
    console.error('Error fetching installations:', error);
    return [];
  }
}

// Create an app instance for a specific workspace
function createAppForWorkspace(installation) {
  return new App({
    token: installation.bot.token,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  });
}

// Run learning for a specific workspace
async function runLearningForWorkspace(installation) {
  const workspaceId = installation.team.id;
  const workspaceName = installation.team.name;
  
  console.log(`\n========================================`);
  console.log(`Processing workspace: ${workspaceName} (${workspaceId})`);
  console.log(`========================================`);
  
  try {
    // Create app instance for this workspace
    const workspaceApp = createAppForWorkspace(installation);
    
    // Learn from channel history for this workspace
    console.log(`Learning from channel history for ${workspaceName}...`);
    const learnedCount = await knowledgeLearner.learnFromChannelHistory(
      workspaceApp.client,
      workspaceId
    );
    console.log(`Learned ${learnedCount} Q&A pairs from channel history`);
    
    // Learn from bot history for this workspace
    console.log(`Learning from bot history for ${workspaceName}...`);
    const botLearnedCount = await knowledgeLearner.learnFromBotHistory(workspaceId);
    console.log(`Learned ${botLearnedCount} Q&A pairs from bot history`);
    
    // Scan channels for content (if your channel handler supports workspace ID)
    if (channelHandler.scheduleChannelScans) {
      console.log(`Scanning channels for new content in ${workspaceName}...`);
      await channelHandler.scheduleChannelScans(workspaceApp.client, workspaceId);
    }
    
    return {
      workspace: workspaceName,
      workspaceId: workspaceId,
      channelHistory: learnedCount,
      botHistory: botLearnedCount,
      success: true
    };
  } catch (error) {
    console.error(`Error processing workspace ${workspaceName}:`, error);
    return {
      workspace: workspaceName,
      workspaceId: workspaceId,
      error: error.message,
      success: false
    };
  }
}

// Main scheduled learning function
async function scheduledLearning() {
  console.log('=== Starting Multi-Workspace Scheduled Learning ===');
  console.log(`Time: ${new Date().toISOString()}`);
  
  try {
    // Connect to MongoDB
    const connected = await connectToDatabase();
    if (!connected) {
      console.error('Failed to connect to MongoDB. Exiting.');
      process.exit(1);
    }
    
    // Connect knowledge learner to MongoDB
    await knowledgeLearner.connectToMongoDB(process.env.MONGODB_URI);
    
    // Get all workspace installations
    const installations = await getAllInstallations();
    
    if (installations.length === 0) {
      console.log('No workspace installations found. Nothing to process.');
      process.exit(0);
    }
    
    // Process each workspace
    const results = [];
    for (const installation of installations) {
      const result = await runLearningForWorkspace(installation);
      results.push(result);
      
      // Add a small delay between workspaces to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Summary report
    console.log('\n=== Learning Summary ===');
    console.log(`Total workspaces processed: ${results.length}`);
    console.log(`Successful: ${results.filter(r => r.success).length}`);
    console.log(`Failed: ${results.filter(r => !r.success).length}`);
    
    results.forEach(result => {
      if (result.success) {
        console.log(`✅ ${result.workspace}: ${result.channelHistory} channel Q&As, ${result.botHistory} bot Q&As`);
      } else {
        console.log(`❌ ${result.workspace}: ${result.error}`);
      }
    });
    
    console.log('\nScheduled learning completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Fatal error during scheduled learning:', error);
    process.exit(1);
  } finally {
    // Clean up MongoDB connection
    if (mongoClient) {
      await mongoClient.close();
      console.log('MongoDB connection closed');
    }
  }
}

// Run the scheduled task
scheduledLearning();
