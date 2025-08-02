const AnthropicService = require('./anthropic');
const OpenAIService = require('./openai');
const GoogleService = require('./google');
const ClaudeCodeService = require('./claude-code');

function createLLMService(config) {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicService(config);
    case 'openai':
      return new OpenAIService(config);
    case 'google':
      return new GoogleService(config);
    case 'claude-code':
      return new ClaudeCodeService(config);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

module.exports = { createLLMService };
