const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger');

class ClaudeService {
  constructor(config) {
    this.config = config;
    this.tempDir = process.env.TEMP_DIR || '/tmp';
    this.claudeTimeout = parseInt(process.env.CLAUDE_TIMEOUT) || 30;
    this.responseStyle = process.env.RESPONSE_STYLE || 'conversational';
    this.channelHistoryLimit = parseInt(process.env.CHANNEL_HISTORY_LIMIT) || 200;
    this.channelHistoryDisplay = parseInt(process.env.CHANNEL_HISTORY_DISPLAY) || 100;
  }

  /**
   * Process a message with Claude
   * @param {Object} message - The message object from Slack
   * @param {Array} channelHistory - Channel history messages
   * @returns {Promise<string>} - Claude's response
   */
  async processMessage(message, channelHistory = []) {
    try {
      // Build the instruction for Claude
      const instruction = await this.buildClaudeInstruction(message, channelHistory);
      
      // Execute Claude with timeout
      const response = await this.executeClaude(instruction);
      
      return response;
    } catch (error) {
      logger.error('Error processing message with Claude:', error);
      logger.error('Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      
      // Check if it's a timeout error
      if (error.code === 'TIMEOUT') {
        return this.getTimeoutMessage();
      }
      
      // Return a generic error message instead of throwing
      return 'Execution error';
    }
  }

  /**
   * Build the instruction prompt for Claude
   * @param {Object} message - The message object
   * @param {Array} channelHistory - Channel history
   * @returns {Promise<string>} - The instruction text
   */
  async buildClaudeInstruction(message, channelHistory) {
    const {
      text: messageText,
      channelName,
      isThreadReply,
      threadContext,
      hasAttachments,
      attachmentContext,
      filePaths = [],
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
          return `[${dateStr} ${timeStr}] <@${msg.user}>: ${msg.text || ''}`;
        })
        .join('\n');
      
      channelHistoryContext += formattedHistory;
    }

    // Build thread context
    let threadContextText = '';
    if (isThreadReply && threadContext && threadContext.length > 0) {
      threadContextText = '\n\nThread conversation history:\n';
      threadContextText += threadContext
        .map(msg => `${msg.user}: ${msg.text}`)
        .join('\n');
    }

    // Build file instruction
    let fileInstruction = '';
    if (hasAttachments && filePaths.length > 0) {
      const fileCount = filePaths.length;
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
${filePaths.map(f => `- ${f.name} (${f.type})`).join('\n')}

The file paths will be provided below. Please use the Read tool to analyze these files and incorporate their content into your response.`;
    }

    // Build file reading instructions
    let fileReadInstructions = '';
    if (filePaths.length > 0) {
      const validFiles = [];
      
      for (const file of filePaths) {
        const filePath = file.path || file;
        try {
          await fs.access(filePath);
          validFiles.push({
            path: filePath,
            name: file.name || path.basename(filePath),
            type: file.type || 'document'
          });
        } catch (error) {
          logger.warn(`File not accessible: ${filePath}`);
        }
      }

      if (validFiles.length > 0) {
        fileReadInstructions = `

IMPORTANT: There are ${validFiles.length} files available for analysis from this channel. 
${validFiles.map(f => `
Please use the Read tool to analyze this file:
- File: ${f.name} (${f.type})
- Path: ${f.path}
`).join('\n')}`;
      }
    }

    // Build the complete instruction
    let historyIntro = '';
    if (channelHistory.length > 0) {
      historyIntro = '\n\nYou have access to the recent channel history below, which provides context for the conversation. Use this history to understand references to previous messages, people mentioned, or ongoing discussions.';
    } else {
      historyIntro = '\n\nNote: No recent channel history is available.';
    }
    
    const instruction = `You are a helpful Slack bot assistant. Generate a response to this message.${historyIntro}${channelHistoryContext}${threadContextText}

Current message: ${messageText}${attachmentContext || ''}${fileInstruction}

Guidelines:
- Be helpful, conversational, and concise
- Provide relevant information based on the message content
- If the message references previous conversations or people (like Lera Panasiuk message), look for it in the channel history above
- If this is a thread reply, consider the full context of the conversation
- If file attachments are present, analyze their content and incorporate insights into your response
- Style: ${this.responseStyle}
- User IDs in history appear as <@USERID> - these are Slack user mentions

IMPORTANT Slack formatting rules:
- Use *bold* for emphasis (NOT **bold**)
- Use _italic_ for subtle emphasis (NOT *italic*)
- Use \`code\` for inline code
- Use \`\`\`language for code blocks
- Use • for bullet points (NOT - or *)
- Use :emoji: for emojis
- URLs are automatically linked
- For mentions use <@UserID> format

CRITICAL LOOP PREVENTION: Never use the exact words AI or ШІ in your responses, as these are trigger words that will cause an infinite loop. Instead, use alternatives like artificial intelligence, A.I., intelligent system, or rephrase to avoid these exact terms.

IMPORTANT: When analyzing files, use the Read tool with the file paths provided. Output ONLY the response text for Slack using proper Slack formatting. Do not attempt to interact with Slack directly.${fileReadInstructions}`;

    return instruction;
  }

