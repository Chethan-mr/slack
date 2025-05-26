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

// Improved channel handler - focuses on private channels only
const channelHandler = {
  async getMessageContext(message, client) {
    try {
      let programName = 'General';
      let channelName = 'direct-message';
      let isPrivateChannel = false;
      
      // Get channel info if it's a channel message
      if (message.channel && message.channel.startsWith('C')) {
        try {
          const channelInfo = await client.conversations.info({ channel: message.channel });
          channelName = channelInfo.channel?.name || 'unknown-channel';
          isPrivateChannel = channelInfo.channel?.is_private || false;
          
          // Only extract program name from PRIVATE channels
          // Public channels are ignored for program context
          if (isPrivateChannel) {
            programName = channelName
              .replace(/[-_]/g, ' ')
              .replace(/\b(databricks|announcements|general)\b/gi, '') // Remove common public channel names
              .trim()
              .split(' ')
              .filter(word => word.length > 0)
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ') || 'Learning Program';
          } else {
            // For public channels, use generic program name
            programName = 'General';
            channelName = 'public-channel'; // Don't expose public channel names
          }
        } catch (error) {
          console.error('Error getting channel info:', error);
        }
      }
      
      return {
        programInfo: {
          programName: programName,
          channelName: channelName,
          isPrivateChannel: isPrivateChannel
        }
      };
    } catch (error) {
      console.error('Error getting message context:', error);
      return {
        programInfo: {
          programName: 'General',
          channelName: 'unknown',
          isPrivateChannel: false
        }
      };
    }
  },
  
  getLinkResponse(text, context) {
    // Simple link response handler
    if (text.includes('portal') || text.includes('learning')) {
      return "You can access the learning portal at: https://www.tredence.enqurious.com/auth/login";
    }
    if (text.includes('calendar') && text.includes('learning')) {
      return "You can check the Learning calendar here: https://docs.google.com/spreadsheets/d/11kw1hvG5dLX9a6GwRd1UF_Mq9ivgCJvr-_2mtd6Z7OQ/edit?gid=0#gid=0";
    }
    return null;
  },
  
  // Custom response that doesn't add program info for public channels
  customizeResponse(baseResponse, context) {
    if (!context.programInfo || !context.programInfo.isPrivateChannel) {
      return baseResponse; // Don't customize for public channels
    }
    
    const programName = context.programInfo.programName;
    
    // Don't customize greetings and common responses to avoid duplication
    if (baseResponse.includes("I'm your learning assistant bot") || 
        baseResponse.includes("You're welcome!") ||
        baseResponse.includes("I'm EnquBuddy") ||
        baseResponse.includes("Hello!") ||
        baseResponse.includes("Thanks for asking!")) {
      return baseResponse;
    }
    
    // Add program name only if it's a meaningful private channel program
    if (programName && programName !== 'General' && programName !== 'Learning Program') {
      return `${baseResponse}\n\nI'm your assistant for the ${programName} program. Let me know if you need anything else!`;
    }
    
    return baseResponse;
  },
  
  scheduleChannelScans(client) {
    // Placeholder for channel scanning functionality
    console.log('Channel scanning scheduled (placeholder)');
  }
};

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

