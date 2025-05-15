const TOPICS = {
  // Core educational categories
  ZOOM: 'zoom',
  SLACK: 'slack',
  RECORDINGS: 'recordings',
  LEARNING: 'learning',
  ILT: 'ilt',
  ASSESSMENT: 'assessment',
  
  // Administrative categories
  SCHEDULE: 'schedule',
  DEADLINES: 'deadlines',
  ACCESS: 'access',
  PORTAL: 'portal',
  LOGIN: 'login',
  
  // Technical categories
  TECHNICAL: 'technical',
  CONNECTIVITY: 'connectivity',
  SUPPORT: 'support'
};

// ==========================================
// COURSE DETAILS (POPULATE WITH YOUR SPECIFIC DETAILS)
// ==========================================

const COURSE_INFO = {
  name: 'Enqurious Client Programs - Databricks',
  supportEmail: 'support@enqurious.com',
  portalUrl: 'https://www.tredence.enqurious.com/auth/login?redirect_uri=/',
  calendarUrl: 'https://docs.google.com/spreadsheets/d/11kw1hvG5dLX9a6GwRd1UF_Mq9ivgCJvr-_2mtd6Z7OQ/edit?gid=0#gid=0',
  recordingsUrl: 'https://drive.google.com/drive/folders/1I6wXvcKTyXzxsQd19SpOmFrbIWta7vnq?usp=sharing',
  recordingsAccessVideo: 'https://drive.google.com/file/d/1VSP-WKi8f8GStQ_UMuzqtRvGZindhl_n/view',
  portalAccessVideo: 'https://drive.google.com/file/d/1VSP-WKi8f8GStQ_UMuzqtRvGZindhl_n/view',
  learningPortalVideo: 'https://drive.google.com/file/d/1fIyf4GCcOSxYQ4MhJIblJ5_dWx4aHGI6/view?usp=drive_link'
};

// ==========================================
// PATTERN MATCHING ENGINE
// ==========================================

