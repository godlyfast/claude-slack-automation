const Anthropic = require('@anthropic-ai/sdk');
const LLMService = require('./base');

class AnthropicService extends LLMService {
  constructor(config) {
    super(config);
    this.anthropic = new Anthropic({
      apiKey: this.config.apiKey,
    });
  }

  async generateResponse(prompt, files = []) {
    const messages = [{ role: 'user', content: prompt }];
    for (const file of files) {
      messages.push({
        role: 'user',
        content: `Here is the content of the file named ${file.name}:\n\n${file.content}`,
      });
    }

    const msg = await this.anthropic.messages.create({
      model: this.config.model,
      max_tokens: 1024,
      messages,
    });

    return msg.content[0].text;
  }
}

module.exports = AnthropicService;