// Function to add predefined Q&A pairs to the knowledge base
async function addPredefinedQAs() {
  const predefinedQAs = [
    {
      question: "How do I join the Zoom meeting using the calendar link?",
      answer: "Open the calendar event on your device and click the Zoom meeting link. It will either open the Zoom app or prompt you to download it if you don't have it installed. You can also join via your browser if you prefer."
    },
    {
      question: "What if the Zoom link doesn't open or work?",
      answer: "Try copying and pasting the full Zoom link into your browser's address bar. If you don't have the Zoom app installed, download it from zoom.us/download for the best experience."
    },
    {
      question: "Can I join the Zoom meeting from my phone or tablet?",
      answer: "Yes! Install the Zoom app on your iOS or Android device, then click the calendar link to join the meeting."
    },
    {
      question: "Do I need a Zoom account to join the meeting?",
      answer: "No, you don't need a Zoom account to join most meetings. Just click the link and enter your name when prompted."
    },
    {
      question: "What if the meeting requires a passcode?",
      answer: "The passcode will be included in the calendar event description. Enter it when Zoom asks for it."
    },
    {
      question: "How can I test my audio and video before joining?",
      answer: "When you open the Zoom link, you can test your microphone and camera on the preview screen before joining the meeting."
    },
    {
      question: "I joined but can't hear or see anything — what should I do?",
      answer: "Check if your audio is muted or your video is turned off. Also, verify your device's volume and permissions for Zoom to access your microphone and camera."
    },
    {
      question: "What if I join late or accidentally leave the meeting?",
      answer: "You can rejoin anytime by clicking the calendar link again."
    },
    {
      question: "Can I join Zoom meetings through a web browser instead of the app?",
      answer: "Yes, when prompted to open the Zoom app, you can select the option to join from your browser instead."
    },
    {
      question: "Who do I contact if I have technical issues joining the Zoom meeting?",
      answer: "Contact the meeting organizer or your IT support for assistance."
    },
    {
      question: "How can we add labels for a new program?",
      answer: "To add a label for a new program, follow these steps:\n1. On the extreme left of your screen, locate and click on the 'Label' tab.\n2. Once you're in the label section, click on the 'Create Label' button.\n3. Enter the desired name for the new label based on the program's requirements.\n4. After entering the label name, click 'Create' to apply the new label."
    }
  ];

  console.log('Adding predefined Q&A pairs to knowledge base...');
  
  for (const qa of predefinedQAs) {
    try {
      // Add to General knowledge base with high confidence
      await knowledgeLearner.recordQAPair(qa.question, qa.answer, 'General', 0.95);
      console.log(`Added Q&A: "${qa.question.substring(0, 50)}..."`);
    } catch (error) {
      console.error(`Error adding Q&A pair: ${qa.question.substring(0, 30)}...`, error);
    }
  }
  
  console.log('Finished adding predefined Q&A pairs');
}