// Complex pattern matching using regular expressions
const regexPatterns = [
  // Zoom-related patterns
  {
    pattern: /(how|where|what).+(join|access).+(zoom|meeting|session)/i,
    handler: () => {
      return "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided in the invitation email.";
    },
    topic: TOPICS.ZOOM
  },
  
  // Recording access patterns
  {
    pattern: /(how|where|can).+(access|find|view|watch).+(recording|session)/i,
    handler: () => {
      return `You can access session recordings through this link: ${COURSE_INFO.recordingsUrl}. Recordings usually take 1-2 days to be uploaded after a session. If you can't find a specific recording after 2 days, please inform your mentor or drop a message in the Slack group. For a detailed guide, check this video: ${COURSE_INFO.recordingsAccessVideo}`;
    },
    topic: TOPICS.RECORDINGS
  },
  
  // Login issues patterns
  {
    pattern: /(unable|can't|having|trouble|issue|problem).+(log|login|sign|access).+(zoom|account)/i,
    handler: () => {
      return "If you're having trouble logging into your Zoom account, double-check your credentials, reset your password if necessary, and ensure you're using the correct email associated with your account. If you get an error message like 'This meeting is for authorized registrants only,' confirm that you're using the correct email and that it matches your registration.";
    },
    topic: TOPICS.ZOOM
  },
  
  // Error message patterns
  {
    pattern: /(error|message).+(authorized|registrants|only)/i,
    handler: () => {
      return "If you're getting the error 'This meeting is for authorized registrants only,' follow these steps to fix the issue:\n1. Create a Zoom account using your company email\n2. Click on the meeting invite in your inbox, enter your details, and join the session";
    },
    topic: TOPICS.ZOOM
  },
  
  // Help desk related patterns
  {
    pattern: /(help desk|helpdesk|support desk|tech support)/i,
    handler: () => {
      return "There is a Help desk app available in Slack, but direct messaging to it has been turned off. For technical issues that I can't resolve, please post in the appropriate support channel or contact your instructor/mentor directly.";
    },
    topic: TOPICS.SUPPORT
  },
  
  // Deadline extension patterns
  {
    pattern: /(miss|extend|extension|deadline).+(practice|assignment|submission|test)/i,
    handler: () => {
      return "Generally, deadlines are strict, but you can ask if extensions are possible by contacting the program coordinator. Note that for mock tests and partial mock tests, we cannot extend the timeline as these are already being worked on by the TALL Team and can only be changed upon their approval. So kindly keep up with the Learning calendar.";
    },
    topic: TOPICS.DEADLINES
  },
  
  // Learning modules and ILT patterns
  {
    pattern: /(what|explain).+(learning|ilt|assessment).+(mean|calendar)/i,
    handler: () => {
      return "Here's what each term in the Learning Calendar means:\n1. Learning: Self-study modules available on the Enqurious learning portal\n2. ILT (Instructor-Led Training): Live sessions conducted by mentors on Zoom where you can ask questions, discuss problems, and gain deeper insights\n3. Assessment: Mock tests to be attempted at the end of the program";
    },
    topic: TOPICS.LEARNING
  },
  
  // Self-paced modules patterns
  {
    pattern: /(how|where).+(access|find).+(self|paced|module)/i,
    handler: () => {
      return `You can access self-paced modules by logging into the Enqurious learning portal here: ${COURSE_INFO.portalUrl}. Simply click on a topic to access its content and start learning. For a visual guide, refer to this short video: ${COURSE_INFO.learningPortalVideo}`;
    },
    topic: TOPICS.LEARNING
  },
  
  // ILT schedule patterns
  {
    pattern: /(how|where).+(check|know|find).+(ilt|schedule|calendar)/i,
    handler: () => {
      return `You can visit the Learning calendar here: ${COURSE_INFO.calendarUrl} and check if you have any ILTs on a specific date.`;
    },
    topic: TOPICS.SCHEDULE
  },
  
  // Portal login issues patterns
  {
    pattern: /(login|logging in|sign in|access)\s+(issue|problem|trouble|help|can't|cannot|unable)\s+(.*?)(enqurious|portal)/i,
    handler: () => {
      return `If you're having trouble logging into the Enqurious Portal, here are some troubleshooting steps:\n\n1. Make sure you're using the correct URL: ${COURSE_INFO.portalUrl}\n2. Double-check that you're using the exact credentials provided in your company email\n3. Clear your browser cache or try using an incognito/private browsing window\n4. Try a different browser (Chrome or Firefox recommended)\n5. If you've forgotten your password, use the 'Forgot Password' option on the login page\n\nIf you're still experiencing issues, please reach out to the support team at ${COURSE_INFO.supportEmail} with a screenshot of any error messages you're seeing.`;
    },
    topic: TOPICS.PORTAL
  },
  
  // Portal login help patterns
  {
    pattern: /(help|how)\s+(.*?)(login|logging in|sign in|access)\s+(.*?)(enqurious|portal)/i,
    handler: () => {
      return `To access the Enqurious Portal:\n\n1. Navigate to the Enqurious portal login page: ${COURSE_INFO.portalUrl}\n2. Enter the login credentials provided in your company email\n3. Your username is typically your work email address\n4. Enter the password provided in your onboarding email (or the one you've set if you've changed it)\n5. Click the "Login" button\n\nIf this is your first time logging in, you'll be prompted to change your password. For a visual guide, check this video: ${COURSE_INFO.portalAccessVideo}`;
    },
    topic: TOPICS.PORTAL
  },
  
  // Gmail access issue patterns
  {
    pattern: /(access|folder).+(asking|gmail|account)/i,
    handler: () => {
      return "If you're having trouble accessing resources that require a Gmail account, try accessing them from an incognito tab in your browser.";
    },
    topic: TOPICS.ACCESS
  }
];

// ==========================================
// SIMPLE KEYWORD MATCHING
// ==========================================

// Simple keyword matching for common questions
function getSimpleMatch(query) {
  const normalizedQuery = query.toLowerCase();
  
  // Map of keywords to answers
  const simpleResponses = {
    // ZOOM & TECHNICAL
    "zoom and slack": "We use Zoom for interactive instructor-led training and addressing student questions. Slack serves as our platform for group discussions.",
    
    "join meeting": "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided in the invitation email.",
    
    "joining meeting": "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided in the invitation email.",
    
    "join zoom": "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided in the invitation email.",
    
    "join session": "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided in the invitation email.",
    
    "zoom email": "It's recommended to use your official email for attendance tracking and access to recordings. If you want to change your Zoom email, log into your Zoom account settings and update your email address. Make sure to verify the new email.",
    
    "technical issue": "For technical issues, contact the support team or reach out in the Slack group for immediate assistance.",
    
    "connectivity issues": "Check your internet connection and try rejoining the meeting. If issues persist, you may need to switch to a different network.",
    
    "error message": "If you see an error message like 'This meeting is for authorized registrants only,' confirm that you're using the correct email and that it matches your registration.",
    
    "didn't receive email": "Check your spam/junk folder first. If it's not there, reach out to the mentor on Slack to resend the link.",
    
    // RECORDINGS & RESOURCES
    "meeting recordings": "Meeting recordings are usually uploaded to a shared drive after the session. Check the Slack Canvas Bookmarks for the link to the drive. Recordings typically take 1-2 days to be uploaded.",
    
    "recordings": "Meeting recordings are usually uploaded to a shared drive after the session. Check the Slack Canvas Bookmarks for the link to the drive. Recordings typically take 1-2 days to be uploaded.",
    
    "session recording": "Meeting recordings are usually uploaded to a shared drive after the session. Check the Slack Canvas Bookmarks for the link to the drive. Recordings typically take 1-2 days to be uploaded.",
    
    "watch recording": "Meeting recordings are usually uploaded to a shared drive after the session. Check the Slack Canvas Bookmarks for the link to the drive. Recordings typically take 1-2 days to be uploaded.",
    
    "access practice tests": "Practice tests and resources are usually shared via email or through a designated channel in your communication platform.",
    
    // LEARNING & ASSESSMENT
    "self-paced modules": "No, you don't have to complete self-paced modules within the given time. The time mentioned is just for your reference. You can complete the modules at your own pace.",
    
    "modules": "You can access self-paced modules by logging into the Enqurious learning portal. These are self-study materials that you can complete at your own pace.",
    
    "self paced": "No, you don't have to complete self-paced modules within the given time. The time mentioned is just for your reference. You can complete the modules at your own pace.",
    
    "learning modules": "Learning modules are self-study materials available on the Enqurious learning portal. You can complete these at your own pace.",
    
    "mock test": "No, we cannot extend the timeline for the mock test and partial mock test. These are already being worked on by the TALL Team and can only be changed or extended upon their approval. So kindly keep up with the Learning calendar.",
    
    "assessment": "Assessments include mock tests to be attempted at the end of the program. The timeline for mock tests cannot be extended as these are already being worked on by the TALL Team.",
    
    "what is ilt": "ILT stands for Instructor-Led Training. These are live sessions conducted by mentors on Zoom where you can ask questions, discuss problems, and gain deeper insights.",
    
    "what is learning": "In the Learning Calendar, 'Learning' refers to self-study modules available on the Enqurious learning portal.",
    
    // ACCESS & LOGIN
    "portal login": "To access the Enqurious Portal, navigate to the login page, enter the credentials provided in your company email, and upon successful login, you can change your password and username.",
    
    "login portal": "To access the Enqurious Portal, navigate to the login page, enter the credentials provided in your company email, and upon successful login, you can change your password and username.",
    
    "access portal": "To access the Enqurious Portal, navigate to the login page, enter the credentials provided in your company email, and upon successful login, you can change your password and username.",
    
    "enqurious portal": "To access the Enqurious Portal, navigate to the login page, enter the credentials provided in your company email, and upon successful login, you can change your password and username.",
    
    "login issue": "If you're having trouble logging into the Enqurious Portal, try these troubleshooting steps: 1) Make sure you're using the correct URL, 2) Double-check your credentials, 3) Clear your browser cache, 4) Try a different browser, 5) Use the 'Forgot Password' option if needed.",
    
    "trouble logging in": "If you're having trouble logging into the Enqurious Portal, try these troubleshooting steps: 1) Make sure you're using the correct URL, 2) Double-check your credentials, 3) Clear your browser cache, 4) Try a different browser, 5) Use the 'Forgot Password' option if needed.",
    
    "can't login": "If you're having trouble logging into the Enqurious Portal, try these troubleshooting steps: 1) Make sure you're using the correct URL, 2) Double-check your credentials, 3) Clear your browser cache, 4) Try a different browser, 5) Use the 'Forgot Password' option if needed.",
    
    "gmail account": "If you're having trouble accessing resources that require a Gmail account, try accessing them from an incognito tab in your browser.",
    
    "help desk": "There is a Help desk app available in Slack, but direct messaging to it has been turned off. For technical issues that I can't resolve, please post in the appropriate support channel or contact your instructor/mentor directly.",
    
    "helpdesk": "There is a Help desk app available in Slack, but direct messaging to it has been turned off. For technical issues that I can't resolve, please post in the appropriate support channel or contact your instructor/mentor directly.",
    
    "help": "I can answer questions about Zoom sessions, recordings, learning modules, ILTs, assessments, and more. For technical issues I can't resolve, you may need to contact your instructor or post in the appropriate support channel.",
    
    "support": "I can help with many common questions. For technical issues I can't resolve, note that there is a Help desk app in Slack, but direct messaging to it has been turned off. Instead, please post in the appropriate support channel or contact your instructor/mentor directly."
  };
  
  // Check if any key phrase is in the query
  for (const [keyPhrase, answer] of Object.entries(simpleResponses)) {
    if (normalizedQuery.includes(keyPhrase)) {
      return answer;
    }
  }
  
  // No match found
  return null;
}

// ==========================================
// TOPIC IDENTIFICATION
// ==========================================

// Detect general topic when specific question isn't recognized
function identifyTopic(query) {
  const topicMatches = {
    "zoom": "I can help with Zoom-related questions such as joining meetings, troubleshooting errors, or changing account settings. What specific information do you need about Zoom?",
    
    "meeting": "I can help with information about Zoom meetings, such as how to join, troubleshooting, or accessing recordings. What would you like to know?",
    
    "recordings": "Session recordings are typically uploaded 1-2 days after the session. Would you like to know how to access them or are you looking for a specific recording?",
    
    "slack": "Slack is our platform for group discussions and getting help. What would you like to know about using Slack for this program?",
    
    "login": "I can help with login issues for Zoom or the Enqurious portal. Which platform are you trying to access?",
    
    "ilt": "ILT stands for Instructor-Led Training, which are live sessions conducted by mentors. Would you like to know the schedule or how to join these sessions?",
    
    "assessment": "Assessments include practice sets and mock tests to evaluate your learning. Do you have questions about deadlines, accessing, or submitting assessments?",
    
    "technical": "I can help with technical issues related to Zoom, the learning portal, or accessing resources. What specific technical problem are you experiencing?",
    
    "deadline": "Would you like to know about deadlines for assignments, practice sets, or assessments? Or do you need information about possible extensions?",
    
    "portal": "The Enqurious portal is where you access self-paced learning modules. Do you need help logging in or navigating the portal?",
    
    "join": "Are you trying to join a Zoom meeting or access some other resource? Let me know what you're trying to join and I can provide specific instructions.",
    
    "error": "Are you experiencing an error with Zoom, the learning portal, or something else? Please provide more details about the error you're encountering.",
    
    "modules": "Self-paced learning modules are available on the Enqurious portal. Would you like to know how to access them or have questions about specific modules?",
    
    "calendar": "The Learning Calendar shows your schedule including learning modules, ILTs, and assessments. Would you like to know how to access it or have questions about specific dates?"
  };
  
  const normalizedQuery = query.toLowerCase();
  
  for (const [topic, response] of Object.entries(topicMatches)) {
    if (normalizedQuery.includes(topic)) {
      return response;
    }
  }
  
  // No topic identified
  return null;
}

// ==========================================
// MAIN KNOWLEDGE BASE FUNCTION
// ==========================================

// Main function to get knowledge base answer
function getKnowledgeBaseAnswer(query) {
  if (!query) return null;
  
  // Try simple keyword matching first
  const simpleMatch = getSimpleMatch(query);
  if (simpleMatch) return simpleMatch;
  
  // Try regex patterns for more complex matching
  for (const { pattern, handler } of regexPatterns) {
    const matches = query.match(pattern);
    if (matches) {
      return handler(matches);
    }
  }
  
  // Try to identify the general topic
  const topicResponse = identifyTopic(query);
  if (topicResponse) return topicResponse;
  
  // No match found
  return null;
}

// ==========================================
// EXPORTED INTERFACES
// ==========================================

module.exports = {
  getSimpleMatch,
  getKnowledgeBaseAnswer,
  TOPICS,
  COURSE_INFO,
  regexPatterns
};
