class LLMService {
  constructor(config) {
    this.config = config;
  }

  async generateResponse(prompt, files = []) {
    throw new Error('Not implemented');
  }
}

module.exports = LLMService;
