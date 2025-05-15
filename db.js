// db.js
const { MongoClient } = require('mongodb');

// Connection URI (replace with your MongoDB Atlas connection string)
const uri = "mongodb+srv://username:password@enqubuddylogs.mongodb.net/botlogs?retryWrites=true&w=majority";

// Create a MongoClient instance
const client = new MongoClient(uri);

// Database and collection
const dbName = 'botlogs';
const collectionName = 'questions';

// Connect to MongoDB
async function connectToDatabase() {
  try {
    await client.connect();
    console.log("Connected to MongoDB Atlas");
    return client.db(dbName).collection(collectionName);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    throw error;
  }
}

// Log a question to the database
async function logQuestion(userId, username, channelId, channelName, text, response) {
  try {
    const collection = await connectToDatabase();
    const result = await collection.insertOne({
      userId,
      username,
      channelId,
      channelName,
      question: text,
      response,
      timestamp: new Date()
    });
    console.log(`Question logged with ID: ${result.insertedId}`);
    return result;
  } catch (error) {
    console.error("Error logging question:", error);
  }
}

// Get frequently asked questions
async function getFrequentQuestions(limit = 10) {
  try {
    const collection = await connectToDatabase();
    const questions = await collection.aggregate([
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
    console.error("Error getting frequent questions:", error);
    return [];
  }
}

// Close the MongoDB connection
async function closeConnection() {
  await client.close();
  console.log("MongoDB connection closed");
}

module.exports = {
  logQuestion,
  getFrequentQuestions,
  closeConnection
};
