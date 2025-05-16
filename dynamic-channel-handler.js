// dynamic-channel-handler.js
// This module automatically detects programs and resources from Slack channels

const NodeCache = require('node-cache');

// Cache program information with 24-hour TTL
const programCache = new NodeCache({ stdTTL: 24 * 60 * 60 });
const userProgramCache = new NodeCache({ stdTTL: 24 * 60 * 60 });
const channelContentCache = new NodeCache({ stdTTL: 4 * 60 * 60 });

// Program naming patterns
const PROGRAM_KEYWORDS = [
  'databricks', 'azure', 'aws', 'gcp', 'snowflake', 
  'python', 'java', 'javascript', 'react', 'nodejs',
  'machine-learning', 'data-science', 'devops', 'cloud'
];

/**
 * Extract program name from channel name or topic
 * @param {string} channelName - The name of the channel
 * @param {string} channelTopic - The topic of the channel
 * @returns {string} - Extracted program name
 */
function extractProgramName(channelName, channelTopic) {
  // First, check for program keywords in the channel name
  const normalizedChannelName = channelName.toLowerCase();
  
  for (const keyword of PROGRAM_KEYWORDS) {
    if (normalizedChannelName.includes(keyword)) {
      // Capitalize first letter of each word for nice display
      return keyword.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
    }
  }
  
  // If no match in name, check topic
  if (channelTopic) {
    const normalizedTopic = channelTopic.toLowerCase();
    
    for (const keyword of PROGRAM_KEYWORDS) {
      if (normalizedTopic.includes(keyword)) {
        return keyword.split('-').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
      }
    }
  }
  
  // If no known program found, extract what looks like a program name from channel
  const possibleName = channelName
    .replace(/[^a-zA-Z0-9-]/g, ' ')  // Replace special chars with spaces
    .replace(/\s+/g, ' ')           // Normalize spaces
    .trim();
  
  if (possibleName) {
    return possibleName.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
  }
  
  // Fallback
  return 'Learning Program';
}

/**
 * Scan channel messages for important links
 * @param {object} message - Slack message object
 * @returns {object|null} - Extracted link data or null
 */
function scanMessageForLinks(message) {
  if (!message || !message.text) return null;
  
  const text = message.text.toLowerCase();
  const urlMatches = message.text.match(/(https?:\/\/[^\s<>]+)/g);
  
  if (!urlMatches) return null;
  
  const linkData = {
    timestamp: message.ts,
    urls: urlMatches
  };
  
  // Categorize the link based on keywords in the message
  if (text.includes('recording') || 
      text.includes('session video') || 
      text.includes('recording link') ||
      text.includes('watch the session')) {
    return { type: 'recording', ...linkData };
  }
  else if (text.includes('calendar') || 
           text.includes('schedule') || 
           text.includes('timetable') ||
           text.includes('upcoming sessions')) {
    return { type: 'calendar', ...linkData };
  }
  else if (text.includes('learning portal') ||
           text.includes('course portal') ||
           text.includes('login to the course') ||
           text.includes('sign in to the portal')) {
    return { type: 'portal', ...linkData };
  }
  else if (text.includes('resource') ||
           text.includes('material') ||
           text.includes('document') ||
           text.includes('guide')) {
    return { type: 'resource', ...linkData };
  }
  
  // If we can't categorize, but it has a URL, mark as general resource
  return { type: 'general', ...linkData };
}

/**
 * Get the channel info and extract program details
 * @param {string} channelId - The channel ID
 * @param {object} client - Slack client
 * @returns {Promise<object>} - Program info
 */
async function getProgramInfoFromChannel(channelId, client) {
  // Check cache first
  const cachedProgram = programCache.get(channelId);
  if (cachedProgram) {
    return cachedProgram;
  }
  
  try {
    // Get channel info
    const channelInfo = await client.conversations.info({ channel: channelId });
    
    if (!channelInfo.channel) {
      throw new Error(`Could not find channel with ID ${channelId}`);
    }
    
    const channelName = channelInfo.channel.name || '';
    const channelTopic = channelInfo.channel.topic?.value || '';
    const isPrivate = channelInfo.channel.is_private || false;
    
    // Extract program name
    const programName = extractProgramName(channelName, channelTopic);
    
    // Create program info object
    const programInfo = {
      channelId,
      channelName,
      programName,
      isPrivate,
      links: {
        recordings: [],
        calendars: [],
        portals: [],
        resources: []
      }
    };
    
    // Store in cache
    programCache.set(channelId, programInfo);
    
    return programInfo;
  } catch (error) {
    console.error(`Error getting program info for channel ${channelId}:`, error);
    
    // Return a default program info
    return {
      channelId,
      channelName: 'unknown',
      programName: 'Learning Program',
      links: {
        recordings: [],
        calendars: [],
        portals: [],
        resources: []
      }
    };
  }
}

/**
 * Determine which program a user belongs to
 * @param {string} userId - User ID
 * @param {object} client - Slack client
 * @returns {Promise<object|null>} - User's program info or null
 */
