// db.js - Updated for multi-workspace support
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Use environment variable for URI
const uri = process.env.MONGODB_URI;

// Create a MongoClient instance
const client = new MongoClient(uri);

// Database and collections
const dbName = 'botlogs';
const questionsCollectionName = 'questions';
const installationsCollectionName = 'installations';

// Connect to MongoDB
async function connectToDatabase() {
  try {
    await client.connect();
    console.log("Connected to MongoDB Atlas");
    return client.db(dbName);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    throw error;
  }
}

// Get a specific collection
async function getCollection(collectionName) {
  const db = await connectToDatabase();
  return db.collection(collectionName);
}

// Log a question to the database with workspace ID
async function logQuestion(userId, username, channelId, channelName, text, response, workspaceId) {
  try {
    const collection = await getCollection(questionsCollectionName);
    const result = await collection.insertOne({
      userId,
      username,
      channelId,
      channelName,
      question: text,
      response,
      workspaceId,  // Add workspace ID
      timestamp: new Date()
    });
    console.log(`Question logged with ID: ${result.insertedId} for workspace: ${workspaceId}`);
    return result;
  } catch (error) {
    console.error("Error logging question:", error);
  }
}

// Get frequently asked questions for a specific workspace
async function getFrequentQuestions(workspaceId, limit = 10) {
  try {
    const collection = await getCollection(questionsCollectionName);
    const questions = await collection.aggregate([
      { $match: { workspaceId } },  // Filter by workspace
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

// Save workspace installation
async function saveInstallation(installation) {
  try {
    const collection = await getCollection(installationsCollectionName);
    const result = await collection.replaceOne(
      { 'team.id': installation.team.id },
      {
        ...installation,
        installedAt: new Date(),
        lastUpdated: new Date()
      },
      { upsert: true }
    );
    console.log(`Installation saved for workspace: ${installation.team.name}`);
    return result;
  } catch (error) {
    console.error("Error saving installation:", error);
    throw error;
  }
}

// Get installation for a workspace
async function getInstallation(teamId) {
  try {
    const collection = await getCollection(installationsCollectionName);
    const installation = await collection.findOne({ 'team.id': teamId });
    return installation;
  } catch (error) {
    console.error("Error getting installation:", error);
    return null;
  }
}

// Get all installations
async function getAllInstallations() {
  try {
    const collection = await getCollection(installationsCollectionName);
    const installations = await collection.find({}).toArray();
    return installations;
  } catch (error) {
    console.error("Error getting all installations:", error);
    return [];
  }
}

// Close the MongoDB connection
async function closeConnection() {
  await client.close();
  console.log("MongoDB connection closed");
}

// Export the client for use in other modules
module.exports = {
  client,
  logQuestion,
  getFrequentQuestions,
  saveInstallation,
  getInstallation,
  getAllInstallations,
  closeConnection,
  connectToDatabase,
  getCollection
};
