const { App } = require('@slack/bolt');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');
const knowledgeLearner = require('./knowledge-learner');

// Load environment variables
dotenv.config();

// MongoDB Connection Configuration
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'botlogs';
const COLLECTION_NAME = 'questions';

// MongoDB Client
let mongoClient = null;
let questionsCollection = null;
let learnedQACollection = null;
let isConnected = false;

// Consolidated response handler - NO external dependencies that could cause conflicts
function getDirectAnswer(text) {
  const normalizedText = text.toLowerCase().trim();
  
  // EXACT QUESTION MATCHING - Only respond to very specific questions
  const exactAnswers = {
    // Greetings - CLEAN, NO PROGRAM CONTEXT
    "hi": "Hello! 👋 I'm your learning assistant bot. How can I help you today?",
    "hello": "Hello! 👋 I'm your learning assistant bot. How can I help you today?",
    "hey": "Hello! 👋 I'm your learning assistant bot. How can I help you today?",
    
    // Thanks
    "thank you": "You're welcome! Feel free to ask if you have any other questions.",
    "thanks": "You're welcome! Feel free to ask if you have any other questions.",
    "thx": "You're welcome! Feel free to ask if you have any other questions.",
    
    // Zoom joining questions
    "how can i join the zoom session": "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided in the invitation email.",
    "how do i join zoom": "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided in the invitation email.",
    "how to join zoom meeting": "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided in the invitation email.",
    "how can i join zoom": "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided in the invitation email.",
    
    // Testing audio/video
    "how can i test my audio and video": "When you open the Zoom link, you can test your microphone and camera on the preview screen before joining the meeting.",
    "how to test audio video": "When you open the Zoom link, you can test your microphone and camera on the preview screen before joining the meeting.",
    "test microphone camera": "When you open the Zoom link, you can test your microphone and camera on the preview screen before joining the meeting.",
    
    // Recording access
    "where can i find recordings": "You can access session recordings through this link: https://drive.google.com/drive/folders/1I6wXvcKTyXzxsQd19SpOmFrbIWta7vnq?usp=sharing. Recordings usually take 1-2 days to be uploaded after a session.",
    "how to access recordings": "You can access session recordings through this link: https://drive.google.com/drive/folders/1I6wXvcKTyXzxsQd19SpOmFrbIWta7vnq?usp=sharing. Recordings usually take 1-2 days to be uploaded after a session.",
    "where are session recordings": "You can access session recordings through this link: https://drive.google.com/drive/folders/1I6wXvcKTyXzxsQd19SpOmFrbIWta7vnq?usp=sharing. Recordings usually take 1-2 days to be uploaded after a session.",
    
    // Portal access
    "how to access learning portal": "You can access the learning portal at: https://www.tredence.enqurious.com/auth/login?redirect_uri=/",
    "learning portal login": "You can access the learning portal at: https://www.tredence.enqurious.com/auth/login?redirect_uri=/",
    "enqurious portal login": "You can access the learning portal at: https://www.tredence.enqurious.com/auth/login?redirect_uri=/",
    
    // Calendar access
    "where is learning calendar": "You can check the Learning calendar here: https://docs.google.com/spreadsheets/d/11kw1hvG5dLX9a6GwRd1UF_Mq9ivgCJvr-_2mtd6Z7OQ/edit?gid=0#gid=0",
    "learning calendar link": "You can check the Learning calendar here: https://docs.google.com/spreadsheets/d/11kw1hvG5dLX9a6GwRd1UF_Mq9ivgCJvr-_2mtd6Z7OQ/edit?gid=0#gid=0",
    
    // Mock test deadlines
    "can we extend the timeline for the mock test and partial mock test": "No, we cannot extend the timeline for the mock test and partial mock test. These are already being worked on by the TALL Team and can only be changed or extended upon their approval. So kindly keep up with the Learning calendar.",
    "can we extend the timeline for mock test": "No, we cannot extend the timeline for the mock test and partial mock test. These are already being worked on by the TALL Team and can only be changed or extended upon their approval. So kindly keep up with the Learning calendar.",
    "can we extend mock test deadline": "No, we cannot extend the timeline for the mock test and partial mock test. These are already being worked on by the TALL Team and can only be changed or extended upon their approval. So kindly keep up with the Learning calendar.",
    
    // What do terms mean
    "what is ilt": "ILT stands for Instructor-Led Training. These are live sessions conducted by mentors on Zoom where you can ask questions, discuss problems, and gain deeper insights.",
    "what does ilt mean": "ILT stands for Instructor-Led Training. These are live sessions conducted by mentors on Zoom where you can ask questions, discuss problems, and gain deeper insights.",
    "what is learning": "In the Learning Calendar, 'Learning' refers to self-study modules available on the Enqurious learning portal.",
    "what is assessment": "Assessment refers to mock tests to be attempted at the end of the program.",
    
    // Self-paced modules
    "can i complete modules at my own pace": "Yes, you don't have to complete self-paced modules within the given time. The time mentioned is just for your reference. You can complete the modules at your own pace.",
    "self paced modules time limit": "No, you don't have to complete self-paced modules within the given time. The time mentioned is just for your reference. You can complete the modules at your own pace.",
  };
  
  // Check for exact matches first
  if (exactAnswers[normalizedText]) {
    return exactAnswers[normalizedText];
  }
  
  // HIGH CONFIDENCE PATTERN MATCHING - Only very specific patterns
  
  // Mock test extension patterns (very specific)
  if (normalizedText.includes('extend') && 
      (normalizedText.includes('mock test') || normalizedText.includes('partial mock test')) &&
      (normalizedText.includes('timeline') || normalizedText.includes('deadline'))) {
    return "No, we cannot extend the timeline for the mock test and partial mock test. These are already being worked on by the TALL Team and can only be changed or extended upon their approval. So kindly keep up with the Learning calendar.";
  }
  
  // Zoom join patterns (very specific)
  if ((normalizedText.includes('how') && normalizedText.includes('join') && normalizedText.includes('zoom')) ||
      (normalizedText.includes('join') && normalizedText.includes('zoom') && normalizedText.includes('session'))) {
    return "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided in the invitation email.";
  }
  
  // Test audio/video patterns (very specific)
  if (normalizedText.includes('test') && 
      (normalizedText.includes('audio') || normalizedText.includes('video') || 
       normalizedText.includes('microphone') || normalizedText.includes('camera'))) {
    return "When you open the Zoom link, you can test your microphone and camera on the preview screen before joining the meeting.";
  }
  
  // Recording patterns (very specific)
  if ((normalizedText.includes('where') || normalizedText.includes('how') || normalizedText.includes('access')) &&
      (normalizedText.includes('recording') || normalizedText.includes('recordings'))) {
    return "You can access session recordings through this link: https://drive.google.com/drive/folders/1I6wXvcKTyXzxsQd19SpOmFrbIWta7vnq?usp=sharing. Recordings usually take 1-2 days to be uploaded after a session.";
  }
  
  // Portal patterns (very specific)
  if ((normalizedText.includes('portal') && normalizedText.includes('login')) ||
      (normalizedText.includes('enqurious') && normalizedText.includes('login'))) {
    return "You can access the learning portal at: https://www.tredence.enqurious.com/auth/login?redirect_uri=/";
  }
  
  // Calendar patterns (very specific)
  if (normalizedText.includes('calendar') && normalizedText.includes('learning')) {
    return "You can check the Learning calendar here: https://docs.google.com/spreadsheets/d/11kw1hvG5dLX9a6GwRd1UF_Mq9ivgCJvr-_2mtd6Z7OQ/edit?gid=0#gid=0";
  }
  
  // No confident match found
  return null;
}

