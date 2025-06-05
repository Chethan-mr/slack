// test-oauth.js - Test your OAuth setup
const dotenv = require('dotenv');
dotenv.config();

console.log('=== OAuth Configuration Test ===\n');

// Check required environment variables
const requiredVars = [
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
  'MONGODB_URI'
];

const optionalVars = [
  'SLACK_BOT_TOKEN',
  'SLACK_STATE_SECRET',
  'SLACK_REDIRECT_URI',
  'PORT'
];

console.log('Required Environment Variables:');
let missingRequired = [];
requiredVars.forEach(varName => {
  if (process.env[varName]) {
    console.log(`✅ ${varName}: Set (${process.env[varName].substring(0, 10)}...)`);
  } else {
    console.log(`❌ ${varName}: Missing`);
    missingRequired.push(varName);
  }
});

console.log('\nOptional Environment Variables:');
optionalVars.forEach(varName => {
  if (process.env[varName]) {
    console.log(`✅ ${varName}: Set`);
  } else {
    console.log(`⚠️  ${varName}: Not set`);
  }
});

if (missingRequired.length > 0) {
  console.log('\n❌ Missing required environment variables:', missingRequired.join(', '));
  console.log('Please set these in your .env file or Render environment settings');
} else {
  console.log('\n✅ All required environment variables are set!');
  
  // Generate the install URL
  const installUrl = `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=channels:history,channels:read,chat:write,commands,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,app_mentions:read&user_scope=`;
  
  console.log('\n📱 Your Slack install URL:');
  console.log(installUrl);
  
  console.log('\n🔧 Make sure you have:');
  console.log('1. Added OAuth redirect URL in Slack app settings');
  console.log('2. Enabled "Distribute App" in Slack app settings');
  console.log('3. Added all required Bot Token Scopes');
}

console.log('\n=== End of Test ===');
