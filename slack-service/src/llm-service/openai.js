const OpenAI = require('openai');
const LLMService = require('./base');

class OpenAIService extends LLMService {
  constructor(config) {
    super(config);
    this.openai = new OpenAI({
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

    const completion = await this.openai.chat.completions.create({
      model: this.config.model,
      messages,
    });

    return completion.choices[0].message.content;
  }
}

module.exports = OpenAIService;