// Simple channel context - NO program name extraction to avoid conflicts
async function getSimpleChannelContext(message, client) {
  try {
    let channelName = 'direct-message';
    let isPrivateChannel = false;
    
    if (message.channel && message.channel.startsWith('C')) {
      try {
        const channelInfo = await client.conversations.info({ channel: message.channel });
        isPrivateChannel = channelInfo.channel?.is_private || false;
        channelName = isPrivateChannel ? 'private-channel' : 'public-channel';
      } catch (error) {
        console.error('Error getting channel info:', error);
      }
    }
    
    return {
      channelName,
      isPrivateChannel
    };
  } catch (error) {
    console.error('Error getting simple channel context:', error);
    return {
      channelName: 'unknown',
      isPrivateChannel: false
    };
  }
}

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
    await questionsCollection.createIndex({ programName: 1 });
    
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
async function logQuestion(userId, username, channelId, channelName, question, response, matched) {
  if (!isConnected || !questionsCollection) return null;
  
  try {
    const result = await questionsCollection.insertOne({
      userId,
      username,
      channelId,
      channelName,
      question,
      response,
      matched,
      timestamp: new Date()
    });
    
    console.log(`Question logged with ID: ${result.insertedId}`);
    return result.insertedId;
  } catch (error) {
    console.error('Error logging question:', error);
    return null;
  }
}