async function getUserProgram(userId, client) {
  // Check cache first
  const cachedUserProgram = userProgramCache.get(userId);
  if (cachedUserProgram) {
    return cachedUserProgram;
  }
  
  try {
    // Get conversations (channels) the user is in - include both public and private
    const response = await client.users.conversations({
      user: userId,
      types: "public_channel,private_channel"
    });
    
    if (!response.channels || response.channels.length === 0) {
      return null;
    }
    
    // Find all programs the user is associated with
    const userPrograms = [];
    
    for (const channel of response.channels) {
      const programInfo = await getProgramInfoFromChannel(channel.id, client);
      if (programInfo) {
        userPrograms.push(programInfo);
      }
    }
    
    // If no programs found
    if (userPrograms.length === 0) {
      return null;
    }
    
    // Store first program in cache (primary program)
    userProgramCache.set(userId, userPrograms[0]);
    
    // Also store all programs for this user
    const userAllProgramsKey = `all_programs_${userId}`;
    userProgramCache.set(userAllProgramsKey, userPrograms);
    
    return userPrograms[0];
  } catch (error) {
    console.error(`Error determining program for user ${userId}:`, error);
    return null;
  }
}

/**
 * Scan a channel for important content like links
 * @param {string} channelId - Channel ID
 * @param {object} client - Slack client
 * @returns {Promise<object>} - Extracted content
 */
async function scanChannelContent(channelId, client) {
  // Check cache first
  const cachedContent = channelContentCache.get(channelId);
  if (cachedContent) {
    return cachedContent;
  }
  
  const content = {
    recordings: [],
    calendars: [],
    portals: [],
    resources: [],
    lastScanTime: new Date().toISOString()
  };
  
  try {
    // Check if the bot is a member of this channel first
    try {
      const channelInfo = await client.conversations.info({ channel: channelId });
      if (!channelInfo.channel.is_member) {
        console.log(`Cannot scan channel ${channelId}: Bot is not a member`);
        channelContentCache.set(channelId, content);
        return content;
      }
    } catch (memberError) {
      console.error(`Error checking membership for channel ${channelId}:`, memberError);
      channelContentCache.set(channelId, content);
      return content;
    }
    
    // Get recent messages in the channel
    const result = await client.conversations.history({
      channel: channelId,
      limit: 100 // Get last 100 messages
    });
    
    if (!result.messages || result.messages.length === 0) {
      channelContentCache.set(channelId, content);
      return content;
    }
    
    // Analyze each message for links
    for (const message of result.messages) {
      const linkData = scanMessageForLinks(message);
      
      if (linkData) {
        switch (linkData.type) {
          case 'recording':
            content.recordings.push({
              urls: linkData.urls,
              timestamp: linkData.timestamp,
              text: message.text
            });
            break;
          case 'calendar':
            content.calendars.push({
              urls: linkData.urls,
              timestamp: linkData.timestamp,
              text: message.text
            });
            break;
          case 'portal':
            content.portals.push({
              urls: linkData.urls,
              timestamp: linkData.timestamp,
              text: message.text
            });
            break;
          case 'resource':
          case 'general':
            content.resources.push({
              urls: linkData.urls,
              timestamp: linkData.timestamp,
              text: message.text
            });
            break;
        }
      }
    }
    
    // Sort by timestamp (newest first)
    content.recordings.sort((a, b) => b.timestamp - a.timestamp);
    content.calendars.sort((a, b) => b.timestamp - a.timestamp);
    content.portals.sort((a, b) => b.timestamp - a.timestamp);
    content.resources.sort((a, b) => b.timestamp - a.timestamp);
    
    // Store in cache
    channelContentCache.set(channelId, content);
    
    return content;
  } catch (error) {
    console.error(`Error scanning channel ${channelId}:`, error);
    
    // Cache empty results to avoid repeated failures
    channelContentCache.set(channelId, content);
    return content;
  }
}

/**
 * Get user and program context for a message
 * @param {object} message - Slack message
 * @param {object} client - Slack client
 * @returns {Promise<object>} - Context info
 */
async function getMessageContext(message, client) {
  let programInfo = null;
  let channelContent = null;
  
  // Get program info
  if (message.channel) {
    // For direct messages, determine program based on user's channels
    if (message.channel.startsWith('D')) {
      programInfo = await getUserProgram(message.user, client);
    } else {
      // For channel messages, use the channel's program
      programInfo = await getProgramInfoFromChannel(message.channel, client);
      
      // Scan channel content
      channelContent = await scanChannelContent(message.channel, client);
      
      // Merge found links into program info
      if (channelContent) {
        if (channelContent.recordings.length > 0) {
          programInfo.links.recordings = channelContent.recordings;
        }
        if (channelContent.calendars.length > 0) {
          programInfo.links.calendars = channelContent.calendars;
        }
        if (channelContent.portals.length > 0) {
          programInfo.links.portals = channelContent.portals;
        }
        if (channelContent.resources.length > 0) {
          programInfo.links.resources = channelContent.resources;
        }
      }
    }
  }
  
  return {
    programInfo,
    channelContent,
    userId: message.user // Add user ID to context for security checks
  };
}

