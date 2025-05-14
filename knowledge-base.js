// knowledge-base.js - Structured Knowledge
// ==========================================
// This file contains predefined answers for common questions

// Simple keyword-based matching
function getKnowledgeBaseAnswer(query) {
  const normalizedQuery = query.toLowerCase();
  
  // Map of keywords to answers
  const knowledgeBase = {
    "course schedule": "The course schedule is available on the learning portal under 'Calendar'. Classes are held Monday, Wednesday, and Friday from 10am-12pm.",
    
    "assignment deadline": "Assignment deadlines are typically set for Sundays at 11:59 PM. Please check the specific assignment for exact deadlines.",
    
    "how to submit": "Assignments should be submitted through the learning portal. Go to 'Assignments', select the relevant assignment, and click 'Submit' to upload your work.",
    
    "grading policy": "The course is graded as follows: Assignments (40%), Midterm (25%), Final Project (25%), Participation (10%). You need at least 70% to pass the course.",
    
    "technical help": "For technical issues, please email support@learningportal.com or visit the Help Desk in Room 201 during business hours (9am-5pm).",
    
    "office hours": "Instructor office hours are Tuesdays and Thursdays from 2-4pm in Room 305, or by appointment. Teaching assistants hold additional help sessions on Wednesdays from 3-5pm.",
  };
  
  // Check if any key phrase is in the query
  for (const [keyPhrase, answer] of Object.entries(knowledgeBase)) {
    if (normalizedQuery.includes(keyPhrase)) {
      return answer;
    }
  }
  
  // No match found
  return null;
}

// Advanced matching using regular expressions
// You can extend this to include more sophisticated matching
const regexPatterns = [
  {
    pattern: /when\s+is\s+(\w+)\s+due/i,
    handler: (matches) => {
      const assignment = matches[1];
      // This would typically connect to a database or API
      return `The ${assignment} assignment is due on Sunday at 11:59 PM. Please check the learning portal for the exact date.`;
    }
  },
  
  {
    pattern: /how\s+do\s+I\s+access\s+(\w+)/i,
    handler: (matches) => {
      const resource = matches[1];
      return `To access ${resource}, log into the learning portal and look under the Resources tab. If you don't see it, please contact your instructor.`;
    }
  }
];

// Export functions
module.exports = {
  getKnowledgeBaseAnswer: (query) => {
    // Try simple keyword matching first
    const keywordMatch = getKnowledgeBaseAnswer(query);
    if (keywordMatch) return keywordMatch;
    
    // Try regex patterns
    for (const { pattern, handler } of regexPatterns) {
      const matches = query.match(pattern);
      if (matches) {
        return handler(matches);
      }
    }
    
    // No match found
    return null;
  }
};

// ==========================================
// OPTIONAL: More Advanced Features
// ==========================================

// 1. To connect to a database instead of using hardcoded knowledge:
/*
const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGODB_URI);

async function findInKnowledgeBase(query) {
  await client.connect();
  const db = client.db('learning-assistant');
  const collection = db.collection('faqs');
  
  // Use text search if you've set up a text index
  const result = await collection.findOne({ 
    $text: { $search: query } 
  }, {
    score: { $meta: "textScore" }
  }).sort({ score: { $meta: "textScore" } });
  
  return result ? result.answer : null;
}
*/

// 2. Adding feedback mechanisms to improve the bot
/*
app.action('thumbs_up', async ({ body, ack }) => {
  await ack();
  // Log positive feedback
  console.log(`User ${body.user.id} found answer helpful`);
  // Thank the user
  await app.client.chat.postEphemeral({
    channel: body.channel.id,
    user: body.user.id,
    text: "Thanks for the feedback! I'm glad that was helpful."
  });
});

app.action('thumbs_down', async ({ body, ack, say }) => {
  await ack();
  // Log negative feedback
  console.log(`User ${body.user.id} found answer unhelpful`);
  // Offer additional help
  await app.client.chat.postEphemeral({
    channel: body.channel.id,
    user: body.user.id,
    text: "I'm sorry that wasn't helpful. Would you like me to connect you with a human instructor?"
  });
});
*/

// 3. Scheduling reminders for upcoming deadlines
/*
const schedule = require('node-schedule');

// Send a reminder every Monday at 9am
schedule.scheduleJob('0 9 * * 1', async () => {
  // Get all channels the bot is in
  const channelList = await app.client.conversations.list();
  
  // Get upcoming assignments (from your database or API)
  const upcomingAssignments = getUpcomingAssignments();
  
  if (upcomingAssignments.length > 0) {
    const reminderText = `📅 *Weekly Reminder*\nUpcoming deadlines:\n${
      upcomingAssignments.map(a => `• ${a.name}: due ${a.dueDate}`).join('\n')
    }`;
    
    // Send to all channels
    for (const channel of channelList.channels) {
      if (channel.is_member) {
        await app.client.chat.postMessage({
          channel: channel.id,
          text: reminderText
        });
      }
    }
  }
});
*/