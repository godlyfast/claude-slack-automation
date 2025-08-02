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
        const uploadedFile = await this.genAI.files.upload({
          path: file.path,
        });
        
        parts.push({ fileData: { fileUri: uploadedFile.uri, mimeType: uploadedFile.mimeType } });
      } catch (error) {
        logger.error(`Failed to upload file ${file.name} to Google AI`, error);
        // Fallback to embedding content if upload fails
        const fs = require('fs').promises;
        const content = await fs.readFile(file.path, 'utf-8');
        parts.push({ text: `Here is the content of the file named ${file.name}:\n\n${content}` });
      }
    }

    logger.info('Sending parts to Google:', { parts: JSON.stringify(parts, null, 2) });

    const result = await model.generateContent(parts);
    const response = await result.response;
    return response.text();
  }
}

module.exports = GoogleService;
