const { App } = require('@slack/bolt');
const dotenv = require('dotenv');
const http = require('http');
const { MongoClient } = require('mongodb');

// Load environment variables
dotenv.config();

// MongoDB Connection Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://chethan:<db_password>@enqubuddylogs.skgbxpu.mongodb.net/?retryWrites=true&w=majority&appName=EnquBuddyLogs';
const DB_NAME = 'botlogs';
const COLLECTION_NAME = 'questions';

// MongoDB Client
let mongoClient = null;
let questionsCollection = null;

// Connect to MongoDB
async function connectToMongoDB() {
  try {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    console.log('Connected to MongoDB Atlas');
    
    const db = mongoClient.db(DB_NAME);
    questionsCollection = db.collection(COLLECTION_NAME);
    
    // Create indexes for better query performance
    await questionsCollection.createIndex({ timestamp: -1 });
    await questionsCollection.createIndex({ question: 1 });
    await questionsCollection.createIndex({ userId: 1 });
    
    return true;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    return false;
  }
}

// Log a question to MongoDB
async function logQuestion(userId, username, channelId, channelName, question, response, matched) {
  if (!questionsCollection) return;
  
  try {
    const result = await questionsCollection.insertOne({
      userId,
      username,
      channelId,
      channelName,
      question,
      response,
      matched, // Whether a specific pattern was matched or fallback was used
      timestamp: new Date()
    });
    console.log(`Question logged with ID: ${result.insertedId}`);
  } catch (error) {
    console.error('Error logging question:', error);
  }
}