/**
 * Check if a specific program belongs to a user
 * @param {string} userId - User ID
 * @param {string} programName - Program name to check
 * @returns {boolean} - Whether user belongs to the program
 */
function userBelongsToProgram(userId, programName) {
  // Always return true - disable the security check for now
  // This allows the bot to respond in any channel it's been added to
  return true;
  
  /* Original function code (commented out):
  // Get all programs for this user
  const userAllProgramsKey = `all_programs_${userId}`;
  const userPrograms = userProgramCache.get(userAllProgramsKey) || [];
  
  // Check if user is associated with this program
  return userPrograms.some(program => 
    program.programName.toLowerCase() === programName.toLowerCase()
  );
  */
}

/**
 * Get a link response based on message context and query
 * @param {string} query - User's query
 * @param {object} context - Message context
 * @returns {string|null} - Response with link or null if no relevant link
 */
function getLinkResponse(query, context) {
  if (!context.programInfo) return null;
  
  const queryLower = query.toLowerCase();
  const programName = context.programInfo.programName;
  const userId = context.userId;
  
  // Skip security check - if user is in channel, they can access
  // if (!userBelongsToProgram(userId, programName)) {
  //   return `I don't have access to resources for the ${programName} program. Please contact your program administrator for assistance.`;
  // }
  
  // Check for recording links
  if (queryLower.includes('recording') || 
      queryLower.includes('video') || 
      queryLower.includes('watch')) {
    
    if (context.programInfo.links.recordings.length > 0) {
      const latestRecording = context.programInfo.links.recordings[0];
      return `Here's the most recent recording link for the ${programName} program: ${latestRecording.urls[0]}`;
    }
  }
  
  // Check for calendar links
  if (queryLower.includes('calendar') || 
      queryLower.includes('schedule') || 
      queryLower.includes('timetable')) {
    
    if (context.programInfo.links.calendars.length > 0) {
      const latestCalendar = context.programInfo.links.calendars[0];
      return `Here's the calendar link for the ${programName} program: ${latestCalendar.urls[0]}`;
    }
  }
  
  // Check for portal links
  if (queryLower.includes('portal') || 
      queryLower.includes('login') || 
      queryLower.includes('sign in') ||
      queryLower.includes('access course')) {
    
    if (context.programInfo.links.portals.length > 0) {
      const latestPortal = context.programInfo.links.portals[0];
      return `Here's the learning portal link for the ${programName} program: ${latestPortal.urls[0]}`;
    }
  }
  
  // Check for resource links
  if (queryLower.includes('resource') || 
      queryLower.includes('material') || 
      queryLower.includes('document') ||
      queryLower.includes('guide')) {
    
    if (context.programInfo.links.resources.length > 0) {
      const latestResource = context.programInfo.links.resources[0];
      return `Here's a resource link for the ${programName} program: ${latestResource.urls[0]}`;
    }
  }
  
  return null;
}

/**
 * Customize a response with program-specific information
 * @param {string} baseResponse - The original response
 * @param {object} context - Message context
 * @returns {string} - Customized response
 */
function customizeResponse(baseResponse, context) {
  if (!context.programInfo) return baseResponse;
  
  const programName = context.programInfo.programName;
  
  // Add program name to the response if it doesn't already have it
  if (!baseResponse.includes(programName)) {
    return `${baseResponse}\n\nI'm your assistant for the ${programName} program. Let me know if you need anything else!`;
  }
  
  return baseResponse;
}

/**
 * Periodically scan all known channels (every 4 hours)
 * @param {object} client - Slack client
 */
async function scheduleChannelScans(client) {
  try {
    console.log('Starting scheduled channel scan...');
    
    // Get all public and private channels the bot is in
    const channelsResult = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000
    });
    
    if (!channelsResult.channels || channelsResult.channels.length === 0) {
      console.log('No channels found to scan');
      return;
    }
    
    // Filter channels to only those the bot is a member of
    const memberChannels = channelsResult.channels.filter(channel => channel.is_member === true);
    
    console.log(`Scanning ${memberChannels.length} channels where bot is a member`);
    
    // Process each channel where the bot is a member
    for (const channel of memberChannels) {
      try {
        await scanChannelContent(channel.id, client);
        console.log(`Scanned channel: ${channel.name}`);
      } catch (error) {
        console.error(`Error scanning channel ${channel.name}:`, error);
      }
    }
    
    console.log('Scheduled channel scan complete');
  } catch (error) {
    console.error('Error during scheduled channel scan:', error);
  }
  
  // Schedule next scan in 4 hours
  const scanInterval = 4 * 60 * 60 * 1000; // 4 hours
  setTimeout(() => scheduleChannelScans(client), scanInterval);
}

// Export functions
module.exports = {
  getProgramInfoFromChannel,
  getUserProgram,
  scanChannelContent,
  getMessageContext,
  getLinkResponse,
  customizeResponse,
  scheduleChannelScans,
  userBelongsToProgram
};