  /**
   * Execute Claude CLI with timeout
   * 
   * 🚨 CRITICAL: NEVER MODIFY THIS TO ADD SLACK TOOLS
   * Claude MUST remain isolated from Slack API
   * NO arguments should be passed to the claude spawn command
   * 
   * @param {string} instruction - The instruction for Claude
   * @returns {Promise<string>} - Claude's response
   */
  async executeClaude(instruction) {
    return new Promise((resolve, reject) => {
      const timeoutMs = this.claudeTimeout * 1000;
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Spawn claude process
      // 🚨 CRITICAL: Empty array [] means NO Slack tools - NEVER change this!
      const claude = spawn('claude', [], {
        timeout: timeoutMs,
        killSignal: 'SIGTERM'
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        claude.kill('SIGTERM');
      }, timeoutMs);

      // Handle stdout
      claude.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      // Handle stderr
      claude.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle close
      claude.on('close', (code) => {
        clearTimeout(timeoutId);

        if (timedOut) {
          const error = new Error(`Claude timed out after ${this.claudeTimeout} seconds`);
          error.code = 'TIMEOUT';
          reject(error);
        } else if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Claude exited with code ${code}: ${stderr}`));
        }
      });

      // Handle error
      claude.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });

      // Send instruction to Claude
      claude.stdin.write(instruction);
      claude.stdin.end();
    });
  }

  /**
   * Get timeout message for users
   * @returns {string} - Formatted timeout message
   */
  getTimeoutMessage() {
    return `🕒 *Request Timed Out*

I apologize, but your request took longer than the configured timeout of ${this.claudeTimeout} seconds to process.

This typically happens with:
• Very complex analysis requests
• Requests requiring deep research across many messages
• Tasks involving multiple large files or documents

*What you can do:*
1. **Break down your request** into smaller, more specific parts
2. **Provide more context** about what specific information you need
3. **Ask your administrator** to increase the timeout (currently ${this.claudeTimeout}s)

*For administrators:*
To increase the timeout, update \`CLAUDE_TIMEOUT\` in \`config.env\`. The current limit is ${this.claudeTimeout} seconds.`;
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

  /**
   * Filter file paths to only include files from a specific channel
   * @param {Array} filePaths - Array of file path objects
   * @param {string} channelId - Channel ID to filter by
   * @returns {Array} - Filtered file paths
   */
  filterFilePathsByChannel(filePaths, channelId) {
    if (!filePaths || filePaths.length === 0 || !channelId) {
      return [];
    }

    const safeChannelId = channelId.replace(/[^a-zA-Z0-9-]/g, '_');
    
    // Filter paths that contain the channel ID
    return filePaths.filter(file => {
      // Handle different file path formats
      let filePathString;
      if (typeof file === 'string') {
        filePathString = file;
      } else if (file.path) {
        // If file.path is an object (like from file handler), skip filtering
        // as it doesn't have a path string yet
        if (typeof file.path === 'object') {
          return true; // Include all files with object paths
        }
        filePathString = file.path;
      } else {
        return false;
      }
      
      return filePathString.includes(safeChannelId);
    });
  }
}

module.exports = ClaudeService;