// IMPROVED PRECISE PATTERN MATCHING FUNCTION
function getPreciseAnswer(text) {
  const normalizedText = text.toLowerCase().trim();
  
  // EXACT QUESTION MATCHING - Only respond to very specific questions
  const exactMatches = {
    // Deadline extension questions
    "can we extend the timeline for the mock test and partial mock test": "No, we cannot extend the timeline for the mock test and partial mock test. These are already being worked on by the TALL Team and can only be changed or extended upon their approval. So kindly keep up with the Learning calendar.",
    "can we extend the timeline for mock test": "No, we cannot extend the timeline for the mock test and partial mock test. These are already being worked on by the TALL Team and can only be changed or extended upon their approval. So kindly keep up with the Learning calendar.",
    "can we extend mock test deadline": "No, we cannot extend the timeline for the mock test and partial mock test. These are already being worked on by the TALL Team and can only be changed or extended upon their approval. So kindly keep up with the Learning calendar.",
    
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
    
    // What do terms mean
    "what is ilt": "ILT stands for Instructor-Led Training. These are live sessions conducted by mentors on Zoom where you can ask questions, discuss problems, and gain deeper insights.",
    "what does ilt mean": "ILT stands for Instructor-Led Training. These are live sessions conducted by mentors on Zoom where you can ask questions, discuss problems, and gain deeper insights.",
    "what is learning": "In the Learning Calendar, 'Learning' refers to self-study modules available on the Enqurious learning portal.",
    "what is assessment": "Assessment refers to mock tests to be attempted at the end of the program.",
    
    // Self-paced modules
    "can i complete modules at my own pace": "Yes, you don't have to complete self-paced modules within the given time. The time mentioned is just for your reference. You can complete the modules at your own pace.",
    "self paced modules time limit": "No, you don't have to complete self-paced modules within the given time. The time mentioned is just for your reference. You can complete the modules at your own pace.",
    
    // Greetings - REMOVED DATABRICKS
    "hi": "Hello! 👋 I'm your learning assistant bot. How can I help you today?",
    "hello": "Hello! 👋 I'm your learning assistant bot. How can I help you today?",
    "hey": "Hello! 👋 I'm your learning assistant bot. How can I help you today?",
    
    // Thanks
    "thank you": "You're welcome! Feel free to ask if you have any other questions.",
    "thanks": "You're welcome! Feel free to ask if you have any other questions.",
    "thx": "You're welcome! Feel free to ask if you have any other questions.",
  };
  
  // Check for exact matches first
  if (exactMatches[normalizedText]) {
    return exactMatches[normalizedText];
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
  
  // No confident match found
  return null;
}

// Initialize the Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

console.log("🚀 USING IMPROVED BOT VERSION - PRECISE MATCHING & PRIVATE CHANNEL FOCUS ENABLED");

// IMPROVED MESSAGE HANDLER - Only responds when confident, no duplicates
app.message(async ({ message, say, client }) => {
  // Skip messages from bots
  if (message.subtype === 'bot_message') return;
  
  console.log('Received message:', message.text);
  
  try {
    const text = message.text?.toLowerCase() || '';
    const originalText = message.text || '';
    let response = null;
    let matched = false;
    
    // Get message context from channel handler
    const context = await channelHandler.getMessageContext(message, client);
    const programName = context.programInfo?.programName || 'General';
    const isPrivateChannel = context.programInfo?.isPrivateChannel || false;
    
    console.log(`Context: Program=${programName}, Private=${isPrivateChannel}, Channel=${context.programInfo?.channelName}`);
    
    // DATABASE STATUS COMMAND - only works for admin
    if (text === '!dbping' && (message.user === process.env.ADMIN_USER_ID)) {
      const status = await pingDatabase();
      await say(`Database status: ${status.connected ? "✅" : "❌"} ${status.message}`);
      return;
    }
    
    // DEBUG COMMANDS - search and inspect the knowledge base
    if (text.startsWith('!debug ')) {
      // Only allow admin users to use debug commands
      if (message.user === process.env.ADMIN_USER_ID) {
        const searchTerm = text.replace('!debug ', '').trim();
        try {
          const results = await knowledgeLearner.debugSearch(searchTerm);
          
          let debugResponse = `Debug results for "${searchTerm}":\n\n`;
          
          if (!results || results.length === 0) {
            debugResponse += "No matching entries found in the database.";
          } else {
            results.forEach((item, index) => {
              debugResponse += `${index + 1}. Q: ${item.question}\n`;
              debugResponse += `   A: ${item.answer.substring(0, 100)}${item.answer.length > 100 ? '...' : ''}\n`;
              debugResponse += `   Program: ${item.programName}, Confidence: ${item.confidence}\n\n`;
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
    
    if (text.toLowerCase().startsWith('search:')) {
      const searchTerm = text.substr(7).trim();
      try {
        const answer = await knowledgeLearner.searchKnowledgeBase(searchTerm);
        if (answer) {
          await say(`Found answer: "${answer.answer.substring(0, 200)}${answer.answer.length > 200 ? '...' : ''}"\nConfidence: ${answer.confidence}\nProgram: ${answer.programName}`);
        } else {
          await say(`No answer found for: "${searchTerm}"`);
        }
      } catch (error) {
        console.error('Error searching knowledge base:', error);
        await say('Error searching the knowledge base.');
      }
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
    
    // STEP 1: Check for high-confidence learned answers FIRST (confidence > 0.8)
    console.log(`Checking for learned answer in program: ${programName}`);
    let learnedResponse = null;
    try {
      learnedResponse = await knowledgeLearner.findLearnedAnswer(originalText, programName);
    } catch (error) {
      console.error('Error finding learned answer:', error);
    }
    
    if (learnedResponse && learnedResponse.confidence > 0.8) {
      // Use the learned answer only if confidence is high
      console.log(`Using learned answer with high confidence ${learnedResponse.confidence}`);
      response = learnedResponse.answer;
      matched = true;
    }
    
    // STEP 2: If no high-confidence learned answer, try precise pattern matching
    if (!matched) {
      console.log('No high-confidence learned answer found, checking precise patterns');
      response = getPreciseAnswer(originalText);
      if (response) {
        console.log('Found precise pattern match');
        matched = true;
      }
    }
    
    // STEP 3: If still no match, check for resource links (very specific)
    if (!matched && context.programInfo) {
      const linkResponse = channelHandler.getLinkResponse(text, context);
      if (linkResponse) {
        console.log('Found specific link response');
        response = linkResponse;
        matched = true;
      }
    }
    
    // STEP 4: If no confident answer found, direct to contact person
    if (!matched) {
      console.log('No confident answer found, directing to contact person');
      response = "I'm not sure about that specific question. For assistance with questions I can't answer confidently, please contact <@abhilipsha> who can help you better.";
      matched = false; // Mark as unmatched for learning purposes
    }
    
    // STEP 5: Apply program-specific customization ONLY for private channels
    if (matched && isPrivateChannel && programName !== 'General') {
      response = channelHandler.customizeResponse(response, context);
    }
    
    // Send the response (SINGLE RESPONSE ONLY)
    await say(response);
    console.log('Sent response:', response);
    
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
        
        // Get channel info (but don't expose public channel names in logs)
        let channelName = 'direct-message';
        if (message.channel.startsWith('C')) {
          try {
            const channelInfo = await client.conversations.info({ channel: message.channel });
            channelName = channelInfo.channel?.is_private 
              ? (channelInfo.channel?.name || 'private-channel')
              : 'public-channel';
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
        // Continue with the bot's operation even if logging fails
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

// App mention handler - also improved for precision and no duplicates
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
      const isPrivateChannel = context.programInfo?.isPrivateChannel || false;
      
      // Check for high-confidence learned answers first
      let learnedResponse = null;
      try {
        learnedResponse = await knowledgeLearner.findLearnedAnswer(text, programName);
      } catch (error) {
        console.error('Error finding learned answer for mention:', error);
      }
      
      let response = "I'm not sure about that specific question. For assistance with questions I can't answer confidently, please contact <@abhilipsha> who can help you better.";
      let matched = false;
      
      if (learnedResponse && learnedResponse.confidence > 0.8) {
        // Use the learned answer only if confidence is high
        console.log(`Using learned answer for mention with high confidence ${learnedResponse.confidence}`);
        response = learnedResponse.answer;
        matched = true;
      }
      else {
        // Try precise pattern matching
        const preciseAnswer = getPreciseAnswer(text);
        if (preciseAnswer) {
          console.log('Found precise pattern match for mention');
          response = preciseAnswer;
          matched = true;
        }
        else if (context.programInfo) {
          console.log('No precise answer found for mention, checking for resource links');
          const linkResponse = channelHandler.getLinkResponse(text, context);
          
          if (linkResponse) {
            console.log('Found link response for mention');
            response = linkResponse;
            matched = true;
          }
        }
      }
      
      // Apply program-specific customization ONLY for private channels
      if (matched && isPrivateChannel && programName !== 'General') {
        response = channelHandler.customizeResponse(response, context);
      }
      
      // Send the response in thread (SINGLE RESPONSE ONLY)
      await say({
        text: response,
        thread_ts: event.ts
      });
      
      // Log to MongoDB if connected
      if (isConnected) {
        try {
          // Get user info for better logging
          let username = 'unknown';
          try {
            const userInfo = await client.users.info({ user: event.user });
            username = userInfo.user?.name || userInfo.user?.real_name || 'unknown';
          } catch (userInfoError) {
            console.log(`Could not get user info, using user ID: ${event.user}`);
            username = event.user || 'unknown';
          }
          
          let channelName = 'unknown-channel';
          try {
            const channelInfo = await client.conversations.info({ channel: event.channel });
            channelName = channelInfo.channel?.is_private 
              ? (channelInfo.channel?.name || 'private-channel')
              : 'public-channel';
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
            matched,
            programName
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
        // Check database status
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
          },
          {
            "type": "context",
            "elements": [
              {
                "type": "mrkdwn",
                "text": "To get help, send me a specific question or mention me in a channel."
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
      
      // Ensure indexes are created before starting learning
      try {
        await knowledgeLearner.ensureIndexes();
        console.log('Database indexes created successfully');
        
        // Initialize knowledge learner's periodic learning (modified to only scan channels where bot is member)
        knowledgeLearner.schedulePeriodicLearning(app.client);
        
        // Initialize channel handler's periodic scanning
        channelHandler.scheduleChannelScans(app.client);
        
        // Initial learning from history - with error handling (FIXED: only where bot is member)
        console.log('Starting initial learning from channel history (bot member channels only)...');
        try {
          await knowledgeLearner.learnFromChannelHistory(app.client);
          console.log('Channel history learning completed.');
        } catch (channelError) {
          console.error('Error learning from channel history:', channelError);
        }
        
        try {
          await knowledgeLearner.learnFromBotHistory();
          console.log('Bot history learning completed.');
        } catch (botHistoryError) {
          console.error('Error learning from bot history:', botHistoryError);
        }
        
        // Add predefined Q&A pairs
        try {
          await addPredefinedQAs();
          console.log('Predefined Q&A pairs added successfully.');
        } catch (predefinedError) {
          console.error('Error adding predefined Q&A pairs:', predefinedError);
        }
        
      } catch (indexError) {
        console.error('Error creating indexes:', indexError);
        console.log('Continuing without learning capabilities');
      }
    } else {
      console.warn('MongoDB connection failed, continuing without question logging');
      isConnected = false;
    }
    
    // Then start the Slack app
    await app.start(PORT);
    console.log(`⚡️ Educational Bot is running on port ${PORT}! Now responding only to confident matches with private channel focus.`);
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