// Get frequent questions (for admin reporting)
async function getFrequentQuestions(limit = 10) {
  if (!isConnected || !questionsCollection) return [];
  
  try {
    const questions = await questionsCollection.aggregate([
      { $group: { 
        _id: "$question", 
        count: { $sum: 1 },
        firstAsked: { $min: "$timestamp" },
        lastAsked: { $max: "$timestamp" },
        matches: { $addToSet: "$matched" }
      }},
      { $sort: { count: -1 } },
      { $limit: limit }
    ]).toArray();
    return questions;
  } catch (error) {
    console.error('Error getting frequent questions:', error);
    return [];
  }
}

// Get unanswered questions (questions that didn't match any pattern)
async function getUnansweredQuestions(limit = 10) {
  if (!isConnected || !questionsCollection) return [];
  
  try {
    const questions = await questionsCollection.aggregate([
      { $match: { matched: false } },
      { $group: { 
        _id: "$question", 
        count: { $sum: 1 },
        firstAsked: { $min: "$timestamp" },
        lastAsked: { $max: "$timestamp" }
      }},
      { $sort: { count: -1 } },
      { $limit: limit }
    ]).toArray();
    return questions;
  } catch (error) {
    console.error('Error getting unanswered questions:', error);
    return [];
  }
}

// Get question statistics
async function getQuestionStats() {
  if (!isConnected || !questionsCollection) return { total: 0, matched: 0, unmatched: 0 };
  
  try {
    const total = await questionsCollection.countDocuments();
    const matched = await questionsCollection.countDocuments({ matched: true });
    const unmatched = total - matched;
    
    return { total, matched, unmatched };
  } catch (error) {
    console.error('Error getting question stats:', error);
    return { total: 0, matched: 0, unmatched: 0 };
  }
}

// Test database connection
async function pingDatabase() {
  if (!isConnected || !mongoClient) {
    return { 
      connected: false, 
      message: "Not initialized" 
    };
  }
  
  try {
    // This command will throw an error if not connected
    await mongoClient.db().admin().ping();
    return { 
      connected: true, 
      message: "Database connection is working" 
    };
  } catch (error) {
    return { 
      connected: false, 
      message: `Connection error: ${error.message}` 
    };
  }
}

// Initialize the Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

console.log("🚀 USING CONSOLIDATED BOT VERSION - SINGLE RESPONSE, NO CONFLICTS");