// Get frequent questions (for admin reporting)
async function getFrequentQuestions(limit = 10) {
  if (!questionsCollection) return [];
  
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
  if (!questionsCollection) return [];
  
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
  if (!questionsCollection) return { total: 0, matched: 0, unmatched: 0 };
  
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
  if (!mongoClient) {
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

// Simple message handler with advanced pattern matching
app.message(async ({ message, say, client }) => {
  // Skip messages from bots
  if (message.subtype === 'bot_message') return;
  
  console.log('Received message:', message.text);
  
  try {
    const text = message.text?.toLowerCase() || '';
    let response = "I'm not sure I understand that question. Could you rephrase it or ask about Zoom, ILT sessions, recordings, or the learning portal?";
    let matched = false;
    
    // DATABASE STATUS COMMAND - only works for admin
    if (text === '!dbping' && (message.user === process.env.ADMIN_USER_ID)) {
      const status = await pingDatabase();
      await say(`Database status: ${status.connected ? "✅" : "❌"} ${status.message}`);
      return;
    }
    
    // ADMIN COMMANDS - only work for specific admin users
    if (text.startsWith('!report') && (message.user === process.env.ADMIN_USER_ID)) {
      const reportType = text.split(' ')[1]?.toLowerCase() || 'frequent';
      
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
    
    // CASUAL CONVERSATION PATTERNS
    if (text.match(/\b(hi|hello|hey|greetings|howdy)\b/i)) {
      response = "Hello! 👋 I'm your learning assistant bot. How can I help you today with the Enqurious Databricks program?";
      matched = true;
    }
    else if (text.match(/\b(how are you|how you doing|how's it going|how are things|what's up)\b/i)) {
      response = "I'm doing well, thanks for asking! I'm here to help with any questions about the Enqurious Databricks program. What can I assist you with today?";
      matched = true;
    }
    else if (text.match(/\b(thank|thanks|thx|ty)\b/i)) {
      response = "You're welcome! Feel free to ask if you have any other questions.";
      matched = true;
    }
    else if (text.match(/\b(who are you|what are you|what do you do|tell me about you)\b/i)) {
      response = "I'm EnquBuddy, an assistant bot for the Enqurious Client Programs - Databricks course. I can help answer questions about Zoom sessions, recordings, learning modules, and more!";
      matched = true;
    }
    
    // ZOOM RELATED PATTERNS
    else if (text.match(/\b(zoom)\b/i) && text.match(/\b(login|log in|loggin|signin|sign in|cannot access|can't access)\b/i)) {
      response = "If you're having trouble logging into Zoom, double-check your credentials, reset your password if necessary, and ensure you're using the correct email associated with your account.";
      matched = true;
    } 
    else if (text.match(/\b(zoom)\b/i) && text.match(/\b(join|access|attend|enter)\b/i) && text.match(/\b(meeting|session)\b/i)) {
      response = "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided.";
      matched = true;
    }
    else if (text.match(/\b(zoom)\b/i) && text.match(/\b(personal|email|mail)\b/i)) {
      response = "It's recommended to use your official email for attendance tracking and access to recordings. If you want to change your Zoom email, log into your Zoom account settings and update your email address. Make sure to verify the new email.";
      matched = true;
    }
    else if (text.match(/\b(error|message)\b/i) && text.match(/\b(authorized|registrants|only)\b/i)) {
      response = "If you see an error message like 'This meeting is for authorized registrants only,' confirm that you're using the correct email and that it matches your registration.";
      matched = true;
    }
    else if (text.match(/\b(connectivity|connection|technical|issue|problem)\b/i) && text.match(/\b(zoom|during|session)\b/i)) {
      response = "If you experience connectivity issues during a Zoom session, check your internet connection and try rejoining the meeting. If issues persist, you may need to switch to a different network. For immediate assistance, reach out in the Slack group.";
      matched = true;
    }
    
    // RECORDING RELATED PATTERNS
    else if (text.match(/\b(recording|recordings|recorded|record)\b/i) && text.match(/\b(where|how|access|find|view|watch)\b/i)) {
      response = "Meeting recordings are usually uploaded to a shared drive after the session. Check the Slack Canvas Bookmarks for the link to the drive. Recordings typically take 1-2 days to be uploaded.";
      matched = true;
    }
    else if (text.match(/\b(recording|recordings)\b/i) && text.match(/\b(today|recent|latest|yesterday|this week)\b/i)) {
      response = "Session recordings usually take 1-2 days to be uploaded. If you still can't find a recent recording after 2 days, please inform your mentor or drop a message in the Slack group.";
      matched = true;
    }
    
    // LEARNING & MODULES PATTERNS
    else if (text.match(/\b(learning|module|modules|self-paced|self paced)\b/i) && text.match(/\b(access|find|where|how)\b/i)) {
      response = "You can access self-paced modules by logging into the Enqurious learning portal here: https://www.tredence.enqurious.com/auth/login?redirect_uri=/. Simply click on a topic to access its content and start learning.";
      matched = true;
    }
    else if (text.match(/\b(complete|finish|time|hours|days)\b/i) && text.match(/\b(module|modules|self-paced|self paced)\b/i)) {
      response = "No, you don't have to complete self-paced modules within the given time. The time mentioned is just for your reference. You can complete the modules at your own pace.";
      matched = true;
    }
    else if (text.match(/\b(what|mean)\b/i) && text.match(/\b(ilt|learning|assessment)\b/i)) {
      response = "Here's what each term in the Learning Calendar means:\n1. Learning: Self-study modules available on the Enqurious learning portal\n2. ILT (Instructor-Led Training): Live sessions conducted by mentors on Zoom where you can ask questions, discuss problems, and gain deeper insights\n3. Assessment: Mock tests to be attempted at the end of the program";
      matched = true;
    }
    
    // DEADLINE & ASSESSMENT PATTERNS
    else if (text.match(/\b(miss|extend|extension|deadline)\b/i) && text.match(/\b(practice|assignment|submission|test)\b/i)) {
      response = "Generally, deadlines are strict, but you can ask if extensions are possible by contacting the program coordinator. Note that for mock tests and partial mock tests, we cannot extend the timeline as these are already being worked on by the TALL Team and can only be changed upon their approval. So kindly keep up with the Learning calendar.";
      matched = true;
    }
    else if (text.match(/\b(check|know|find|see)\b/i) && text.match(/\b(ilt|schedule|calendar)\b/i)) {
      response = "You can visit the Learning calendar here: https://docs.google.com/spreadsheets/d/11kw1hvG5dLX9a6GwRd1UF_Mq9ivgCJvr-_2mtd6Z7OQ/edit?gid=0#gid=0 and check if you have any ILTs on a specific date.";
      matched = true;
    }
    
    // PORTAL & ACCESS PATTERNS
    else if (text.match(/\b(portal|enqurious)\b/i) && text.match(/\b(login|access|credential)\b/i)) {
      response = "To access the Enqurious Portal, navigate to the login page (https://www.tredence.enqurious.com/auth/login), enter the credentials provided in your company email, and upon successful login, you can change your password and username.";
      matched = true;
    }
    else if (text.match(/\b(issue|problem|trouble|help|can't|cannot|unable)\b/i) && text.match(/\b(login|logging|sign in|access)\b/i) && text.match(/\b(portal|enqurious)\b/i)) {
      response = "If you're having trouble logging into the Enqurious Portal, here are some troubleshooting steps:\n\n1. Make sure you're using the correct URL: https://www.tredence.enqurious.com/auth/login\n2. Double-check that you're using the exact credentials provided in your company email\n3. Clear your browser cache or try using an incognito/private browsing window\n4. Try a different browser (Chrome or Firefox recommended)\n5. If you've forgotten your password, use the 'Forgot Password' option on the login page";
      matched = true;
    }
    else if (text.match(/\b(gmail|google|access)\b/i) && text.match(/\b(account|requiring|asking)\b/i)) {
      response = "If you're having trouble accessing resources that require a Gmail account, try accessing them from an incognito tab in your browser.";
      matched = true;
    }
    
    // HELP DESK PATTERNS
    else if (text.match(/\b(help desk|helpdesk|support desk)\b/i)) {
      response = "There is a Help desk app available in Slack, but direct messaging to it has been turned off. For technical issues that I can't resolve, please post in the appropriate support channel or contact your instructor/mentor directly.";
      matched = true;
    }
    
    // GENERAL HELP PATTERN
    else if (text.match(/\b(help|assist|support)\b/i)) {
      response = "I can help with questions about Zoom sessions, recordings, learning modules, ILTs, assessments, and more. What specific information do you need?";
      matched = true;
    }
    
    // Send the response
    await say(response);
    console.log('Sent response:', response);
    
    // Log the question to MongoDB
    try {
      // Get user info for better logging
      const userInfo = await client.users.info({ user: message.user });
      const username = userInfo.user.name || userInfo.user.real_name || 'unknown';
      
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
        matched
      );
    } catch (loggingError) {
      console.error('Error logging question to database:', loggingError);
      // Continue with the bot's operation even if logging fails
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

// App mention handler
app.event('app_mention', async ({ event, say, client }) => {
  try {
    console.log('Received mention:', event.text);
    
    // Extract the actual message (remove the mention)
    const text = event.text.replace(/<@[A-Z0-9]+>/, '').trim();
    
    // If the mention contains a specific question, process it
    if (text.length > 0) {
      // Create a message-like object
      const message = {
        text: text,
        user: event.user,
        channel: event.channel,
        ts: event.ts
      };
      
      // Process like a regular message (reuse the message handler logic)
      // First, determine the response
      let response = "I'm not sure I understand that question. Could you rephrase it or ask about Zoom, ILT sessions, recordings, or the learning portal?";
      let matched = false;
      
      // Use the same pattern matching logic as in the message handler
      // This is simplified - ideally you would refactor the pattern matching into a separate function
      if (text.toLowerCase().includes('zoom') && text.toLowerCase().includes('login')) {
        response = "If you're having trouble logging into Zoom, double-check your credentials, reset your password if necessary, and ensure you're using the correct email associated with your account.";
        matched = true;
      }
      // Add other patterns here...
      
      // Send the response in thread
      await say({
        text: response,
        thread_ts: event.ts
      });
      
      // Log to MongoDB (similar to the message handler logic)
      try {
        const userInfo = await client.users.info({ user: event.user });
        const username = userInfo.user.name || userInfo.user.real_name || 'unknown';
        
        let channelName = 'unknown-channel';
        try {
          const channelInfo = await client.conversations.info({ channel: event.channel });
          channelName = channelInfo.channel.name || 'unknown-channel';
        } catch (channelError) {
          console.error('Error getting channel info:', channelError);
        }
        
        await logQuestion(
          event.user,
          username,
          event.channel,
          channelName,
          text,
          response,
          matched
        );
      } catch (loggingError) {
        console.error('Error logging mention to database:', loggingError);
      }
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

// Home tab
app.event('app_home_opened', async ({ event, client }) => {
  try {
    // Get some stats if MongoDB is connected
    let stats = { total: 0, matched: 0, unmatched: 0 };
    let matchRate = '0';
    let dbStatus = "❓ Unknown";
    
    try {
      // Check database status
      const status = await pingDatabase();
      dbStatus = status.connected ? "✅ Connected" : "❌ Disconnected";
      
      if (status.connected) {
        stats = await getQuestionStats();
        matchRate = stats.total > 0 ? ((stats.matched / stats.total) * 100).toFixed(2) : '0';
      }
    } catch (dbError) {
      console.error('Error checking database status:', dbError);
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
              "text": "Enqurious Databricks Learning Assistant",
              "emoji": true
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "Hello! 👋 I'm your learning assistant bot. I can help answer questions about the Enqurious Client Programs - Databricks course."
            }
          },
          {
            "type": "divider"
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*What I can help with:*"
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "• 💻 *Zoom issues* - joining meetings, troubleshooting, recordings\n• 📝 *Learning modules* - accessing content, deadlines, self-paced learning\n• 🎓 *ILT sessions* - schedules, recordings, preparation\n• 🔑 *Portal access* - login help, troubleshooting"
            }
          },
          {
            "type": "divider"
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*Common Questions:*"
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "• How do I join a Zoom meeting?\n• Where can I find session recordings?\n• What do Learning, ILT, and Assessment mean?\n• How can I access self-paced modules?\n• What login information is needed for the portal?"
            }
          },
          {
            "type": "divider"
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*Quick Links:*"
            }
          },
          {
            "type": "section",
            "fields": [
              {
                "type": "mrkdwn",
                "text": "• <https://www.tredence.enqurious.com/auth/login|Enqurious Learning Portal>"
              },
              {
                "type": "mrkdwn",
                "text": "• <https://docs.google.com/spreadsheets/d/11kw1hvG5dLX9a6GwRd1UF_Mq9ivgCJvr-_2mtd6Z7OQ/edit|Learning Calendar>"
              }
            ]
          },
          {
            "type": "section",
            "fields": [
              {
                "type": "mrkdwn",
                "text": "• <https://drive.google.com/drive/folders/1I6wXvcKTyXzxsQd19SpOmFrbIWta7vnq|Session Recordings>"
              },
              {
                "type": "mrkdwn",
                "text": "• <https://drive.google.com/file/d/1VSP-WKi8f8GStQ_UMuzqtRvGZindhl_n|Portal Access Guide>"
              }
            ]
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
                "text": `📊 Bot Statistics: ${stats.total} questions answered (${matchRate}% match rate)`
              }
            ]
          },
          {
            "type": "context",
            "elements": [
              {
                "type": "mrkdwn",
                "text": "To get help, just send a message to me directly or mention me in a channel."
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

// Define the port
const PORT = process.env.PORT || 3000;

// Create an HTTP server that responds to all requests
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('EnquBuddy Bot is running!');
});

// Start the app
(async () => {
  try {
    // First connect to MongoDB
    const dbConnected = await connectToMongoDB();
    if (dbConnected) {
      console.log('MongoDB connected successfully');
    } else {
      console.warn('MongoDB connection failed, continuing without question logging');
    }
    
    // Then start the Slack app with a custom server
    await app.start({ port: PORT, server });
    console.log(`⚡️ Educational Bot is running on port ${PORT}!`);
    
    // Make sure the server is listening
    if (!server.listening) {
      server.listen(PORT, () => {
        console.log(`HTTP server explicitly listening on port ${PORT}`);
      });
    }
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
