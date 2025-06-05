// Fixed version of the problem functions in knowledge-learner.js
// Replace the text search with regex search

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
      // Using regex instead of $text search
      const existing = await learnedQACollection.findOne({
        question: { $regex: group.question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
        programName: group.programName,
        workspaceId: workspaceId
      });
      
      if (existing) {
        // Update existing entry if this one has higher confidence
        if (confidence > existing.confidence) {
          await learnedQACollection.updateOne(
            { _id: existing._id },
            { 
              $set: { 
                answer: answer,
                confidence: confidence,
                lastUpdated: new Date()
              },
              $inc: { useCount: 1 }
            }
          );
          storedCount++;
        }
      } else {
        // Insert new entry
        await learnedQACollection.insertOne({
          question: group.question,
          answer: answer,
          programName: group.programName,
          channelName: channelName,
          workspaceId: workspaceId,
          confidence: confidence,
          useCount: 1,
          createdAt: new Date(),
          lastUpdated: new Date()
        });
        storedCount++;
      }
      
      // Also add to cache with workspace-specific key
      const cacheKey = `${workspaceId}:${group.programName}:${group.question.toLowerCase().substring(0, 30)}`;
      learnedQACache.set(cacheKey, {
        answer: answer,
        confidence: confidence,
        programName: group.programName
      });
      
    } catch (error) {
      console.error('Error storing learned Q&A:', error);
    }
  }
  
  return storedCount;
}

/**
 * Find answer from learned knowledge for a specific workspace
 * @param {string} question - User's question
 * @param {string} programName - Program context
 * @param {string} workspaceId - Workspace ID
 * @returns {Promise<object|null>} - Answer or null if not found
 */
async function findLearnedAnswer(question, programName, workspaceId = 'default') {
  if (!question) return null;
  
  // Check cache first with workspace-specific key
  const questionLower = question.toLowerCase();
  const cacheKey = `${workspaceId}:${programName}:${questionLower.substring(0, 30)}`;
  const cachedAnswer = learnedQACache.get(cacheKey);
  
  if (cachedAnswer && cachedAnswer.programName === programName) {
    return {
      answer: cachedAnswer.answer,
      confidence: cachedAnswer.confidence,
      source: 'cache'
    };
  }
  
  // If not in cache and MongoDB is connected, search database
  if (isConnected && learnedQACollection) {
    try {
      // Search for similar questions using regex
      const escapedQuestion = question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // First try exact match
      let result = await learnedQACollection.findOne({
        question: { $regex: `^${escapedQuestion}$`, $options: 'i' },
        programName: programName,
        workspaceId: workspaceId,
        confidence: { $gt: 0.7 }
      });
      
      // If no exact match, try partial match
      if (!result) {
        const keywords = question.toLowerCase().split(' ').filter(word => word.length > 3);
        if (keywords.length > 0) {
          const keywordPattern = keywords.join('|');
          result = await learnedQACollection.findOne({
            question: { $regex: keywordPattern, $options: 'i' },
            programName: programName,
            workspaceId: workspaceId,
            confidence: { $gt: 0.7 }
          });
        }
      }
      
      if (result && result.answer) {
        // Add to cache for future use
        learnedQACache.set(cacheKey, {
          answer: result.answer,
          confidence: result.confidence,
          programName: programName
        });
        
        // Update usage count
        await learnedQACollection.updateOne(
          { _id: result._id },
          { $inc: { useCount: 1 } }
        );
        
        return {
          answer: result.answer,
          confidence: result.confidence,
          source: 'database'
        };
      }
      
      // If no match in program, try general knowledge for this workspace
      if (programName !== 'General') {
        const generalResult = await learnedQACollection.findOne({
          question: { $regex: escapedQuestion, $options: 'i' },
          programName: 'General',
          workspaceId: workspaceId,
          confidence: { $gt: 0.8 }
        });
        
        if (generalResult && generalResult.answer) {
          return {
            answer: generalResult.answer,
            confidence: generalResult.confidence * 0.9,
            source: 'database-general'
          };
        }
      }
    } catch (error) {
      console.error('Error finding learned answer:', error);
    }
  }
  
  return null;
}

/**
 * Record a new Q&A pair from current interaction
 * @param {string} question - User's question
 * @param {string} answer - Bot's answer
 * @param {string} programName - Program context
 * @param {string} workspaceId - Workspace ID
 * @param {number} confidence - Confidence level (0-1)
 * @returns {Promise<boolean>} - Success status
 */
async function recordQAPair(question, answer, programName, workspaceId = 'default', confidence = 0.9) {
  if (!question || !answer || !programName) return false;
  
  // Add to cache immediately with workspace-specific key
  const cacheKey = `${workspaceId}:${programName}:${question.toLowerCase().substring(0, 30)}`;
  learnedQACache.set(cacheKey, {
    answer: answer,
    confidence: confidence,
    programName: programName
  });
  
  // Store in database if connected
  if (isConnected && learnedQACollection) {
    try {
      // Check if this Q&A pair already exists for this workspace
      const escapedQuestion = question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existing = await learnedQACollection.findOne({
        question: { $regex: `^${escapedQuestion}$`, $options: 'i' },
        programName: programName,
        workspaceId: workspaceId
      });
      
      if (existing) {
        // Update existing entry
        await learnedQACollection.updateOne(
          { _id: existing._id },
          { 
            $set: { lastUpdated: new Date() },
            $inc: { useCount: 1 }
          }
        );
      } else {
        // Insert new entry
        await learnedQACollection.insertOne({
          question: question,
          answer: answer,
          programName: programName,
          workspaceId: workspaceId,
          confidence: confidence,
          useCount: 1,
          createdAt: new Date(),
          lastUpdated: new Date()
        });
      }
      
      return true;
    } catch (error) {
      console.error('Error recording Q&A pair:', error);
    }
  }
  
  return false;
}
