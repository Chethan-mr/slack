// app.js - Enhanced with casual conversation support
const { App } = require('@slack/bolt');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize the app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Simple message handler with direct responses
app.message(async ({ message, say }) => {
  console.log('Received message:', message.text);
  
  try {
    const text = message.text?.toLowerCase() || '';
    let response = "I'm not sure I understand that question. Could you rephrase it or ask about Zoom, ILT sessions, recordings, or the learning portal?";
    
    // CASUAL CONVERSATION PATTERNS
    if (text.match(/hi|hello|hey|greetings/i)) {
      response = "Hello! 👋 I'm your learning assistant bot. How can I help you today with the Enqurious Databricks program?";
    }
    else if (text.match(/how are you|how you doing|how's it going/i)) {
      response = "I'm doing well, thanks for asking! I'm here to help with any questions about the Enqurious Databricks program. What can I assist you with today?";
    }
    else if (text.match(/thank|thanks/i)) {
      response = "You're welcome! Feel free to ask if you have any other questions.";
    }
    else if (text.match(/who are you|what are you|what do you do/i)) {
      response = "I'm EnquBuddy, an assistant bot for the Enqurious Client Programs - Databricks course. I can help answer questions about Zoom sessions, recordings, learning modules, and more!";
    }
    
    // COURSE-SPECIFIC PATTERNS
    else if (text.includes('zoom') && (text.includes('login') || text.includes('loggin') || text.includes('log in'))) {
      response = "If you're having trouble logging into Zoom, double-check your credentials, reset your password if necessary, and ensure you're using the correct email associated with your account.";
    } 
    else if (text.includes('zoom') && text.includes('join')) {
      response = "To join the Zoom session, make sure you have created a Zoom account using your official email, verified it, and clicked the meeting link provided.";
    }
    else if (text.includes('recording') || text.includes('recordings')) {
      response = "Meeting recordings are usually uploaded to a shared drive after the session. Check the Slack Canvas Bookmarks for the link to the drive. Recordings typically take 1-2 days to be uploaded.";
    }
    else if (text.includes('error message')) {
      response = "If you see an error message like 'This meeting is for authorized registrants only,' confirm that you're using the correct email and that it matches your registration.";
    }
    else if (text.includes('portal') || text.includes('enqurious')) {
      response = "To access the Enqurious Portal, navigate to the login page, enter the credentials provided in your company email, and upon successful login, you can change your password and username.";
    }
    else if (text.includes('help')) {
      response = "I can help with questions about Zoom sessions, recordings, learning modules, ILTs, and more. What specific information do you need?";
    }
    else if (text.includes('learning') || text.includes('module')) {
      response = "Learning modules are self-study materials available on the Enqurious learning portal. You can complete these at your own pace.";
    }
    else if (text.includes('ilt')) {
      response = "ILT stands for Instructor-Led Training. These are live sessions conducted by mentors on Zoom where you can ask questions, discuss problems, and gain deeper insights.";
    }
    
    // Send the response
    await say(response);
    console.log('Sent response:', response);
  } catch (error) {
    console.error('Error processing message:', error);
    await say("I'm sorry, I encountered an error. Please try again.");
  }
});

// App mention handler
app.event('app_mention', async ({ event, say }) => {
  try {
    console.log('Received mention:', event.text);
    await say({
      text: "Thanks for mentioning me! I'm here to help with questions about the Enqurious Client Programs - Databricks course. What would you like to know?",
      thread_ts: event.ts
    });
  } catch (error) {
    console.error('Error processing mention:', error);
  }
});

// Home tab
app.event('app_home_opened', async ({ event, client }) => {
  try {
    await client.views.publish({
      user_id: event.user,
      view: {
        "type": "home",
        "blocks": [
          {
            "type": "header",
            "text": {
              "type": "plain_text",
              "text": "Enqurious Databricks Learning Assistant",
              "emoji": true
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "Hello! 👋 I'm your learning assistant bot. I can help answer questions about the Enqurious Client Programs - Databricks course."
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
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error publishing home view:', error);
  }
});

// Define the port
const PORT = process.env.PORT || 3000;

// Start the app
(async () => {
  try {
    await app.start(PORT);
    console.log(`⚡️ Educational Bot is running on port ${PORT}!`);
  } catch (error) {
    console.error('Error starting the app:', error);
  }
})();
