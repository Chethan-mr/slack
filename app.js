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
    
    // Short phrases for common questions
    "session recordings": "You can access session recordings through this link: https://drive.google.com/drive/folders/1I6wXvcKTyXzxsQd19SpOmFrbIWta7vnq?usp=sharing. Recordings usually take 1-2 days to be uploaded after a session.",
    "recordings": "You can access session recordings through this link: https://drive.google.com/drive/folders/1I6wXvcKTyXzxsQd19SpOmFrbIWta7vnq?usp=sharing. Recordings usually take 1-2 days to be uploaded after a session.",
    "meeting recordings": "You can access session recordings through this link: https://drive.google.com/drive/folders/1I6wXvcKTyXzxsQd19SpOmFrbIWta7vnq?usp=sharing. Recordings usually take 1-2 days to be uploaded after a session.",
    
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
    "can the timeline for the mock test and partial mock test be extended": "No, timelines for mock tests cannot be extended without approval from the team. Please adhere to the learning calendar.",
    
    // What do terms mean - EXPANDED with individual terms
    "what is ilt": "ILT stands for Instructor-Led Training. These are live sessions conducted by mentors on Zoom where you can ask questions, discuss problems, and gain deeper insights.",
    "what does ilt mean": "ILT stands for Instructor-Led Training. These are live sessions conducted by mentors on Zoom where you can ask questions, discuss problems, and gain deeper insights.",
    "what is learning": "In the Learning Calendar, 'Learning' refers to self-study modules available on the Enqurious learning portal.",
    "what is assessment": "Assessment refers to mock tests to be attempted at the end of the program.",
    "what do learning and assessment mean": "Learning: Self-study modules available on the portal. Assessment: Mock tests to be attempted at the end of the program.",
    "what do learning and assessment mean on the platform": "Learning: Self-study modules available on the portal. Assessment: Mock tests to be attempted at the end of the program.",
    
    // Individual platform terms
    "what is skill path": "Skill Path is a learning journey - a structured sequence of learning activities designed to help you develop specific skills.",
    "what is a skill path": "Skill Path is a learning journey - a structured sequence of learning activities designed to help you develop specific skills.",
    "what is hackathon": "Hackathon is a competitive event where participants work on projects within a time limit.",
    "what is masterclass": "Masterclass is an expert-led session where industry experts share their knowledge and insights.",
    "what is project": "Project refers to practical assignments that help you apply what you've learned in real-world scenarios.",
    "what is scenario": "Scenario refers to real-world case studies that help you practice problem-solving skills.",
    
    // Self-paced modules
    "can i complete modules at my own pace": "Yes, you don't have to complete self-paced modules within the given time. The time mentioned is just for your reference. You can complete the modules at your own pace.",
    "self paced modules time limit": "No, you don't have to complete self-paced modules within the given time. The time mentioned is just for your reference. You can complete the modules at your own pace.",
    "do i need to complete the self-paced modules within the given time": "No, the timeline is for reference only. You can complete the modules at your own pace.",
    
    // ENQURIOUS PLATFORM SPECIFIC Q&As
    
    // Q1. Filter options
    "how can i use filter options to find specific content": "The learner platform provides several filter options: Status Filter (Pending or Completed), Label Filter (by tags), Type Filter (Scenario, Project, Masterclass, Skill Path), and Content Type Filter. Using these filters helps you quickly find and navigate your learning content.",
    "how to use filters on enqurious platform": "The learner platform provides several filter options: Status Filter (Pending or Completed), Label Filter (by tags), Type Filter (Scenario, Project, Masterclass, Skill Path), and Content Type Filter. Using these filters helps you quickly find and navigate your learning content.",
    "how to filter content on learner platform": "The learner platform provides several filter options: Status Filter (Pending or Completed), Label Filter (by tags), Type Filter (Scenario, Project, Masterclass, Skill Path), and Content Type Filter. Using these filters helps you quickly find and navigate your learning content.",
    
    // Q2. Status indicators
    "what do the different status indicators mean": "Status indicators mean: Submission Deadline Expired (deadline passed, can view but not submit), Running Behind Schedule (content is behind schedule, need to catch up), Upcoming (content not yet available but will be soon).",
    "what do status indicators mean": "Status indicators mean: Submission Deadline Expired (deadline passed, can view but not submit), Running Behind Schedule (content is behind schedule, need to catch up), Upcoming (content not yet available but will be soon).",
    
    // Q3. View scores and feedback
    "how can i view my total score feedback and solutions": "You can view submission details based on access granted by the client admin. Availability of scores, feedback, and solutions depends on the content creator's settings.",
    "how to view my scores and feedback": "You can view submission details based on access granted by the client admin. Availability of scores, feedback, and solutions depends on the content creator's settings.",
    
    // Q4. Self-paced modules (already covered above, but adding variations)
    "how can i access self-paced modules": "Log in to the Enqurious learning portal and click on a topic to start learning at your own pace. You can access self-paced modules by logging into the Enqurious learning portal at https://www.tredence.enqurious.com/auth/login?redirect_uri=/. Simply click on a topic to access its content and start learning.",
    
    // Q7. Login information
    "what login information is required to access enqurious portal": "Use the login credentials sent to your company email. After login, you can change your password and username.",
    "what login information do i need": "Use the login credentials sent to your company email. After login, you can change your password and username.",
    
    // Q9. How to log into Enqurious
    "how do i log into my enqurious account": "Enter your registered email and password on the login page. Use the 'Forgot password?' link if you need to reset your password.",
    "how to log into enqurious": "Enter your registered email and password on the login page. Use the 'Forgot password?' link if you need to reset your password.",
    
    // Q10. View assigned tasks
    "how can i view my assigned tasks and their progress": "Your dashboard displays total tasks assigned, completed, and pending. You can filter and search tasks by status, content type, and other criteria.",
    "how to view my tasks": "Your dashboard displays total tasks assigned, completed, and pending. You can filter and search tasks by status, content type, and other criteria.",
    "how to see my assigned tasks": "Your dashboard displays total tasks assigned, completed, and pending. You can filter and search tasks by status, content type, and other criteria.",
    
    // Q11. Running behind schedule
    "what does running behind schedule mean": "It means the task or learning path deadline is close or passed, and you need to complete it soon.",
    "what does running behind schedule mean on a task": "It means the task or learning path deadline is close or passed, and you need to complete it soon.",
    
    // Q12. Resume task
    "how can i resume a task or learning path": "Click the 'Resume Now' button under the task to continue from where you left off.",
    "how to resume a task": "Click the 'Resume Now' button under the task to continue from where you left off.",
    
    // Q13. Completed vs pending tasks
    "what is the difference between completed tasks and pending tasks": "Completed: Tasks you have finished. Pending: Tasks yet to be completed.",
    "difference between completed and pending tasks": "Completed: Tasks you have finished. Pending: Tasks yet to be completed.",
    
    // Q14. Labels meaning
    "what do labels like skill path hackathon masterclass project and scenario mean": "They indicate the type of activity: Skill Path (Learning journey), Hackathon (Competitive event), Masterclass (Expert-led session), Project (Practical assignments), Scenario (Real-world case studies).",
    "what do the different labels mean": "They indicate the type of activity: Skill Path (Learning journey), Hackathon (Competitive event), Masterclass (Expert-led session), Project (Practical assignments), Scenario (Real-world case studies).",
    
    // Q15. Detailed timeline
    "how can i see the detailed timeline of my tasks": "The timeline section on the right side of the dashboard shows deadlines and status updates.",
    "how to see task timeline": "The timeline section on the right side of the dashboard shows deadlines and status updates.",
    
    // Q16. Miss submission deadline
    "what should i do if i miss a submission deadline": "The platform will show 'Submission deadline expired.' Contact your administrator or client admin for assistance.",
    "what if i miss a deadline": "The platform will show 'Submission deadline expired.' Contact your administrator or client admin for assistance.",
    
    // Q17. View submission button
    "what is the view submission button": "This button lets you review your submitted work. It is available only if your client admin has enabled submission review for that task.",
    
    // Q18. Learning objectives
    "how can i check my learning objectives for a task": "Within each learning path or task, find the 'Learning objectives' section outlining skills and knowledge expected.",
    "how to check learning objectives": "Within each learning path or task, find the 'Learning objectives' section outlining skills and knowledge expected.",
    
    // Q19. Navigate between modules
    "how do i navigate between different modules or scenarios within a task": "Use the navigation or progress bar inside the task to move between modules or scenarios.",
    "how to navigate between modules": "Use the navigation or progress bar inside the task to move between modules or scenarios.",
    
    // Q20. Issues accessing content
    "what should i do if i face issues accessing tasks or content": "Contact support at notifications@enqurious.com or your internal support team.",
    "what if i have issues accessing content": "Contact support at notifications@enqurious.com or your internal support team.",
    "how to get help with platform issues": "Contact support at notifications@enqurious.com or your internal support team.",
    
    // Q21. Skills and tools representation
    "how are skills and tools represented in each learning module": "Skills and tools are shown as tags related to each task to help you understand targeted expertise.",
    "how to see skills and tools": "Skills and tools are shown as tags related to each task to help you understand targeted expertise.",
  };
  
  // Check for exact matches first
  if (exactAnswers[normalizedText]) {
    return exactAnswers[normalizedText];
  }
  
  // HIGH CONFIDENCE PATTERN MATCHING - Only very specific patterns
  
  // Recording patterns (very specific) - CHECK FIRST to avoid conflicts
  if ((normalizedText.includes('where') || normalizedText.includes('how') || normalizedText.includes('access') || normalizedText.includes('find')) &&
      (normalizedText.includes('recording') || normalizedText.includes('recordings') || normalizedText.includes('session recording'))) {
    return "You can access session recordings through this link: https://drive.google.com/drive/folders/1I6wXvcKTyXzxsQd19SpOmFrbIWta7vnq?usp=sharing. Recordings usually take 1-2 days to be uploaded after a session.";
  }
  
  // Mock test extension patterns (very specific)
  if (normalizedText.includes('extend') && 
      (normalizedText.includes('mock test') || normalizedText.includes('partial mock test')) &&
      (normalizedText.includes('timeline') || normalizedText.includes('deadline'))) {
    return "No, we cannot extend the timeline for the mock test and partial mock test. These are already being worked on by the TALL Team and can only be changed or extended upon their approval. So kindly keep up with the Learning calendar.";
  }
  
  // Zoom join patterns (very specific) - MOVED AFTER recordings to avoid conflicts
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
  
  // Portal patterns (very specific)
  if ((normalizedText.includes('portal') && normalizedText.includes('login')) ||
      (normalizedText.includes('enqurious') && normalizedText.includes('login'))) {
    return "You can access the learning portal at: https://www.tredence.enqurious.com/auth/login?redirect_uri=/";
  }
  
  // Calendar patterns (very specific)
  if (normalizedText.includes('calendar') && normalizedText.includes('learning')) {
    return "You can check the Learning calendar here: https://docs.google.com/spreadsheets/d/11kw1hvG5dLX9a6GwRd1UF_Mq9ivgCJvr-_2mtd6Z7OQ/edit?gid=0#gid=0";
  }
  
  // Self-paced modules patterns
  if (normalizedText.includes('self') && normalizedText.includes('paced') && normalizedText.includes('module')) {
    return "Log in to the Enqurious learning portal and click on a topic to start learning at your own pace. You can access self-paced modules by logging into the Enqurious learning portal at https://www.tredence.enqurious.com/auth/login?redirect_uri=/";
  }
  
  // Filter patterns
  if (normalizedText.includes('filter') && (normalizedText.includes('content') || normalizedText.includes('platform'))) {
    return "The learner platform provides several filter options: Status Filter (Pending or Completed), Label Filter (by tags), Type Filter (Scenario, Project, Masterclass, Skill Path), and Content Type Filter. Using these filters helps you quickly find and navigate your learning content.";
  }
  
  // Tasks and dashboard patterns
  if (normalizedText.includes('task') && (normalizedText.includes('view') || normalizedText.includes('assigned') || normalizedText.includes('progress'))) {
    return "Your dashboard displays total tasks assigned, completed, and pending. You can filter and search tasks by status, content type, and other criteria.";
  }
  
  // Platform issues patterns
  if ((normalizedText.includes('issue') || normalizedText.includes('problem') || normalizedText.includes('trouble')) && 
      (normalizedText.includes('access') || normalizedText.includes('content') || normalizedText.includes('platform'))) {
    return "Contact support at notifications@enqurious.com or your internal support team.";
  }
  
  // Individual term questions (what is X)
  if (normalizedText.includes('what is') || normalizedText.includes('what are')) {
    if (normalizedText.includes('skill path')) {
      return "Skill Path is a learning journey - a structured sequence of learning activities designed to help you develop specific skills.";
    }
    if (normalizedText.includes('hackathon')) {
      return "Hackathon is a competitive event where participants work on projects within a time limit.";
    }
    if (normalizedText.includes('masterclass')) {
      return "Masterclass is an expert-led session where industry experts share their knowledge and insights.";
    }
    if (normalizedText.includes('project')) {
      return "Project refers to practical assignments that help you apply what you've learned in real-world scenarios.";
    }
    if (normalizedText.includes('scenario')) {
      return "Scenario refers to real-world case studies that help you practice problem-solving skills.";
    }
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

// Function to add predefined Q&A pairs to the knowledge base including Enqurious platform FAQs
async function addPredefinedQAs() {
  const predefinedQAs = [
    // Original Zoom and General Q&As
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
    
    // ENQURIOUS PLATFORM FAQs
    {
      question: "How can I use the filter options to find specific content on the learner platform?",
      answer: "The learner platform provides several filter options to help you find specific content easily: Status Filter (filter content based on completion status - Pending or Completed), Label Filter (filter by specific labels or tags assigned to content), Type Filter (choose content type such as Scenario, Project, Masterclass, or Skill Path), and Content Type Filter (narrow down content based on your learning preferences). Using these filters helps you quickly find and navigate your learning content."
    },
    {
      question: "What do the different status indicators mean next to my learning content?",
      answer: "Status indicators mean: Submission Deadline Expired (the deadline for submitting content has passed - you may still view the content but cannot submit), Running Behind Schedule (the content is behind the expected schedule - you may still access it but need to catch up), and Upcoming (content is not yet available but will be soon)."
    },
    {
      question: "How can I view my total score, feedback, and solutions for a submission?",
      answer: "You can view submission details based on access granted by the client admin. Availability of scores, feedback, and solutions depends on the content creator's settings."
    },
    {
      question: "How can I access self-paced modules?",
      answer: "You can access self-paced modules by logging into the Enqurious learning portal at https://www.tredence.enqurious.com/auth/login?redirect_uri=/. Simply click on a topic to access its content and start learning at your own pace."
    },
    {
      question: "What do Learning and Assessment mean on the platform?",
      answer: "Learning refers to self-study modules available on the portal. Assessment refers to mock tests to be attempted at the end of the program."
    },
    {
      question: "Do I need to complete the self-paced modules within the given time?",
      answer: "No, the timeline is for reference only. You can complete the modules at your own pace."
    },
    {
      question: "What login information is required to access the Enqurious portal?",
      answer: "Use the login credentials sent to your company email. After login, you can change your password and username."
    },
    {
      question: "Can the timeline for the mock test and partial mock test be extended?",
      answer: "No, timelines for mock tests cannot be extended without approval from the team. Please adhere to the learning calendar."
    },
    {
      question: "How do I log into my Enqurious account?",
      answer: "Enter your registered email and password on the login page. Use the 'Forgot password?' link if you need to reset your password."
    },
    {
      question: "How can I view my assigned tasks and their progress?",
      answer: "Your dashboard displays total tasks assigned, completed, and pending. You can filter and search tasks by status, content type, and other criteria."
    },
    {
      question: "What does Running behind schedule mean on a task?",
      answer: "It means the task or learning path deadline is close or passed, and you need to complete it soon."
    },
    {
      question: "How can I resume a task or learning path?",
      answer: "Click the 'Resume Now' button under the task to continue from where you left off."
    },
    {
      question: "What is the difference between Completed tasks and Pending tasks?",
      answer: "Completed tasks are tasks you have finished. Pending tasks are tasks yet to be completed."
    },
    {
      question: "What do labels like Skill Path, Hackathon, Masterclass, Project, and Scenario mean?",
      answer: "They indicate the type of activity: Skill Path (Learning journey), Hackathon (Competitive event), Masterclass (Expert-led session), Project (Practical assignments), and Scenario (Real-world case studies)."
    },
    {
      question: "How can I see the detailed timeline of my tasks?",
      answer: "The timeline section on the right side of the dashboard shows deadlines and status updates."
    },
    {
      question: "What should I do if I miss a submission deadline?",
      answer: "The platform will show 'Submission deadline expired.' Contact your administrator or client admin for assistance."
    },
    {
      question: "What is the View Submission button?",
      answer: "This button lets you review your submitted work. It is available only if your client admin has enabled submission review for that task."
    },
    {
      question: "How can I check my learning objectives for a task?",
      answer: "Within each learning path or task, find the 'Learning objectives' section outlining skills and knowledge expected."
    },
    {
      question: "How do I navigate between different modules or scenarios within a task?",
      answer: "Use the navigation or progress bar inside the task to move between modules or scenarios."
    },
    {
      question: "What should I do if I face issues accessing tasks or content?",
      answer: "Contact support at notifications@enqurious.com or your internal support team."
    },
    {
      question: "How are skills and tools represented in each learning module?",
      answer: "Skills and tools are shown as tags related to each task to help you understand targeted expertise."
    }
  ];

  console.log('Adding predefined Q&A pairs to knowledge base (including Enqurious platform FAQs)...');
  
  for (const qa of predefinedQAs) {
    try {
      // Add to General knowledge base with high confidence
      await knowledgeLearner.recordQAPair(qa.question, qa.answer, 'General', 0.95);
      console.log(`Added Q&A: "${qa.question.substring(0, 50)}..."`);
    } catch (error) {
      console.error(`Error adding Q&A pair: ${qa.question.substring(0, 30)}...`, error);
    }
  }
  
  console.log('Finished adding predefined Q&A pairs including Enqurious platform FAQs');
}

// Initialize the Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

console.log("🚀 USING CONSOLIDATED BOT VERSION WITH ENQURIOUS PLATFORM FAQS - SINGLE RESPONSE, NO CONFLICTS");

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
    
    // DATABASE CLEAR COMMANDS - only works for admin
    if (originalText.toLowerCase().startsWith('!clear') && (message.user === process.env.ADMIN_USER_ID)) {
      const clearType = originalText.toLowerCase().split(' ')[1] || 'help';
      
      if (clearType === 'learned') {
        try {
          if (isConnected && learnedQACollection) {
            const result = await learnedQACollection.deleteMany({});
            await say(`✅ Cleared ${result.deletedCount} learned Q&A pairs from database`);
            console.log(`Admin ${message.user} cleared learned database`);
          } else {
            await say("❌ Database not connected");
          }
        } catch (error) {
          console.error('Error clearing learned database:', error);
          await say("❌ Error clearing database");
        }
        return;
      }
      else if (clearType === 'questions') {
        try {
          if (isConnected && questionsCollection) {
            const result = await questionsCollection.deleteMany({});
            await say(`✅ Cleared ${result.deletedCount} question logs from database`);
            console.log(`Admin ${message.user} cleared questions database`);
          } else {
            await say("❌ Database not connected");
          }
        } catch (error) {
          console.error('Error clearing questions database:', error);
          await say("❌ Error clearing database");
        }
        return;
      }
      else if (clearType === 'all') {
        try {
          if (isConnected && questionsCollection && learnedQACollection) {
            const learnedResult = await learnedQACollection.deleteMany({});
            const questionsResult = await questionsCollection.deleteMany({});
            await say(`✅ Cleared ${learnedResult.deletedCount} learned answers and ${questionsResult.deletedCount} question logs`);
            console.log(`Admin ${message.user} cleared entire database`);
          } else {
            await say("❌ Database not connected");
          }
        } catch (error) {
          console.error('Error clearing entire database:', error);
          await say("❌ Error clearing database");
        }
        return;
      }
      else {
        await say(`*Database Clear Commands:*\n\n` +
                 `• \`!clear learned\` - Clear all learned Q&A pairs\n` +
                 `• \`!clear questions\` - Clear all question logs\n` +
                 `• \`!clear all\` - Clear everything\n` +
                 `• \`!clear help\` - Show this help`);
        return;
      }
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
        text: "Hi there! I'm EnquBuddy, your learning assistant. I can help with specific questions about Zoom, recordings, learning portal, platform features, and deadlines. For other questions, please contact <@abhilipsha>.",
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
              "text": "Hello! 👋 I'm your learning assistant bot. I can help answer questions about your learning programs and platform."
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
              "text": "• 💻 *Zoom issues* - joining meetings, testing audio/video\n• 📝 *Learning modules* - accessing portal, deadlines\n• 🎓 *Mock tests* - deadline extension policies\n• 📹 *Recordings* - where to find session recordings\n• 🔑 *Portal access* - learning portal login\n• 📅 *Calendar* - learning calendar access\n• 🖥️ *Platform features* - filters, tasks, navigation\n• 📊 *Dashboard* - viewing progress, assignments\n• 🏷️ *Content types* - skill paths, projects, scenarios"
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
        
        // Add predefined Q&A pairs including Enqurious platform FAQs
        try {
          await addPredefinedQAs();
          console.log('Predefined Q&A pairs added successfully (including Enqurious platform FAQs).');
        } catch (predefinedError) {
          console.error('Error adding predefined Q&A pairs:', predefinedError);
        }
        
      } catch (indexError) {
        console.error('Error creating indexes:', indexError);
      }
    } else {
      console.warn('MongoDB connection failed, continuing without question logging');
      isConnected = false;
    }
    
    // Start the Slack app
    await app.start(PORT);
    console.log(`⚡️ Educational Bot is running on port ${PORT}! Consolidated version with Enqurious platform FAQs - single responses only.`);
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