// SINGLE MESSAGE HANDLER - No external modules to cause conflicts
app.message(async ({ message, say, client }) => {
  // Skip messages from bots
  if (message.subtype === 'bot_message') return;
  
  console.log('Received message:', message.text);
  
  try {
    const originalText = message.text || '';
    let response = null;
    let matched = false;
    
    // Get simple channel context (no program extraction to avoid conflicts)
    const context = await getSimpleChannelContext(message, client);
    
    // DATABASE STATUS COMMAND - only works for admin
    if (originalText.toLowerCase().trim() === '!dbping' && (message.user === process.env.ADMIN_USER_ID)) {
      const status = await pingDatabase();
      await say(`Database status: ${status.connected ? "✅" : "❌"} ${status.message}`);
      return;
    }
    
    // DEBUG COMMANDS - search and inspect the knowledge base
    if (originalText.toLowerCase().startsWith('!debug ')) {
      // Only allow admin users to use debug commands
      if (message.user === process.env.ADMIN_USER_ID) {
        const searchTerm = originalText.replace(/!debug /i, '').trim();
        try {
          const results = await knowledgeLearner.debugSearch(searchTerm);
          
          let debugResponse = `Debug results for "${searchTerm}":\n\n`;
          
          if (!results || results.length === 0) {
            debugResponse += "No matching entries found in the database.";
          } else {
            results.forEach((item, index) => {
              debugResponse += `${index + 1}. Q: ${item.question}\n`;
              debugResponse += `   A: ${item.answer.substring(0, 100)}${item.answer.length > 100 ? '...' : ''}\n`;
              debugResponse += `   Confidence: ${item.confidence}\n\n`;
            });
          }
          
          await say(debugResponse);
        } catch (error) {
          console.error('Error in debug search:', error);
          await say("Error during debug search.");
        }
        return;
      } else {
        await say("Debug commands are only available to administrators.");
        return;
      }
    }
    
    // ADMIN REPORTS
    if (originalText.toLowerCase().startsWith('!report') && (message.user === process.env.ADMIN_USER_ID)) {
      const reportType = originalText.toLowerCase().split(' ')[1] || 'frequent';
      
      if (reportType === 'frequent') {
        const questions = await getFrequentQuestions(10);
        let reportText = "*📊 Top 10 Most Frequently Asked Questions:*\n\n";
        
        if (questions.length === 0) {
          reportText = "No questions have been logged yet.";
        } else {
          questions.forEach((q, index) => {
            const wasMatched = q.matches.some(m => m === true) ? "✅" : "❌";
            reportText += `${index + 1}. ${wasMatched} "${q._id}" - Asked ${q.count} times\n`;
            reportText += `   First: ${new Date(q.firstAsked).toLocaleString()}\n`;
            reportText += `   Last: ${new Date(q.lastAsked).toLocaleString()}\n\n`;
          });
        }
        
        await say(reportText);
        return;
      } 
      else if (reportType === 'unmatched') {
        const questions = await getUnansweredQuestions(10);
        let reportText = "*❓ Top 10 Unmatched Questions:*\n\n";
        
        if (questions.length === 0) {
          reportText = "No unmatched questions found.";
        } else {
          questions.forEach((q, index) => {
            reportText += `${index + 1}. "${q._id}" - Asked ${q.count} times\n`;
            reportText += `   First: ${new Date(q.firstAsked).toLocaleString()}\n`;
            reportText += `   Last: ${new Date(q.lastAsked).toLocaleString()}\n\n`;
          });
        }
        
        await say(reportText);
        return;
      }
      else if (reportType === 'stats') {
        const stats = await getQuestionStats();
        const matchRate = stats.total > 0 ? ((stats.matched / stats.total) * 100).toFixed(2) : 0;
        
        const reportText = `*📈 Question Statistics:*\n\n` +
                          `Total Questions: ${stats.total}\n` +
                          `Matched Questions: ${stats.matched}\n` +
                          `Unmatched Questions: ${stats.unmatched}\n` +
                          `Match Rate: ${matchRate}%`;
        
        await say(reportText);
        return;
      }
    }
    
    // STEP 1: Check for high-confidence learned answers FIRST
    console.log(`Checking for learned answer...`);
    let learnedResponse = null;
    try {
      learnedResponse = await knowledgeLearner.findLearnedAnswer(originalText, 'General');
    } catch (error) {
      console.error('Error finding learned answer:', error);
    }
    
    if (learnedResponse && learnedResponse.confidence > 0.8) {
      // Use the learned answer only if confidence is high
      console.log(`Using learned answer with high confidence ${learnedResponse.confidence}`);
      response = learnedResponse.answer;
      matched = true;
    }
    
    // STEP 2: If no high-confidence learned answer, try direct pattern matching
    if (!matched) {
      console.log('No high-confidence learned answer found, checking direct patterns');
      response = getDirectAnswer(originalText);
      if (response) {
        console.log('Found direct pattern match');
        matched = true;
      }
    }
    
    // STEP 3: If no confident answer found, direct to contact person
    if (!matched) {
      console.log('No confident answer found, directing to contact person');
      response = "I'm not sure about that specific question. For assistance with questions I can't answer confidently, please contact <@abhilipsha> who can help you better.";
      matched = false;
    }
    
    // Send SINGLE response - no additional customization to avoid conflicts
    await say(response);
    console.log('Sent single response:', response);
    
    // Log the question to MongoDB if connected
    if (isConnected) {
      try {
        // Get user info for better logging
        let username = 'unknown';
        try {
          const userInfo = await client.users.info({ user: message.user });
          username = userInfo.user?.name || userInfo.user?.real_name || 'unknown';
        } catch (userInfoError) {
          console.log(`Could not get user info, using user ID: ${message.user}`);
          username = message.user || 'unknown';
        }
        
        // Log to MongoDB
        await logQuestion(
          message.user,
          username,
          message.channel,
          context.channelName,
          message.text,
          response,
          matched
        );
      } catch (loggingError) {
        console.error('Error logging question to database:', loggingError);
      }
    }
  } catch (error) {
    console.error('Error processing message:', error);
    try {
      await say("I encountered an error while processing your message. Please contact <@abhilipsha> for assistance.");
    } catch (sayError) {
      console.error('Error sending error message:', sayError);
    }
  }
});

