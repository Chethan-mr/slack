// enhanced-knowledge-base.js
// SIMPLIFIED VERSION: Only provides utility functions, NO hardcoded responses or course info

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
// GENERIC COURSE DETAILS (NO HARDCODED PROGRAM NAMES)
// ==========================================

const GENERIC_COURSE_INFO = {
  supportEmail: 'support@enqurious.com',
  portalUrl: 'https://www.tredence.enqurious.com/auth/login?redirect_uri=/',
  calendarUrl: 'https://docs.google.com/spreadsheets/d/11kw1hvG5dLX9a6GwRd1UF_Mq9ivgCJvr-_2mtd6Z7OQ/edit?gid=0#gid=0',
  recordingsUrl: 'https://drive.google.com/drive/folders/1I6wXvcKTyXzxsQd19SpOmFrbIWta7vnq?usp=sharing',
  recordingsAccessVideo: 'https://drive.google.com/file/d/1VSP-WKi8f8GStQ_UMuzqtRvGZindhl_n/view',
  portalAccessVideo: 'https://drive.google.com/file/d/1VSP-WKi8f8GStQ_UMuzqtRvGZindhl_n/view',
  learningPortalVideo: 'https://drive.google.com/file/d/1fIyf4GCcOSxYQ4MhJIblJ5_dWx4aHGI6/view?usp=drive_link'
};

// ==========================================
// TOPIC IDENTIFICATION UTILITIES
// ==========================================

/**
 * Detect general topic from query text
 * @param {string} query - User's query
 * @returns {string|null} - Identified topic or null
 */
function identifyTopic(query) {
  if (!query) return null;
  
  const normalizedQuery = query.toLowerCase();
  
  // Topic identification mapping
  const topicKeywords = {
    [TOPICS.ZOOM]: ['zoom', 'meeting', 'join', 'audio', 'video', 'microphone', 'camera'],
    [TOPICS.RECORDINGS]: ['recording', 'recordings', 'session video', 'watch session'],
    [TOPICS.LEARNING]: ['learning', 'module', 'self-paced', 'course content'],
    [TOPICS.ILT]: ['ilt', 'instructor led', 'live session', 'mentor'],
    [TOPICS.ASSESSMENT]: ['assessment', 'mock test', 'partial mock', 'test', 'exam'],
    [TOPICS.PORTAL]: ['portal', 'login', 'sign in', 'enqurious'],
    [TOPICS.SCHEDULE]: ['schedule', 'calendar', 'timetable', 'when'],
    [TOPICS.DEADLINES]: ['deadline', 'extend', 'timeline', 'due date'],
    [TOPICS.TECHNICAL]: ['technical', 'issue', 'problem', 'error', 'trouble'],
    [TOPICS.SUPPORT]: ['help', 'support', 'assistance', 'contact']
  };
  
  // Find the topic with the most keyword matches
  let bestTopic = null;
  let bestScore = 0;
  
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    const matches = keywords.filter(keyword => normalizedQuery.includes(keyword)).length;
    if (matches > bestScore) {
      bestScore = matches;
      bestTopic = topic;
    }
  }
  
  return bestScore > 0 ? bestTopic : null;
}

/**
 * Check if a query is likely a question
 * @param {string} text - Query text
 * @returns {boolean} - Whether it looks like a question
 */
function isLikelyQuestion(text) {
  if (!text) return false;
  
  // Check for question marks
  if (text.includes('?')) return true;
  
  // Check for question words at the beginning
  const questionWords = ['what', 'how', 'where', 'when', 'why', 'who', 'can', 'could', 'do', 'does', 'is', 'are'];
  const firstWord = text.trim().toLowerCase().split(' ')[0];
  if (questionWords.includes(firstWord)) return true;
  
  // Check for phrases that indicate questions
  const questionPhrases = [
    'i need help', 'help me', 'looking for', 'trying to figure out',
    'can anyone', 'does anyone', 'is there', 'tell me', 'explain'
  ];
  
  return questionPhrases.some(phrase => text.toLowerCase().includes(phrase));
}

/**
 * Get relevant URLs based on topic
 * @param {string} topic - Identified topic
 * @returns {object|null} - Relevant URLs or null
 */
function getTopicUrls(topic) {
  const urlMapping = {
    [TOPICS.PORTAL]: {
      primary: GENERIC_COURSE_INFO.portalUrl,
      help: GENERIC_COURSE_INFO.portalAccessVideo
    },
    [TOPICS.SCHEDULE]: {
      primary: GENERIC_COURSE_INFO.calendarUrl
    },
    [TOPICS.RECORDINGS]: {
      primary: GENERIC_COURSE_INFO.recordingsUrl,
      help: GENERIC_COURSE_INFO.recordingsAccessVideo
    },
    [TOPICS.LEARNING]: {
      primary: GENERIC_COURSE_INFO.portalUrl,
      help: GENERIC_COURSE_INFO.learningPortalVideo
    }
  };
  
  return urlMapping[topic] || null;
}

/**
 * Simple confidence scoring for answers
 * @param {string} query - User's query
 * @param {string} answer - Potential answer
 * @returns {number} - Confidence score (0-1)
 */
function calculateConfidence(query, answer) {
  if (!query || !answer) return 0;
  
  const queryWords = query.toLowerCase().split(' ').filter(word => word.length > 2);
  const answerWords = answer.toLowerCase().split(' ');
  
  let matches = 0;
  for (const qWord of queryWords) {
    if (answerWords.some(aWord => aWord.includes(qWord) || qWord.includes(aWord))) {
      matches++;
    }
  }
  
  return queryWords.length > 0 ? matches / queryWords.length : 0;
}

// ==========================================
// EXPORTED INTERFACES
// ==========================================

module.exports = {
  TOPICS,
  GENERIC_COURSE_INFO,
  identifyTopic,
  isLikelyQuestion,
  getTopicUrls,
  calculateConfidence
};
