const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const LLMService = require('./base');
const logger = require('../logger');

class ClaudeCodeService extends LLMService {
  constructor(config) {
    super(config);
    this.claudeTimeout = parseInt(process.env.CLAUDE_TIMEOUT) || 30;
    this.tempDir = process.env.TEMP_DIR || '/tmp';
  }

  async generateResponse(prompt, files = []) {
    logger.info('Claude Code CLI generateResponse called with:', {
      prompt: prompt.substring(0, 200) + '...',
      filesCount: files.length,
      files: files.map(f => ({ name: f.name, path: f.path }))
    });

    try {
      // If there are files, we need to create a temp instruction file
      let instruction = prompt;
      
      if (files.length > 0) {
        // Add file context to the prompt
        const fileInstructions = [];
        for (const file of files) {
          try {
            const content = await fs.readFile(file.path, 'utf-8');
            fileInstructions.push(`\n📎 **File: ${file.name}**\n\`\`\`\n${content}\n\`\`\``);
          } catch (error) {
            logger.warn(`Failed to read file ${file.name}:`, error);
            fileInstructions.push(`\n📎 **File: ${file.name}** (Unable to read)`);
          }
        }
        
        instruction = prompt + '\n\n' + fileInstructions.join('\n');
      }

      // Execute Claude CLI
      const response = await this.executeClaude(instruction);
      return response;
    } catch (error) {
      logger.error('Error executing Claude Code CLI:', error);
      
      // Check if it's a timeout error
      if (error.code === 'TIMEOUT') {
        return this.getTimeoutMessage();
      }
      
      throw error;
    }
  }

  async executeClaude(instruction) {
    return new Promise((resolve, reject) => {
      const timeoutMs = this.claudeTimeout * 1000;
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      logger.info(`Executing Claude CLI with timeout of ${this.claudeTimeout}s`);

      // Spawn claude process
      // Empty array [] means NO Slack tools - important for isolation
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
          logger.info('Claude CLI executed successfully');
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

      // Send instruction to stdin
      claude.stdin.write(instruction);
      claude.stdin.end();
    });
  }

  getTimeoutMessage() {
    return `I apologize, but I'm taking longer than expected to process this request (over ${this.claudeTimeout} seconds). This might be due to:

1. Complex file analysis
2. Large thread context
3. System resources

The request is still being processed in the background. If you need a quicker response, try:
- Asking a more specific question
- Reducing the context size
- Trying again in a moment

If this continues, please contact your administrator.`;
  }
}

module.exports = ClaudeCodeService;