// App mention handler - also consolidated, no conflicts
app.event('app_mention', async ({ event, say, client }) => {
  try {
    console.log('Received mention:', event.text);
    
    // Extract the actual message (remove the mention)
    const text = event.text.replace(/<@[A-Z0-9]+>/, '').trim();
    
    // If the mention contains a specific question, process it
    if (text.length > 0) {
      let learnedResponse = null;
      try {
        learnedResponse = await knowledgeLearner.findLearnedAnswer(text, 'General');
      } catch (error) {
        console.error('Error finding learned answer for mention:', error);
      }
      
      let response = "I'm not sure about that specific question. For assistance with questions I can't answer confidently, please contact <@abhilipsha> who can help you better.";
      let matched = false;
      
      if (learnedResponse && learnedResponse.confidence > 0.8) {
        console.log(`Using learned answer for mention with high confidence ${learnedResponse.confidence}`);
        response = learnedResponse.answer;
        matched = true;
      }
      else {
        // Try direct pattern matching
        const directAnswer = getDirectAnswer(text);
        if (directAnswer) {
          console.log('Found direct pattern match for mention');
          response = directAnswer;
          matched = true;
        }
      }
      
      // Send SINGLE response in thread
      await say({
        text: response,
        thread_ts: event.ts
      });
      
      // Log to MongoDB if connected
      if (isConnected) {
        try {
          let username = 'unknown';
          try {
            const userInfo = await client.users.info({ user: event.user });
            username = userInfo.user?.name || userInfo.user?.real_name || 'unknown';
          } catch (userInfoError) {
            username = event.user || 'unknown';
          }
          
          await logQuestion(
            event.user,
            username,
            event.channel,
            'mention-response',
            text,
            response,
            matched
          );
        } catch (loggingError) {
          console.error('Error logging mention to database:', loggingError);
        }
      }
    } else {
      // Just a mention with no specific question
      await say({
        text: "Hi there! I'm EnquBuddy, your learning assistant. I can help with specific questions about Zoom, recordings, learning portal, and deadlines. For other questions, please contact <@abhilipsha>.",
        thread_ts: event.ts
      });
    }
  } catch (error) {
    console.error('Error processing mention:', error);
    try {
      await say({
        text: "I encountered an error. Please contact <@abhilipsha> for assistance.",
        thread_ts: event.ts
      });
    } catch (sayError) {
      console.error('Error sending error message for mention:', sayError);
    }
  }
});

