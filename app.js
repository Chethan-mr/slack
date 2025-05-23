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
let learnedQACollection = null;
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
  const zoomQAs = [
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
  
  for (const qa of zoomQAs) {
    try {
      // Add to General knowledge base with high confidence
      await knowledgeLearner.recordQAPair(qa.question, qa.answer, 'General', 0.95);
      
      // Also add to common program contexts
      await knowledgeLearner.recordQAPair(qa.question, qa.answer, 'Databricks', 0.95);
      await knowledgeLearner.recordQAPair(qa.question, qa.answer, 'Announcements', 0.95);
      
      console.log(`Added Q&A: "${qa.question.substring(0, 50)}..."`);
    } catch (error) {
      console.error(`Error adding Q&A pair: ${qa.question.substring(0, 30)}...`, error);
    }
  }
  
  console.log('Finished adding predefined Q&A pairs');
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
    const originalText = message.text || '';
    let response = "I'm not sure I understand that question. Could you rephrase it or ask about Zoom, ILT sessions, recordings, or the learning portal?";
    let matched = false;
    
    // Get message context from channel handler
    const context = await channelHandler.getMessageContext(message, client);
    const programName = context.programInfo?.programName || 'General';
    
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
    
    // Check for learned answers from previous questions FIRST
    console.log(`Checking for learned answer in program: ${programName}`);
    let learnedResponse = null;
    try {
      learnedResponse = await knowledgeLearner.findLearnedAnswer(originalText, programName);
    } catch (error) {
      console.error('Error finding learned answer:', error);
    }
    
    if (learnedResponse && learnedResponse.confidence > 0.7) {
      // Use the learned answer
      console.log(`Using learned answer with confidence ${learnedResponse.confidence}`);
      response = learnedResponse.answer;
      matched = true;
    }
    // If no learned answer, check patterns and keywords
    else {
      console.log('No learned answer found, checking patterns');
      
      // Check for resource links
      if (context.programInfo) {
        const linkResponse = channelHandler.getLinkResponse(text, context);
        
        if (linkResponse) {
          console.log('Found link response');
          response = linkResponse;
          matched = true;
        }
      }
      
      // If no link response, check patterns
      if (!matched) {
        // CASUAL CONVERSATION PATTERNS
        if (text.match(/^(hi|hello|hey|greetings|howdy)(\s|$)/i)) {
          response = "Hello! 👋 I'm your learning assistant bot. How can I help you today?";
          matched = true;
        }
        else if (text.match(/\b(how are you|how you doing|how's it going|how are things|what's up)\b/i)) {
          response = "I'm doing well, thanks for asking! I'm here to help with any questions. What can I assist you with today?";
          matched = true;
        }
        else if (text.match(/\b(thank|thanks|thx|ty)\b/i)) {
          response = "You're welcome! Feel free to ask if you have any other questions.";
          matched = true;
        }
        else if (text.match(/\b(who are you|what are you|what do you do|tell me about you)\b/i)) {
          response = "I'm EnquBuddy, an assistant bot for learning programs. I can help answer questions about Zoom sessions, recordings, learning modules, and more!";
          matched = true;
        }
        
        // ENHANCED ZOOM PATTERNS WITH FLEXIBLE KEYWORD MATCHING
        
        // Q1: Join Zoom using calendar link
        else if ((text.includes('join') && text.includes('zoom') && text.includes('calendar')) ||
                 (text.includes('calendar') && text.includes('zoom') && text.includes('link')) ||
                 (text.includes('how') && text.includes('join') && text.includes('zoom'))) {
          response = "Open the calendar event on your device and click the Zoom meeting link. It will either open the Zoom app or prompt you to download it if you don't have it installed. You can also join via your browser if you prefer.";
          matched = true;
        }
        
        // Q2: Zoom link doesn't work
        else if ((text.includes('zoom') && text.includes('link') && (text.includes('doesn\'t') || text.includes('not') || text.includes('won\'t'))) ||
                 (text.includes('zoom') && text.includes('link') && text.includes('work')) ||
                 (text.includes('zoom') && text.includes('broken'))) {
          response = "Try copying and pasting the full Zoom link into your browser's address bar. If you don't have the Zoom app installed, download it from zoom.us/download for the best experience.";
          matched = true;
        }
        
        // Q3: Join Zoom from phone/tablet
        else if ((text.includes('join') && text.includes('zoom') && (text.includes('phone') || text.includes('mobile') || text.includes('tablet'))) ||
                 (text.includes('zoom') && text.includes('mobile')) ||
                 (text.includes('zoom') && text.includes('phone'))) {
          response = "Yes! Install the Zoom app on your iOS or Android device, then click the calendar link to join the meeting.";
          matched = true;
        }
        
        // Q4: Need Zoom account
        else if ((text.includes('need') && text.includes('zoom') && text.includes('account')) ||
                 (text.includes('zoom') && text.includes('account') && text.includes('required')) ||
                 (text.includes('do') && text.includes('i') && text.includes('need') && text.includes('zoom'))) {
          response = "No, you don't need a Zoom account to join most meetings. Just click the link and enter your name when prompted.";
          matched = true;
        }
        
        // Q5: Meeting passcode
        else if ((text.includes('meeting') && text.includes('passcode')) ||
                 (text.includes('zoom') && text.includes('passcode')) ||
                 (text.includes('passcode') && text.includes('required'))) {
          response = "The passcode will be included in the calendar event description. Enter it when Zoom asks for it.";
          matched = true;
        }
        
        // Q6: Test audio/video
        else if ((text.includes('test') && (text.includes('audio') || text.includes('video'))) ||
                 (text.includes('check') && (text.includes('microphone') || text.includes('camera'))) ||
                 (text.includes('test') && text.includes('zoom'))) {
          response = "When you open the Zoom link, you can test your microphone and camera on the preview screen before joining the meeting.";
          matched = true;
        }
        
        // Q7: Can't hear or see
        else if ((text.includes('can\'t') && (text.includes('hear') || text.includes('see'))) ||
                 (text.includes('no') && (text.includes('audio') || text.includes('video'))) ||
                 (text.includes('muted') || text.includes('sound'))) {
          response = "Check if your audio is muted or your video is turned off. Also, verify your device's volume and permissions for Zoom to access your microphone and camera.";
          matched = true;
        }
        
        // Q8: Join late or rejoin
        else if ((text.includes('join') && text.includes('late')) ||
                 (text.includes('accidentally') && text.includes('leave')) ||
                 (text.includes('rejoin') && text.includes('meeting'))) {
          response = "You can rejoin anytime by clicking the calendar link again.";
          matched = true;
        }
        
        // Q9: Web browser instead of app
        else if ((text.includes('browser') && text.includes('zoom')) ||
                 (text.includes('web') && text.includes('browser')) ||
                 (text.includes('browser') && text.includes('instead'))) {
          response = "Yes, when prompted to open the Zoom app, you can select the option to join from your browser instead.";
          matched = true;
        }
        
        // Q10: Technical issues contact
        else if ((text.includes('technical') && text.includes('issues')) ||
                 (text.includes('zoom') && text.includes('support')) ||
                 (text.includes('who') && text.includes('contact') && text.includes('technical'))) {
          response = "Contact the meeting organizer or your IT support for assistance.";
          matched = true;
        }
        
        // EXISTING ZOOM PATTERNS (for compatibility)
        else if ((text.includes('zoom') && (text.includes('login') || text.includes('log in') || text.includes('signin') || text.includes('sign in') || text.includes('unable') || text.includes('cannot') || text.includes('can\'t'))) ||
                 (text.includes('login') && text.includes('zoom')) ||
                 (text.includes('unable') && text.includes('zoom'))) {
          response = "If you're having trouble logging into Zoom, double-check your credentials, reset your password if necessary, and ensure you're using the correct email associated with your account.";
          matched = true;
        }
        else if ((text.includes('zoom') && text.includes('join') && text.includes('meeting')) ||
                 (text.includes('zoom') && text.includes('access') && text.includes('session'))) {
          response = "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided.";
          matched = true;
        }
        else if (text.includes('zoom') && text.includes('email')) {
          response = "It's recommended to use your official email for attendance tracking and access to recordings. If you want to change your Zoom email, log into your Zoom account settings and update your email address. Make sure to verify the new email.";
          matched = true;
        }
        else if (text.includes('authorized') && text.includes('registrants')) {
          response = "If you see an error message like 'This meeting is for authorized registrants only,' confirm that you're using the correct email and that it matches your registration.";
          matched = true;
        }
        else if ((text.includes('connectivity') || text.includes('connection') || text.includes('technical')) && text.includes('zoom')) {
          response = "If you experience connectivity issues during a Zoom session, check your internet connection and try rejoining the meeting. If issues persist, you may need to switch to a different network. For immediate assistance, reach out in the Slack group.";
          matched = true;
        }
        else if (text === 'zoom' || text === 'about zoom') {
          response = "Zoom is the video conferencing platform we use for our interactive sessions. I can help with joining meetings, troubleshooting issues, accessing recordings, or any other Zoom-related questions. What specific help do you need?";
          matched = true;
        }
        
        // RECORDING RELATED PATTERNS
        else if (text.includes('recording') && (text.includes('where') || text.includes('how') || text.includes('access') || text.includes('find') || text.includes('view') || text.includes('watch'))) {
          response = "Meeting recordings are usually uploaded to a shared drive after the session. Check the Slack Canvas Bookmarks for the link to the drive. Recordings typically take 1-2 days to be uploaded.";
          matched = true;
        }
        else if (text.includes('recording') && (text.includes('today') || text.includes('recent') || text.includes('latest') || text.includes('yesterday') || text.includes('this week'))) {
          response = "Session recordings usually take 1-2 days to be uploaded. If you still can't find a recent recording after 2 days, please inform your mentor or drop a message in the Slack group.";
          matched = true;
        }
        
        // LEARNING & MODULES PATTERNS
        else if ((text.includes('learning') || text.includes('module') || text.includes('self-paced') || text.includes('self paced')) && (text.includes('access') || text.includes('find') || text.includes('where') || text.includes('how'))) {
          response = "You can access self-paced modules by logging into the Enqurious learning portal here: https://www.tredence.enqurious.com/auth/login?redirect_uri=/. Simply click on a topic to access its content and start learning.";
          matched = true;
        }
        else if ((text.includes('complete') || text.includes('finish') || text.includes('time')) && (text.includes('module') || text.includes('self-paced') || text.includes('self paced'))) {
          response = "No, you don't have to complete self-paced modules within the given time. The time mentioned is just for your reference. You can complete the modules at your own pace.";
          matched = true;
        }
        else if ((text.includes('what') || text.includes('mean')) && (text.includes('ilt') || text.includes('learning') || text.includes('assessment'))) {
          response = "Here's what each term in the Learning Calendar means:\n1. Learning: Self-study modules available on the Enqurious learning portal\n2. ILT (Instructor-Led Training): Live sessions conducted by mentors on Zoom where you can ask questions, discuss problems, and gain deeper insights\n3. Assessment: Mock tests to be attempted at the end of the program";
          matched = true;
        }
        
        // LABELS PATTERN
        else if ((text.includes('add') && text.includes('labels')) || 
                 (text.includes('create') && text.includes('label')) ||
                 (text.includes('labels') && text.includes('program'))) {
          response = "To add a label for a new program, follow these steps:\n1. On the extreme left of your screen, locate and click on the 'Label' tab.\n2. Once you're in the label section, click on the 'Create Label' button.\n3. Enter the desired name for the new label based on the program's requirements.\n4. After entering the label name, click 'Create' to apply the new label.";
          matched = true;
        }
        
        // DEADLINE & ASSESSMENT PATTERNS
        else if ((text.includes('miss') || text.includes('extend') || text.includes('extension') || text.includes('deadline')) && (text.includes('practice') || text.includes('assignment') || text.includes('submission') || text.includes('test'))) {
          response = "Generally, deadlines are strict, but you can ask if extensions are possible by contacting the program coordinator. Note that for mock tests and partial mock tests, we cannot extend the timeline as these are already being worked on by the TALL Team and can only be changed upon their approval. So kindly keep up with the Learning calendar.";
          matched = true;
        }
        else if ((text.includes('check') || text.includes('know') || text.includes('find') || text.includes('see')) && (text.includes('ilt') || text.includes('schedule') || text.includes('calendar'))) {
          response = "You can visit the Learning calendar here: https://docs.google.com/spreadsheets/d/11kw1hvG5dLX9a6GwRd1UF_Mq9ivgCJvr-_2mtd6Z7OQ/edit?gid=0#gid=0 and check if you have any ILTs on a specific date.";
          matched = true;
        }
        
        // PORTAL & ACCESS PATTERNS
        else if ((text.includes('portal') || text.includes('enqurious')) && (text.includes('login') || text.includes('access') || text.includes('credential'))) {
          response = "To access the Enqurious Portal, navigate to the login page (https://www.tredence.enqurious.com/auth/login), enter the credentials provided in your company email, and upon successful login, you can change your password and username.";
          matched = true;
        }
        else if ((text.includes('issue') || text.includes('problem') || text.includes('trouble') || text.includes('help') || text.includes('can\'t') || text.includes('cannot') || text.includes('unable')) && (text.includes('login') || text.includes('logging') || text.includes('sign in') || text.includes('access')) && (text.includes('portal') || text.includes('enqurious'))) {
          response = "If you're having trouble logging into the Enqurious Portal, here are some troubleshooting steps:\n\n1. Make sure you're using the correct URL: https://www.tredence.enqurious.com/auth/login\n2. Double-check that you're using the exact credentials provided in your company email\n3. Clear your browser cache or try using an incognito/private browsing window\n4. Try a different browser (Chrome or Firefox recommended)\n5. If you've forgotten your password, use the 'Forgot Password' option on the login page";
          matched = true;
        }
        else if ((text.includes('gmail') || text.includes('google')) && text.includes('account')) {
          response = "If you're having trouble accessing resources that require a Gmail account, try accessing them from an incognito tab in your browser.";
          matched = true;
        }
        
        // HELP DESK PATTERNS
        else if (text.includes('help desk') || text.includes('helpdesk') || text.includes('support desk')) {
          response = "There is a Help desk app available in Slack, but direct messaging to it has been turned off. For technical issues that I can't resolve, please post in the appropriate support channel or contact your instructor/mentor directly.";
          matched = true;
        }
        
        // GENERAL HELP PATTERN
        else if (text.includes('help') || text.includes('assist') || text.includes('support')) {
          response = "I can help with questions about Zoom sessions, recordings, learning modules, ILTs, assessments, and more. What specific information do you need?";
          matched = true;
        }
      }
    }
    
    // Send the response (without customization to avoid duplication)
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
        
        // Get channel info
        let channelName = 'direct-message';
        if (message.channel.startsWith('C')) {
          try {
            const channelInfo = await client.conversations.info({ channel: message.channel });
            channelName = channelInfo.channel?.name || 'unknown-channel';
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
      
      // Check for learned answers first
      let learnedResponse = null;
      try {
        learnedResponse = await knowledgeLearner.findLearnedAnswer(text, programName);
      } catch (error) {
        console.error('Error finding learned answer for mention:', error);
      }
      
      let response = "I'm not sure I understand that question. Could you rephrase it or ask about Zoom, ILT sessions, recordings, or the learning portal?";
      let matched = false;
      
      if (learnedResponse && learnedResponse.confidence > 0.7) {
        // Use the learned answer
        console.log(`Using learned answer for mention with confidence ${learnedResponse.confidence}`);
        response = learnedResponse.answer;
        matched = true;
      }
      else {
        // If no learned answer, check for resource links
        if (context.programInfo) {
          console.log('No learned answer found for mention, checking for resource links');
          const linkResponse = channelHandler.getLinkResponse(text, context);
          
          if (linkResponse) {
            console.log('Found link response for mention');
            response = linkResponse;
            matched = true;
          }
          else {
            console.log('No link response found for mention, checking patterns');
            // Use basic pattern matching logic for mentions
            if (text.toLowerCase().includes('zoom') && text.toLowerCase().includes('login')) {
              response = "If you're having trouble logging into Zoom, double-check your credentials, reset your password if necessary, and ensure you're using the correct email associated with your account.";
              matched = true;
            }
          }
        }
      }
      
      // Send the response in thread
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
            channelName = channelInfo.channel?.name || 'unknown-channel';
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
        text: "Hi there! I'm EnquBuddy, your learning assistant. How can I help you today?",
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
        
        // Initialize knowledge learner's periodic learning
        knowledgeLearner.schedulePeriodicLearning(app.client);
        
        // Initialize channel handler's periodic scanning
        channelHandler.scheduleChannelScans(app.client);
        
        // Initial learning from history - with error handling
        console.log('Starting initial learning from channel history...');
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
