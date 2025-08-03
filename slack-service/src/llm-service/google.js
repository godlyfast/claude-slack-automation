const { GoogleGenerativeAI } = require('@google/generative-ai');
const LLMService = require('./base');

class GoogleService extends LLMService {
  constructor(config) {
    super(config);
    this.genAI = new GoogleGenerativeAI(this.config.apiKey);
  }

  async generateResponse(prompt, files = []) {
    const logger = require('../logger');
    logger.info('Google LLM generateResponse called with:', {
      prompt,
      filesCount: files.length,
      files: files.map(f => ({ name: f.name, path: f.path }))
    });

    const model = this.genAI.getGenerativeModel({ model: this.config.model });
    const parts = [{ text: prompt }];

    for (const file of files) {
      try {
        // Check if file upload API is available (newer SDK versions)
        if (this.genAI.files && this.genAI.files.upload) {
          const uploadedFile = await this.genAI.files.upload({
            path: file.path,
          });
          
          parts.push({ fileData: { fileUri: uploadedFile.uri, mimeType: uploadedFile.mimeType } });
        } else {
          // If file upload API is not available, check file type
          const fs = require('fs').promises;
          const path = require('path');
          const ext = path.extname(file.path).toLowerCase();
          
          if (ext === '.pdf') {
            // PDFs cannot be read as text directly
            parts.push({ text: `[PDF File: ${file.name}]\n\nNote: PDF file analysis is not available when the file upload API is not supported. Please use a text-based format or ensure the Google AI file upload API is available.` });
          } else {
            // For text files, embed content directly
            try {
              const content = await fs.readFile(file.path, 'utf-8');
              parts.push({ text: `Here is the content of the file named ${file.name}:\n\n${content}` });
            } catch (error) {
              // File might be binary or unreadable
              parts.push({ text: `[Binary File: ${file.name}]\n\nThis appears to be a binary file that cannot be read as text. File type: ${ext}` });
            }
          }
        }
      } catch (error) {
        logger.error(`Failed to process file ${file.name}:`, error);
        // Fallback handling
        const path = require('path');
        const ext = path.extname(file.path).toLowerCase();
        if (ext === '.pdf') {
          parts.push({ text: `[PDF File: ${file.name}]\n\nNote: PDF file analysis encountered an error. PDF support requires the Google AI file upload API.` });
        } else {
          parts.push({ text: `[File: ${file.name}]\n\nUnable to process this file. Error: ${error.message}` });
        }
      }
    }

    logger.info('Sending parts to Google:', { parts: JSON.stringify(parts, null, 2) });

    const result = await model.generateContent(parts);
    const response = result.response;
    return response.text();
  }
}

module.exports = GoogleService;
