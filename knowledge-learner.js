// Updates needed in knowledge-learner.js for multi-workspace support

/**
 * Learn from historical conversations in Slack for a specific workspace
 * @param {object} client - Slack client
 * @param {string} workspaceId - Workspace ID
 * @returns {Promise<number>} - Number of Q&A pairs learned
 */
async function learnFromChannelHistory(client, workspaceId) {
  console.log(`Starting to learn from channel history for workspace ${workspaceId}...`);
  let learnedCount = 0;
  
  try {
    // Get list of all public channels
    const channelsResult = await client.conversations.list({
      types: 'public_channel'
    });
    
    if (!channelsResult.channels || channelsResult.channels.length === 0) {
      console.log('No channels found to learn from');
      return 0;
    }
    
    // Process each channel
    for (const channel of channelsResult.channels) {
      console.log(`Learning from channel: ${channel.name} (${channel.id})`);
      
      try {
        // Get conversation history
        const historyResult = await client.conversations.history({
          channel: channel.id,
          limit: 1000 // maximum allowed
        });
        
        if (!historyResult.messages || historyResult.messages.length === 0) {
          continue;
        }
        
        // Group messages into Q&A pairs
        const qaGroups = identifyQAPairs(historyResult.messages, channel.id, channel.name);
        
        // Store learned Q&A pairs with workspace ID
        if (qaGroups.length > 0) {
          learnedCount += await storeLearnedQA(qaGroups, channel.name, workspaceId);
        }
      } catch (channelError) {
        console.error(`Error learning from channel ${channel.name}:`, channelError);
        // Continue with next channel
      }
    }
    
    console.log(`Completed learning from channel history. Learned ${learnedCount} Q&A pairs.`);
    return learnedCount;
  } catch (error) {
    console.error('Error during channel history learning:', error);
    return 0;
  }
}

/**
 * Store learned Q&A pairs in database with workspace isolation
 * @param {Array} qaGroups - Array of Q&A pairs
 * @param {string} channelName - Channel name for context
 * @param {string} workspaceId - Workspace ID
 * @returns {Promise<number>} - Number of Q&A pairs stored
 */
async function storeLearnedQA(qaGroups, channelName, workspaceId) {
  if (!isConnected || !learnedQACollection) {
    console.log('Cannot store learned Q&A: MongoDB not connected');
    return 0;
  }
  
  let storedCount = 0;
  
  for (const group of qaGroups) {
    // Skip if there's no bot answer and no clear human answer
    if (!group.botAnswer && group.answers.length < 1) continue;
    
    // Use bot answer if available, otherwise use the best human answer
    const answer = group.botAnswer || group.answers[0].text;
    
    // Set confidence score
    const confidence = group.confidence || 
                      (group.botAnswer ? 0.9 : 
                       (group.answers.length > 2 ? 0.8 : 0.6));
    
    try {
      // Check if this Q&A pair already exists for this workspace
      const existing = await learnedQACollection.findOne({
        question: { $text: { $search: group.question } },
        programName: group.programName,
        workspaceId: workspaceId  // Add workspace filter
      });
      
      if (existing) {
        // Update existing entry if this one has higher confidence
        if (confidence > existing.confidence) {
          await learnedQACollection.updateOne(
            { _id: existing._id },
            { 
              $set: { 
                answer
