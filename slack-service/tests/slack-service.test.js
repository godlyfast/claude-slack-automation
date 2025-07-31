const SlackService = require('../src/slack-service');
const Database = require('../src/db');

jest.mock('@slack/web-api');
jest.mock('../src/db');
jest.mock('../src/cache');
jest.mock('../src/loop-prevention');
jest.mock('../src/file-handler');
jest.mock('../src/channel-rotator');

describe('SlackService', () => {
  let slackService;
  let mockWebClient;
  let mockDb;
  let mockCache;

  const config = {
    channels: ['#general', '#random'],
    triggerKeywords: ['AI', 'bot', 'help'],
    responseMode: 'all', // Change to 'all' for easier testing
    maxMessages: 10,
    checkWindow: 5,
    cacheEnabled: false, // Disable cache for most tests
    useChannelRotation: false // Disable channel rotation for tests
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Mock LoopPreventionSystem
    const mockLoopPrevention = {
      checkAndRecordMessage: jest.fn().mockResolvedValue({ allowed: true }),
      shouldAllowResponse: jest.fn().mockResolvedValue({ allow: true }),
      recordBotResponse: jest.fn(),
      recordResponse: jest.fn(),
      getStatus: jest.fn().mockReturnValue({}),
      activateEmergencyStop: jest.fn(),
      deactivateEmergencyStop: jest.fn(),
      isEmergencyStopped: jest.fn().mockReturnValue(false),
      validateResponseContent: jest.fn().mockReturnValue({ modified: false, cleaned: null })
    };
    require('../src/loop-prevention').mockImplementation(() => mockLoopPrevention);
    
    // Mock FileHandler
    const mockFileHandler = {
      init: jest.fn().mockResolvedValue(undefined),
      processAttachments: jest.fn().mockResolvedValue([]),
      formatAttachmentsForClaude: jest.fn().mockReturnValue({ context: '', filePaths: [] })
    };
    require('../src/file-handler').mockImplementation(() => mockFileHandler);

    mockWebClient = {
      conversations: {
        history: jest.fn(),
        list: jest.fn(),
        replies: jest.fn()
      },
      chat: {
        postMessage: jest.fn()
      },
      on: jest.fn() // Mock event listener for rate limiting events
    };

    mockDb = {
      hasResponded: jest.fn(),
      markAsResponded: jest.fn(),
      getRespondedMessages: jest.fn(),
      close: jest.fn(),
      trackThread: jest.fn(),
      recordBotResponse: jest.fn(),
      isBotResponse: jest.fn()
    };

    mockCache = {
      get: jest.fn().mockReturnValue(null),
      set: jest.fn(),
      clear: jest.fn(),
      getStats: jest.fn().mockReturnValue({ hits: 0, misses: 0 }),
      incrementRateLimitSaves: jest.fn()
    };

    // Rate limiter removed - SDK handles rate limiting

    Database.mockImplementation(() => mockDb);
    const { WebClient } = require('@slack/web-api');
    WebClient.mockImplementation(() => mockWebClient);

    const cache = require('../src/cache');
    Object.assign(cache, mockCache);

    // Rate limiter has been removed - SDK handles rate limiting
    
    // Mock channel rotator - let it return the first channel
    const channelRotator = require('../src/channel-rotator');
    channelRotator.getNextChannels = jest.fn().mockImplementation((channels) => 
      Promise.resolve(channels.slice(0, 1))
    );

    slackService = new SlackService('test-token', config);
    await slackService.init(); // Initialize file handler
  });

  describe('getUnrespondedMessages', () => {
    it('should return empty array when no channels configured', async () => {
      slackService.config.channels = [];
      const messages = await slackService.getUnrespondedMessages();
      expect(messages).toEqual([]);
    });

    it('should fetch messages from configured channels', async () => {
      mockWebClient.conversations.list.mockResolvedValue({
        ok: true,
        channels: [
          { id: 'C123', name: 'general' },
          { id: 'C456', name: 'random' }
        ]
      });

      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: []
      });

      // Disable channel rotation for this test
      slackService.config.useChannelRotation = false;

      await slackService.getUnrespondedMessages();

      expect(mockWebClient.conversations.history).toHaveBeenCalledTimes(2);
    });

    it('should filter out bot messages', async () => {
      // Mock conversations.list to always return the channel 'general'
      mockWebClient.conversations.list.mockResolvedValue({
        ok: true,
        channels: [
          { id: 'C123', name: 'general', is_channel: true },
          { id: 'C456', name: 'random', is_channel: true }
        ]
      });

      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: [
          { ts: '1234567890.1', text: 'AI help needed', user: 'U123' },
          { ts: '1234567890.2', text: 'Bot message', bot_id: 'B123' }
        ]
      });

      mockDb.hasResponded.mockResolvedValue(false);
      mockDb.isBotResponse.mockResolvedValue(false);

      const messages = await slackService.getUnrespondedMessages();
      
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('AI help needed');
    });

    it('should filter out already responded messages', async () => {
      // Create a new instance with a single channel to simplify
      const testService = new SlackService('test-token', {
        ...config,
        channels: ['#general'],
        useChannelRotation: false
      });

      mockWebClient.conversations.list.mockResolvedValue({
        ok: true,
        channels: [{ id: 'C123', name: 'general' }]
      });

      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: [
          { ts: '1234567890.1', text: 'AI help needed', user: 'U123' },
          { ts: '1234567890.2', text: 'AI question', user: 'U456' }
        ]
      });

      // Set up hasResponded to return true for first message, false for second
      mockDb.hasResponded.mockImplementation((messageId) => {
        return Promise.resolve(messageId === '#general-1234567890.1');
      });

      const messages = await testService.getUnrespondedMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].ts).toBe('1234567890.2');
    });
  });

  describe('_shouldRespondToMessage', () => {
    it('should return false when no keywords match', () => {
      const message = { text: 'Hello world' };
      expect(slackService._shouldRespondToMessage(message)).toBe(false);
    });

    it('should return true when keyword matches in "all" mode', () => {
      slackService.config.responseMode = 'all';
      const message = { text: 'I need AI assistance' };
      expect(slackService._shouldRespondToMessage(message)).toBe(true);
    });

    it('should return true when keyword and mention present in "mentions" mode', () => {
      slackService.config.responseMode = 'mentions';
      const message = { text: 'Hey <@U123> I need AI help' };
      expect(slackService._shouldRespondToMessage(message)).toBe(true);
    });

    it('should return false when keyword present but no mention in "mentions" mode', () => {
      slackService.config.responseMode = 'mentions';
      const message = { text: 'I need AI help' };
      expect(slackService._shouldRespondToMessage(message)).toBe(false);
    });

    it('should handle case-insensitive keyword matching', () => {
      slackService.config.responseMode = 'all';
      const message = { text: 'I need ai assistance' };
      expect(slackService._shouldRespondToMessage(message)).toBe(true);
    });

    it('should treat thread replies same as channel messages based on mode', () => {
      slackService.config.responseMode = 'all';
      const message = { text: 'I need AI help' };
      expect(slackService._shouldRespondToMessage(message, true)).toBe(true);
      
      slackService.config.responseMode = 'mentions';
      expect(slackService._shouldRespondToMessage(message, true)).toBe(false);
      
      const messageWithMention = { text: '<@U123> I need AI help' };
      expect(slackService._shouldRespondToMessage(messageWithMention, true)).toBe(true);
    });
  });

  describe('postResponse', () => {
    it('should post message and mark as responded', async () => {
      const message = {
        id: 'test-123',
        channel: '#general',
        thread_ts: '1234567890.123456'
      };
      const responseText = 'Here is my response';

      mockWebClient.chat.postMessage.mockResolvedValue({
        ok: true,
        ts: '1234567890.234567'
      });

      await slackService.postResponse(message, responseText);

      expect(mockWebClient.chat.postMessage).toHaveBeenCalledWith({
        channel: '#general',
        text: responseText,
        thread_ts: '1234567890.123456',
        as_user: true
      });

      expect(mockDb.markAsResponded).toHaveBeenCalledWith(
        'test-123',
        '#general',
        '1234567890.123456',
        responseText
      );
    });

    it('should throw error when posting fails', async () => {
      const message = {
        id: 'test-123',
        channel: '#general',
        thread_ts: '1234567890.123456'
      };

      mockWebClient.chat.postMessage.mockResolvedValue({
        ok: false,
        error: 'channel_not_found'
      });

      await expect(
        slackService.postResponse(message, 'Test response')
      ).rejects.toThrow('Failed to post message: channel_not_found');
    });
  });

  // _extractMentions method was removed - mentions are handled differently now

  describe('caching', () => {
    beforeEach(() => {
      // Enable caching for these tests
      slackService.config.cacheEnabled = true;
    });

    it('should use cached channel list when available', async () => {
      // Create a service with a single channel to simplify testing
      const testService = new SlackService('test-token', {
        ...config,
        channels: ['#general'],
        cacheEnabled: true
      });
      
      const cachedChannel = { id: 'C123', name: 'general' };
      
      // Mock cache to return the specific channel
      mockCache.get
        .mockImplementation((key) => {
          if (key === 'channel:general') {
            return cachedChannel; // Return cached channel directly
          }
          if (key.startsWith('channel-name:')) {
            return 'general'; // Return cached channel name
          }
          return null;
        });
      
      // Mock messages for the cached channels
      mockWebClient.conversations.history.mockResolvedValue({
        ok: true,
        messages: []
      });
      
      // Mock hasResponded to return false
      mockDb.hasResponded.mockResolvedValue(false);

      await testService.getUnrespondedMessages();

      // Should have checked for channel:general
      expect(mockCache.get).toHaveBeenCalledWith('channel:general');
      // Should have saved a rate limit call
      expect(mockCache.incrementRateLimitSaves).toHaveBeenCalled();
      // Should NOT have called the API
      expect(mockWebClient.conversations.list).not.toHaveBeenCalled();
    });

    it('should cache channel list after fetching', async () => {
      mockCache.get.mockReturnValue(null);
      mockWebClient.conversations.list.mockResolvedValue({
        ok: true,
        channels: [{ id: 'C123', name: 'general' }]
      });

      await slackService.getUnrespondedMessages();

      expect(mockCache.set).toHaveBeenCalledWith(
        'channels:list',
        [{ id: 'C123', name: 'general' }],
        3600 // Default channel cache TTL in slack-service.js
      );
    });

    it('should cache stats operations', () => {
      const stats = { hits: 10, misses: 2 };
      mockCache.getStats.mockReturnValue(stats);

      const result = slackService.getCacheStats();
      expect(result).toEqual(stats);
    });

    it('should clear cache', () => {
      slackService.clearCache();
      expect(mockCache.clear).toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('should let SDK handle rate limit errors', async () => {
      // The Slack SDK now handles rate limiting automatically
      // with built-in retry logic
      const rateLimitError = new Error('rate_limited');
      rateLimitError.code = 'rate_limited';
      
      mockWebClient.conversations.list
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          ok: true,
          channels: []
        });

      // The SDK will handle the retry internally
      await expect(slackService.getUnrespondedMessages()).rejects.toThrow('rate_limited');
    });
  });

  describe('thread monitoring', () => {
    it('should track thread when posting response', async () => {
      const message = {
        id: 'test-123',
        channel: '#general',
        thread_ts: '1234567890.123456'
      };
      const responseText = 'Here is my response';

      mockWebClient.chat.postMessage.mockResolvedValue({
        ok: true,
        ts: '1234567890.234567'
      });

      await slackService.postResponse(message, responseText);

      expect(mockDb.trackThread).toHaveBeenCalledWith(
        '#general',
        '1234567890.123456'
      );
    });





  });
});