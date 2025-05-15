const { MongoClient } = require('mongodb');

// MongoDB Connection Configuration (using environment variables)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://chethan:Chethann@1995@SlackBotAnalytics.mongodb.net/botlogs?retryWrites=true&w=majority';
const DB_NAME = 'botlogs';
const COLLECTION_NAME = 'questions';

// MongoDB Client
let mongoClient = null;
let questionsCollection = null;
let isConnected = false;

// Connect to MongoDB
async function connectToMongoDB() {
  if (isConnected) return true;
  
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
    
    isConnected = true;
    return true;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    return false;
  }
}

// Log a question to MongoDB
async function logQuestion(userId, username, channelId, channelName, question, response, matched) {
  if (!isConnected) {
    const connected = await connectToMongoDB();
    if (!connected) return;
  }
  
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
    return result.insertedId;
  } catch (error) {
    console.error('Error logging question:', error);
    return null;
  }
}

// Get frequent questions (for admin reporting)
async function getFrequentQuestions(limit = 10) {
  if (!isConnected) {
    const connected = await connectToMongoDB();
    if (!connected) return [];
  }
  
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
  if (!isConnected) {
    const connected = await connectToMongoDB();
    if (!connected) return [];
  }
  
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
  if (!isConnected) {
    const connected = await connectToMongoDB();
    if (!connected) return { total: 0, matched: 0, unmatched: 0 };
  }
  
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

// Get recent questions by a specific user
async function getUserQuestions(userId, limit = 10) {
  if (!isConnected) {
    const connected = await connectToMongoDB();
    if (!connected) return [];
  }
  
  try {
    const questions = await questionsCollection.find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    return questions;
  } catch (error) {
    console.error('Error getting user questions:', error);
    return [];
  }
}

// Get questions by date range
async function getQuestionsByDateRange(startDate, endDate, limit = 100) {
  if (!isConnected) {
    const connected = await connectToMongoDB();
    if (!connected) return [];
  }
  
  try {
    const questions = await questionsCollection.find({
      timestamp: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    return questions;
  } catch (error) {
    console.error('Error getting questions by date range:', error);
    return [];
  }
}

// Close MongoDB connection
async function closeMongoDB() {
  if (mongoClient) {
    try {
      await mongoClient.close();
      console.log('MongoDB connection closed');
      isConnected = false;
    } catch (error) {
      console.error('Error closing MongoDB connection:', error);
    }
  }
}

module.exports = {
  connectToMongoDB,
  logQuestion,
  getFrequentQuestions,
  getUnansweredQuestions,
  getQuestionStats,
  getUserQuestions,
  getQuestionsByDateRange,
  closeMongoDB
};
