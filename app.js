// app.js - HTTP-based version (no Socket Mode)
const { App } = require('@slack/bolt');
const dotenv = require('dotenv');
const { processMessage } = require('./conversation-handler');

// Load environment variables
dotenv.config();

// Initialize the Slack app WITHOUT Socket Mode
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  // Remove socketMode and appToken
});

// Listen for direct messages to the bot
app.message(async ({ message, say }) => {
  // Ignore bot's own messages
  if (message.subtype === 'bot_message') return;
  
  console.log('Received message:', message.text);
  
  try {
    // Process the message
    const response = await processMessage(
      message, 
      message.user, 
      message.channel
    );
    
    // Send the response
    await say(response);
    console.log('Sent response:', response);
  } catch (error) {
    console.error('Error processing message:', error);
    await say("I'm sorry, I encountered an error while processing your message. Please try again.");
  }
});

// Listen for mentions of the bot in channels
app.event('app_mention', async ({ event, say }) => {
  // Extract the query (remove the bot mention)
  const text = event.text.replace(/<@[A-Z0-9]+>/, "").trim();
  console.log('Received mention:', text);
  
  // Create a message-like object
  const message = {
    text: text,
    user: event.user,
    channel: event.channel,
    ts: event.ts
  };
  
  try {
    // Process the message
    const response = await processMessage(
      message,
      event.user,
      event.channel
    );
    
    // Reply to the mention (in thread)
    await say({
      text: response,
      thread_ts: event.ts
    });
    console.log('Sent mention response:', response);
  } catch (error) {
    console.error('Error processing mention:', error);
    await say({
      text: "I'm sorry, I encountered an error while processing your message. Please try again.",
      thread_ts: event.ts
    });
  }
});

// Define the port to run on
const PORT = process.env.PORT || 3000;

// Start the app
(async () => {
  await app.start(PORT);
  console.log(`⚡️ Educational Bot is running on port ${PORT}!`);
})();