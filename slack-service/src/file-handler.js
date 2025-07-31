const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class FileHandler {
  constructor(slackToken) {
    this.slackToken = slackToken;
    this.tempDir = path.join(__dirname, '../temp');
    this.maxFileSize = 10 * 1024 * 1024; // 10MB limit
    this.supportedTypes = {
      code: ['js', 'py', 'sh', 'ts', 'jsx', 'tsx', 'go', 'rs', 'cpp', 'c', 'java'],
      text: ['txt', 'md', 'json', 'yml', 'yaml', 'xml', 'csv'],
      image: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
      document: ['pdf']
    };
  }

  /**
   * Initialize temp directory
   */
  async init() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create temp directory:', error);
    }
  }

  /**
   * Process file attachments from a Slack message
   * @param {object} message - Slack message object
   * @param {string} channelId - Channel ID for file isolation
   * @returns {Array} Array of processed file data
   */
  async processAttachments(message, channelId) {
    if (!message.files || message.files.length === 0) {
      return [];
    }

    const processedFiles = [];

    for (const file of message.files) {
      try {
        const processedFile = await this.processFile(file, channelId);
        if (processedFile) {
          processedFiles.push(processedFile);
        }
      } catch (error) {
        logger.error(`Failed to process file ${file.name}:`, error);
        // Continue with other files
      }
    }

    return processedFiles;
  }

  /**
   * Process a single file attachment
   * @param {object} file - Slack file object
   * @param {string} channelId - Channel ID for file isolation
   * @returns {object|null} Processed file data or null if unsupported
   */
  async processFile(file, channelId) {
    // Check file size
    if (file.size > this.maxFileSize) {
      logger.warn(`File ${file.name} too large (${file.size} bytes), skipping`);
      return {
        name: file.name,
        type: 'error',
        error: 'File too large (max 10MB)',
        metadata: this.getFileMetadata(file)
      };
    }

    const fileExtension = this.getFileExtension(file.name);
    const fileType = this.getFileType(fileExtension);

    if (!fileType) {
      logger.debug(`Unsupported file type: ${file.name}`);
      return {
        name: file.name,
        type: 'unsupported',
        extension: fileExtension,
        metadata: this.getFileMetadata(file)
      };
    }

    // Download and save the file
    try {
      const result = await this.downloadAndSaveFile(file, channelId);
      if (!result) {
        logger.warn(`Failed to download ${file.name} - no content returned`);
        return {
          name: file.name,
          type: 'error',
          error: 'Download failed - no content',
          metadata: this.getFileMetadata(file)
        };
      }

      return {
        name: file.name,
        type: fileType,
        extension: fileExtension,
        size: file.size,
        content: result.content,
        filePath: result.filePath, // Path for Claude to read
        metadata: this.getFileMetadata(file)
      };
    } catch (error) {
      logger.error(`Failed to process file ${file.name}:`, error);
      return {
        name: file.name,
        type: 'error',
        error: `Processing failed: ${error.message}`,
        metadata: this.getFileMetadata(file)
      };
    }
  }

  /**
   * Download file and save to temp directory for Claude access
   * @param {object} file - Slack file object
   * @param {string} channelId - Channel ID for file isolation
   * @returns {object} Object with content and filePath
   */
  async downloadAndSaveFile(file, channelId) {
    if (!file.url_private_download && !file.url_private) {
      throw new Error(`No download URL available`);
    }

    const downloadUrl = file.url_private_download || file.url_private;
    logger.debug(`Downloading file ${file.name} from ${downloadUrl.substring(0, 50)}...`);
    
    // Try download with retry logic for transient failures
    let lastError;
    for (let attempt = 1; attempt <= 1; attempt++) {  // Reduced to 1 attempt to prevent API timeouts
      try {
        const content = await this.httpDownload(downloadUrl);
        logger.debug(`Successfully downloaded ${file.name} (${content.length} bytes)`);
        
        // Validate that we got the expected file type, not HTML
        const fileExtension = this.getFileExtension(file.name);
        if (fileExtension === 'pdf') {
          // Check if we got HTML instead of PDF
          const contentStart = content.toString('utf8', 0, 100).toLowerCase();
          if (contentStart.includes('<!doctype') || contentStart.includes('<html')) {
            throw new Error('Downloaded HTML instead of PDF - authentication may have failed');
          }
          // Check for PDF header
          if (!content.toString('utf8', 0, 5).includes('%PDF')) {
            throw new Error('Downloaded file is not a valid PDF');
          }
        }
        
        // Create channel-specific directory
        const channelDir = path.join(this.tempDir, channelId.replace(/[^a-zA-Z0-9-]/g, '_'));
        await fs.mkdir(channelDir, { recursive: true });
        
        // Generate safe filename with timestamp
        const timestamp = Date.now();
        const safeFileName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const filePath = path.join(channelDir, safeFileName);
        
        // Save file to channel-specific directory
        await fs.writeFile(filePath, content);
        logger.debug(`Saved file to ${filePath} (channel: ${channelId})`);
        
        // For text files, also provide content as string
        if (this.supportedTypes.text.includes(fileExtension) || 
            this.supportedTypes.code.includes(fileExtension)) {
          return {
            content: content.toString('utf8'),
            filePath: filePath
          };
        }
        
        // For all other files (images, PDFs, etc.), just provide the path
        // Claude can read these directly from the file path
        return {
          content: {
            type: this.getFileType(fileExtension),
            size: content.length,
            mimeType: file.mimetype,
            savedAt: new Date().toISOString()
          },
          filePath: filePath
        };
      } catch (error) {
        lastError = error;
        logger.warn(`Download attempt ${attempt}/3 failed for ${file.name}: ${error.message}`);
        
        if (attempt < 3) {
          // Wait before retry: 1s, 2s
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
      }
    }
    
    throw new Error(`Download failed: ${lastError.message}`);
  }

  /**
   * Download file content from Slack (legacy method for backward compatibility)
   * @param {object} file - Slack file object
   * @param {string} channelId - Channel ID for file isolation
   * @returns {string|Buffer|object} File content or throws error if failed
   */
  async downloadFile(file, channelId) {
    // Use the new method and return the file path for Claude to read
    const result = await this.downloadAndSaveFile(file, channelId);
    // For text files, return content; for others (like PDFs), return the file path
    if (typeof result.content === 'string') {
      return result.content;
    }
    // For PDFs and other binary files, return the file path
    return result.filePath;
  }

  /**
   * Download file via HTTP/HTTPS
   * @param {string} url - File URL
   * @returns {Promise<Buffer>} File content
   */
  httpDownload(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      
      const request = client.get(url, {
        headers: {
          'Authorization': `Bearer ${this.slackToken}`,
          'User-Agent': 'Claude-Slack-Bot/2.0',
          'Accept': '*/*'
        }
      }, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectUrl = response.headers.location;
          logger.debug(`Redirect detected to: ${redirectUrl}`);
          
          // Check if this is a redirect to Slack web interface (not a file download)
          // Note: slack.com/?redir= URLs are actually valid file downloads, not login pages
          if (redirectUrl.includes('/signin') || 
              redirectUrl.includes('/login') ||
              (redirectUrl.includes('slack.com') && !redirectUrl.includes('?redir='))) {
            reject(new Error('Authentication failed - redirected to Slack login page. Token may lack file access permissions.'));
            return;
          }
          
          // For legitimate file redirects, follow them
          logger.debug(`Following redirect to: ${redirectUrl}`);
          this.httpDownload(redirectUrl).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          let errorDetails = `HTTP ${response.statusCode}: ${response.statusMessage}`;
          
          // Provide more specific error messages for common issues
          if (response.statusCode === 403) {
            errorDetails += ' - Token may lack file access permissions';
          } else if (response.statusCode === 404) {
            errorDetails += ' - File not found or expired';
          } else if (response.statusCode === 429) {
            errorDetails += ' - Rate limited';
          }
          
          reject(new Error(errorDetails));
          return;
        }

        const chunks = [];
        let downloadedSize = 0;
        
        response.on('data', chunk => {
          chunks.push(chunk);
          downloadedSize += chunk.length;
          
          // Check if file is getting too large during download
          if (downloadedSize > this.maxFileSize) {
            request.destroy();
            reject(new Error(`File too large during download (>${this.maxFileSize} bytes)`));
            return;
          }
        });
        
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          logger.debug(`Download completed: ${buffer.length} bytes`);
          resolve(buffer);
        });
        
        response.on('error', reject);
      });

      request.on('error', (error) => {
        reject(new Error(`Network error: ${error.message}`));
      });
      
      request.setTimeout(2000, () => {  // 2 second timeout to prevent API timeouts
        request.destroy();
        reject(new Error('Download timeout - file access may require additional permissions'));
      });
    });
  }

  /**
   * Get file extension from filename
   * @param {string} filename - File name
   * @returns {string} File extension (lowercase)
   */
  getFileExtension(filename) {
    return path.extname(filename).toLowerCase().slice(1);
  }

  /**
   * Determine file type category
   * @param {string} extension - File extension
   * @returns {string|null} File type category or null
   */
  getFileType(extension) {
    for (const [type, extensions] of Object.entries(this.supportedTypes)) {
      if (extensions.includes(extension)) {
        return type;
      }
    }
    return null;
  }

  /**
   * Extract metadata from Slack file object
   * @param {object} file - Slack file object
   * @returns {object} File metadata
   */
  getFileMetadata(file) {
    return {
      id: file.id,
      name: file.name,
      title: file.title,
      mimetype: file.mimetype,
      size: file.size,
      created: file.created,
      user: file.user,
      mode: file.mode,
      is_external: file.is_external,
      permalink: file.permalink,
      pretty_type: file.pretty_type
    };
  }

  /**
   * Format attachments for Claude context
   * @param {Array} processedFiles - Processed file data
   * @returns {object} Object with context and file paths
   */
  formatAttachmentsForClaude(processedFiles) {
    if (!processedFiles || processedFiles.length === 0) {
      return { context: '', filePaths: [] };
    }

    let context = '\n\n📎 **Message Attachments:**\n';
    const filePaths = [];
    
    for (const file of processedFiles) {
      context += `\n**${file.name}**`;
      
      if (file.type === 'error') {
        context += ` - ❌ ${file.error}`;
        continue;
      }
      
      if (file.type === 'unsupported') {
        context += ` - ⚠️ Unsupported file type (.${file.extension})`;
        continue;
      }

      context += ` (${file.type}, ${this.formatFileSize(file.size)})`;
      
      if (file.type === 'text' || file.type === 'code') {
        // For text files, include content directly in context
        context += `\n\`\`\`${file.extension}\n${file.content}\n\`\`\``;
      } else if (file.type === 'image' || file.type === 'document') {
        // For images and documents, add file path for Claude to read
        if (file.filePath) {
          context += `\n[File type: ${file.extension.toUpperCase()} - Content analysis not available through CLI]`;
          filePaths.push({
            path: file.filePath,
            name: file.name,
            type: file.type,
            extension: file.extension
          });
        } else {
          context += `\n[File processing incomplete - ${file.name}]`;
        }
      }
    }
    
    return { context, filePaths };
  }

  /**
   * Format file size for display
   * @param {number} bytes - Size in bytes
   * @returns {string} Formatted size
   */
  formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Clean up temporary files (call periodically)
   */
  async cleanup() {
    try {
      const entries = await fs.readdir(this.tempDir, { withFileTypes: true });
      const now = Date.now();
      
      for (const entry of entries) {
        const entryPath = path.join(this.tempDir, entry.name);
        
        if (entry.isDirectory()) {
          // Process channel subdirectory
          const files = await fs.readdir(entryPath);
          
          for (const file of files) {
            const filePath = path.join(entryPath, file);
            const stats = await fs.stat(filePath);
            
            // Delete files older than 1 hour
            if (now - stats.mtime.getTime() > 3600000) {
              await fs.unlink(filePath);
              logger.debug(`Cleaned up temp file: ${entry.name}/${file}`);
            }
          }
          
          // Remove empty directories
          const remainingFiles = await fs.readdir(entryPath);
          if (remainingFiles.length === 0) {
            await fs.rmdir(entryPath);
            logger.debug(`Removed empty channel directory: ${entry.name}`);
          }
        } else if (entry.isFile()) {
          // Handle legacy files in root temp directory
          const stats = await fs.stat(entryPath);
          if (now - stats.mtime.getTime() > 3600000) {
            await fs.unlink(entryPath);
            logger.debug(`Cleaned up legacy temp file: ${entry.name}`);
          }
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup temp files:', error);
    }
  }
}

module.exports = FileHandler;