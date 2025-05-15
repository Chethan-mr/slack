// app.js - Updated with MongoDB logging
const { App } = require('@slack/bolt');
const dotenv = require('dotenv');
const { logQuestion } = require('./db'); // Import the database function

// Load environment variables
dotenv.config();

// Initialize the app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Simple message handler with direct responses and question logging
app.message(async ({ message, say, client }) => {
  console.log('Received message:', message.text);
  
  try {
    const text = message.text?.toLowerCase() || '';
    let response = "I'm not sure I understand that question. Could you rephrase it or ask about Zoom, ILT sessions, recordings, or the learning portal?";
    
    // Your existing message handling logic...
    // (all of your if/else patterns for responses)
    
    // Send the response
    await say(response);
    console.log('Sent response:', response);
    
    // Get user info for better logging
    try {
      const userInfo = await client.users.info({ user: message.user });
      const username = userInfo.user.name;
      
      // Get channel info
      const channelInfo = await client.conversations.info({ channel: message.channel });
      const channelName = channelInfo.channel.name || 'direct-message';
      
      // Log the question to MongoDB
      await logQuestion(
        message.user,
        username,
        message.channel,
        channelName,
        message.text,
        response
      );
    } catch (dbError) {
      console.error('Error logging to database:', dbError);
      // Continue with the bot's operation even if logging fails
    }
  } catch (error) {
    console.error('Error processing message:', error);
    await say("I'm sorry, I encountered an error. Please try again.");
  }
});

// Rest of your app.js code...
