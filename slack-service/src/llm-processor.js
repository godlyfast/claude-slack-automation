const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');
const { createLLMService } = require('./llm-service/factory');

class LLMProcessor {
  constructor(config) {
    this.config = config;
    this.llmService = createLLMService(config.llm);
    this.responseStyle = process.env.RESPONSE_STYLE || 'conversational';
    this.channelHistoryLimit = parseInt(process.env.CHANNEL_HISTORY_LIMIT) || 200;
    this.channelHistoryDisplay = parseInt(process.env.CHANNEL_HISTORY_DISPLAY) || 100;
  }

  /**
   * Process a message with the configured LLM
   * @param {Object} message - The message object from Slack
   * @param {Array} channelHistory - Channel history messages
   * @returns {Promise<string>} - The LLM's response
   */
  async processMessage(message, channelHistory = []) {
    try {
      // Build the prompt for the LLM
      const { prompt, files } = await this.buildPrompt(message, channelHistory);
      logger.info('Generated prompt:', { prompt });
      
      // Generate a response from the LLM
      const response = await this.llmService.generateResponse(prompt, files);
      logger.info('Received response from LLM:', { response });
      
      return response;
    } catch (error) {
      logger.error('Error processing message with LLM:', error);
      logger.error('Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      
      return 'Error generating response.';
    }
  }

  /**
   * Build the prompt for the LLM
   * @param {Object} message - The message object
   * @param {Array} channelHistory - Channel history
   * @returns {Promise<string>} - The prompt text
   */
  async buildPrompt(message, channelHistory) {
    const {
      text: messageText,
      channelName,
      isThreadReply,
      threadContext,
      hasAttachments,
      attachmentContext,
      files = [],
      threadAttachmentCount = 0
    } = message;

    // Build channel history context
    let channelHistoryContext = '';
    if (channelHistory.length > 0) {
      channelHistoryContext = '\n\n📜 **Channel History (Last ' + Math.min(channelHistory.length, this.channelHistoryDisplay) + ' messages):**\n';
      
      // Format messages with timestamps
      const formattedHistory = channelHistory
        .slice(0, this.channelHistoryDisplay)
        .map(msg => {
          const timestamp = msg.timestamp || msg.ts;
          const date = new Date(parseFloat(timestamp) * 1000);
          const dateStr = date.toISOString().split('T')[0];
          const timeStr = date.toISOString().split('T')[1].split('.')[0];
          const userName = msg.user.name || msg.user.real_name || msg.user.id;
          return `[${dateStr} ${timeStr}] ${userName}: ${msg.text || ''}`;
        })
        .join('\n');
      
      channelHistoryContext += formattedHistory;
    }

    // Build thread context
    let threadContextText = '';
    if (isThreadReply && threadContext && threadContext.length > 0) {
      threadContextText = '\n\nThread conversation history:\n';
      threadContextText += threadContext
        .map(msg => {
          const userName = msg.user.name || msg.user.real_name || msg.user.id;
          return `${userName}: ${msg.text}`;
        })
        .join('\n');
    }

    // Build file instruction
    let fileInstruction = '';
    if (hasAttachments && files.length > 0) {
      const fileCount = files.length;
      let fileSourceInfo = '';

      if (threadAttachmentCount > 0) {
        const currentFileCount = fileCount - threadAttachmentCount;
        if (currentFileCount > 0) {
          fileSourceInfo = ` (${currentFileCount} from current message, ${threadAttachmentCount} from earlier messages in this thread)`;
        } else {
          fileSourceInfo = ' (all from earlier messages in this thread)';
        }
      }

      fileInstruction = `

ATTACHED FILES:
The user has shared ${fileCount} file(s)${fileSourceInfo}:
${files.map(f => `- ${f.name} (${f.type})`).join('\n')}

The content of these files will be provided to you. Please analyze the file content and incorporate it into your response.`;
    }

    // Build the complete instruction
    let historyIntro = '';
    if (channelHistory.length > 0) {
      historyIntro = '\n\nYou have access to the recent channel history below, which provides context for the conversation. Use this history to understand references to previous messages, people mentioned, or ongoing discussions.';
    } else {
      historyIntro = '\n\nNote: No recent channel history is available.';
    }
    
    const instruction = `You are a helpful AI assistant responding to a message in the Slack channel ${channelName}.

User's message: ${messageText}${fileInstruction}${historyIntro}${channelHistoryContext}${threadContextText}

Please provide a direct and specific response to the user's message. If they are asking about file content, make sure to analyze and reference the specific content from the files provided.`;

    return { prompt: instruction, files };
  }

  /**
   * Pre-fetch and cache channel histories for efficiency
   * @param {Array} channels - Array of channel names
   * @param {Function} fetchHistoryFn - Function to fetch channel history
   * @returns {Promise<Object>} - Map of channel histories
   */
  async prefetchChannelHistories(channels, fetchHistoryFn) {
    const histories = {};
    
    for (const channel of channels) {
      try {
        logger.info(`Pre-fetching history for channel: ${channel}`);
        const history = await fetchHistoryFn(channel, this.channelHistoryLimit);
        
        if (history && history.length > 0) {
          histories[channel] = history;
          
          // Extract file paths from history
          const filePaths = [];
          for (const msg of history) {
            if (msg.filePaths && msg.filePaths.length > 0) {
              filePaths.push(...msg.filePaths);
            }
          }
          
          if (filePaths.length > 0) {
            histories[`${channel}_files`] = filePaths;
          }
          
          logger.info(`Cached ${history.length} messages for channel ${channel}`);
        }
      } catch (error) {
        logger.error(`Failed to fetch history for channel ${channel}:`, error);
      }
    }
    
    return histories;
  }
}

module.exports = LLMProcessor;