// Home tab
app.event('app_home_opened', async ({ event, client }) => {
  try {
    // Get some stats if MongoDB is connected
    let stats = { total: 0, matched: 0, unmatched: 0 };
    let matchRate = '0';
    let dbStatus = "❓ Unknown";
    
    if (isConnected) {
      try {
        const status = await pingDatabase();
        dbStatus = status.connected ? "✅ Connected" : "❌ Disconnected";
        
        if (status.connected) {
          stats = await getQuestionStats();
          matchRate = stats.total > 0 ? ((stats.matched / stats.total) * 100).toFixed(2) : '0';
        }
      } catch (dbError) {
        console.error('Error checking database status:', dbError);
        dbStatus = "❌ Error";
      }
    } else {
      dbStatus = "❌ Not Connected";
    }
    
    await client.views.publish({
      user_id: event.user,
      view: {
        "type": "home",
        "blocks": [
          {
            "type": "header",
            "text": {
              "type": "plain_text",
              "text": "Learning Assistant Bot",
              "emoji": true
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "Hello! 👋 I'm your learning assistant bot. I can help answer questions about your learning programs."
            }
          },
          {
            "type": "divider"
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*What I can help with (only specific questions):*"
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "• 💻 *Zoom issues* - joining meetings, testing audio/video\n• 📝 *Learning modules* - accessing portal, deadlines\n• 🎓 *Mock tests* - deadline extension policies\n• 📹 *Recordings* - where to find session recordings\n• 🔑 *Portal access* - learning portal login\n• 📅 *Calendar* - learning calendar access"
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*For other questions, please contact <@abhilipsha>*"
            }
          },
          {
            "type": "divider"
          },
          {
            "type": "context",
            "elements": [
              {
                "type": "mrkdwn",
                "text": `Database Status: ${dbStatus}`
              }
            ]
          },
          {
            "type": "context",
            "elements": [
              {
                "type": "mrkdwn",
                "text": `📊 Bot Statistics: ${stats.total} questions processed (${matchRate}% confident answers)`
              }
            ]
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error publishing home view:', error);
  }
});

// Define the port - use the one Render provides
const PORT = process.env.PORT || 3000;

// Start the Slack app
(async () => {
  try {
    // Add unhandled rejection handler for debugging
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
    
    // First try to connect to MongoDB
    const dbConnected = await connectToMongoDB();
    if (dbConnected) {
      console.log('MongoDB connected successfully');
      isConnected = true;
      
      // Only enable learning capabilities, no scanning to avoid conflicts
      try {
        await knowledgeLearner.ensureIndexes();
        console.log('Database indexes created successfully');
      } catch (indexError) {
        console.error('Error creating indexes:', indexError);
      }
    } else {
      console.warn('MongoDB connection failed, continuing without question logging');
      isConnected = false;
    }
    
    // Start the Slack app
    await app.start(PORT);
    console.log(`⚡️ Educational Bot is running on port ${PORT}! Consolidated version - single responses only.`);
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
