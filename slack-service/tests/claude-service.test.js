const ClaudeService = require('../src/claude-service');
const { spawn } = require('child_process');
const fs = require('fs');
const EventEmitter = require('events');

// Mock child_process spawn
jest.mock('child_process');

// Mock fs.promises
jest.mock('fs', () => ({
  promises: {
    access: jest.fn()
  }
}));

// Mock logger
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('ClaudeService', () => {
  let claudeService;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConfig = {
      channels: ['#test'],
      triggerKeywords: ['AI', 'help'],
      responseMode: 'all'
    };

    // Set environment variables
    process.env.CLAUDE_TIMEOUT = '30';
    process.env.RESPONSE_STYLE = 'conversational';
    process.env.CHANNEL_HISTORY_LIMIT = '200';
    process.env.CHANNEL_HISTORY_DISPLAY = '100';

    claudeService = new ClaudeService(mockConfig);
  });

  describe('constructor', () => {
    it('should initialize with config and environment variables', () => {
      expect(claudeService.config).toBe(mockConfig);
      expect(claudeService.claudeTimeout).toBe(30);
      expect(claudeService.responseStyle).toBe('conversational');
      expect(claudeService.channelHistoryLimit).toBe(200);
      expect(claudeService.channelHistoryDisplay).toBe(100);
    });

    it('should use default values when env vars are not set', () => {
      delete process.env.CLAUDE_TIMEOUT;
      delete process.env.RESPONSE_STYLE;
      
      const service = new ClaudeService(mockConfig);
      expect(service.claudeTimeout).toBe(30);
      expect(service.responseStyle).toBe('conversational');
    });
  });

  describe('buildClaudeInstruction', () => {
    it('should build basic instruction without history or attachments', async () => {
      const message = {
        text: 'Hello, can you help me?',
        channelName: '#test'
      };

      const instruction = await claudeService.buildClaudeInstruction(message, []);
      
      expect(instruction).toContain('Hello, can you help me?');
      expect(instruction).toContain('You are a helpful Slack bot assistant');
      expect(instruction).toContain('Style: conversational');
      expect(instruction).not.toContain('Channel History');
      expect(instruction).not.toContain('ATTACHED FILES');
    });

    it('should include channel history when provided', async () => {
      const message = {
        text: 'What did John say earlier?',
        channelName: '#test'
      };

      const channelHistory = [
        {
          user: 'U123',
          text: 'John: I think we should use TypeScript',
          timestamp: '1234567890.123456'
        },
        {
          user: 'U456',
          text: 'I agree with John',
          timestamp: '1234567891.123456'
        }
      ];

      const instruction = await claudeService.buildClaudeInstruction(message, channelHistory);
      
      expect(instruction).toContain('Channel History');
      expect(instruction).toContain('<@U123>: John: I think we should use TypeScript');
      expect(instruction).toContain('<@U456>: I agree with John');
    });

    it('should include thread context for thread replies', async () => {
      const message = {
        text: 'What do you think?',
        channelName: '#test',
        isThreadReply: true,
        threadContext: [
          { user: 'Alice', text: 'Should we refactor this code?' },
          { user: 'Bob', text: 'Yes, it needs improvement' }
        ]
      };

      const instruction = await claudeService.buildClaudeInstruction(message, []);
      
      expect(instruction).toContain('Thread conversation history:');
      expect(instruction).toContain('Alice: Should we refactor this code?');
      expect(instruction).toContain('Bob: Yes, it needs improvement');
    });

    it('should include file attachments when present', async () => {
      fs.promises.access.mockResolvedValue(undefined); // File exists

      const message = {
        text: 'Please review this file',
        channelName: '#test',
        hasAttachments: true,
        filePaths: [
          { path: '/tmp/doc.pdf', name: 'document.pdf', type: 'pdf' },
          { path: '/tmp/code.js', name: 'code.js', type: 'javascript' }
        ]
      };

      const instruction = await claudeService.buildClaudeInstruction(message, []);
      
      expect(instruction).toContain('ATTACHED FILES');
      expect(instruction).toContain('The user has shared 2 file(s)');
      expect(instruction).toContain('- document.pdf (pdf)');
      expect(instruction).toContain('- code.js (javascript)');
      expect(instruction).toContain('Please use the Read tool to analyze this file');
      expect(instruction).toContain('Path: /tmp/doc.pdf');
      expect(instruction).toContain('Path: /tmp/code.js');
    });

    it('should handle thread attachment count correctly', async () => {
      const message = {
        text: 'Check these files',
        channelName: '#test',
        hasAttachments: true,
        filePaths: [
          { path: '/tmp/file1.txt', name: 'file1.txt', type: 'text' },
          { path: '/tmp/file2.txt', name: 'file2.txt', type: 'text' },
          { path: '/tmp/file3.txt', name: 'file3.txt', type: 'text' }
        ],
        threadAttachmentCount: 2
      };

      const instruction = await claudeService.buildClaudeInstruction(message, []);
      
      expect(instruction).toContain('(1 from current message, 2 from earlier messages in this thread)');
    });

    it('should filter out inaccessible files', async () => {
      fs.promises.access.mockImplementation((path) => {
        if (path === '/tmp/missing.txt') {
          throw new Error('File not found');
        }
        return Promise.resolve();
      });

      const message = {
        text: 'Review files',
        channelName: '#test',
        hasAttachments: true,
        filePaths: [
          { path: '/tmp/exists.txt', name: 'exists.txt', type: 'text' },
          { path: '/tmp/missing.txt', name: 'missing.txt', type: 'text' }
        ]
      };

      const instruction = await claudeService.buildClaudeInstruction(message, []);
      
      expect(instruction).toContain('There are 1 files available');
      expect(instruction).toContain('exists.txt');
      // The missing file is still listed in attachments but not in read instructions
      expect(instruction).toContain('missing.txt (text)'); // In attachment list
      expect(instruction).not.toContain('Path: /tmp/missing.txt'); // Not in read instructions
    });
  });

  describe('executeClaude', () => {
    let mockClaudeProcess;

    beforeEach(() => {
      mockClaudeProcess = new EventEmitter();
      mockClaudeProcess.stdout = new EventEmitter();
      mockClaudeProcess.stderr = new EventEmitter();
      mockClaudeProcess.stdin = {
        write: jest.fn(),
        end: jest.fn()
      };
      mockClaudeProcess.kill = jest.fn();

      spawn.mockReturnValue(mockClaudeProcess);
    });

    it('should execute claude successfully', async () => {
      const instruction = 'Test instruction';
      const expectedResponse = 'This is Claude\'s response';

      const responsePromise = claudeService.executeClaude(instruction);

      // Simulate Claude responding
      mockClaudeProcess.stdout.emit('data', Buffer.from(expectedResponse));
      mockClaudeProcess.emit('close', 0);

      const response = await responsePromise;

      expect(spawn).toHaveBeenCalledWith('claude', [], {
        timeout: 30000,
        killSignal: 'SIGTERM'
      });
      expect(mockClaudeProcess.stdin.write).toHaveBeenCalledWith(instruction);
      expect(mockClaudeProcess.stdin.end).toHaveBeenCalled();
      expect(response).toBe(expectedResponse);
    });

    it('should handle claude timeout', async () => {
      jest.useFakeTimers();
      const instruction = 'Test instruction';

      const responsePromise = claudeService.executeClaude(instruction);

      // Advance time to trigger timeout
      jest.advanceTimersByTime(30000);

      // Emit close event with non-zero code
      mockClaudeProcess.emit('close', 124);

      await expect(responsePromise).rejects.toThrow('Claude timed out after 30 seconds');
      
      expect(mockClaudeProcess.kill).toHaveBeenCalledWith('SIGTERM');

      jest.useRealTimers();
    });

    it('should handle claude error', async () => {
      const instruction = 'Test instruction';
      const errorMessage = 'Claude encountered an error';

      const responsePromise = claudeService.executeClaude(instruction);

      // Simulate error
      mockClaudeProcess.stderr.emit('data', Buffer.from(errorMessage));
      mockClaudeProcess.emit('close', 1);

      await expect(responsePromise).rejects.toThrow('Claude exited with code 1: Claude encountered an error');
    });

    it('should handle spawn error', async () => {
      const instruction = 'Test instruction';
      const spawnError = new Error('Command not found');

      const responsePromise = claudeService.executeClaude(instruction);

      // Simulate spawn error
      mockClaudeProcess.emit('error', spawnError);

      await expect(responsePromise).rejects.toThrow('Command not found');
    });
  });

  describe('processMessage', () => {
    it('should process message successfully', async () => {
      const message = {
        text: 'Hello Claude',
        channelName: '#test'
      };
      const channelHistory = [];

      // Mock buildClaudeInstruction
      const mockInstruction = 'Test instruction';
      claudeService.buildClaudeInstruction = jest.fn().mockResolvedValue(mockInstruction);

      // Mock executeClaude
      const mockResponse = 'Hello! How can I help you?';
      claudeService.executeClaude = jest.fn().mockResolvedValue(mockResponse);

      const response = await claudeService.processMessage(message, channelHistory);

      expect(claudeService.buildClaudeInstruction).toHaveBeenCalledWith(message, channelHistory);
      expect(claudeService.executeClaude).toHaveBeenCalledWith(mockInstruction);
      expect(response).toBe(mockResponse);
    });

    it('should return timeout message on timeout error', async () => {
      const message = { text: 'Complex request', channelName: '#test' };

      claudeService.buildClaudeInstruction = jest.fn().mockResolvedValue('instruction');
      
      const timeoutError = new Error('Timeout');
      timeoutError.code = 'TIMEOUT';
      claudeService.executeClaude = jest.fn().mockRejectedValue(timeoutError);

      const response = await claudeService.processMessage(message, []);

      expect(response).toContain('Request Timed Out');
      expect(response).toContain('30 seconds');
    });

    it('should return execution error for non-timeout errors', async () => {
      const message = { text: 'Test', channelName: '#test' };

      claudeService.buildClaudeInstruction = jest.fn().mockResolvedValue('instruction');
      claudeService.executeClaude = jest.fn().mockRejectedValue(new Error('Other error'));

      const response = await claudeService.processMessage(message, []);
      expect(response).toBe('Execution error');
    });
  });

  describe('getTimeoutMessage', () => {
    it('should return formatted timeout message', () => {
      const message = claudeService.getTimeoutMessage();

      expect(message).toContain('Request Timed Out');
      expect(message).toContain('30 seconds');
      expect(message).toContain('CLAUDE_TIMEOUT');
      expect(message).toContain('config.env');
    });
  });

  describe('prefetchChannelHistories', () => {
    it('should prefetch histories for multiple channels', async () => {
      const channels = ['#general', '#random'];
      const mockFetchHistory = jest.fn()
        .mockResolvedValueOnce([
          { user: 'U1', text: 'Message 1', filePaths: [{ path: '/tmp/file1.txt' }] },
          { user: 'U2', text: 'Message 2' }
        ])
        .mockResolvedValueOnce([
          { user: 'U3', text: 'Message 3' }
        ]);

      const histories = await claudeService.prefetchChannelHistories(channels, mockFetchHistory);

      expect(mockFetchHistory).toHaveBeenCalledTimes(2);
      expect(mockFetchHistory).toHaveBeenCalledWith('#general', 200);
      expect(mockFetchHistory).toHaveBeenCalledWith('#random', 200);

      expect(histories['#general']).toHaveLength(2);
      expect(histories['#general_files']).toHaveLength(1);
      expect(histories['#random']).toHaveLength(1);
      expect(histories['#random_files']).toBeUndefined();
    });

    it('should handle fetch errors gracefully', async () => {
      const channels = ['#error-channel'];
      const mockFetchHistory = jest.fn().mockRejectedValue(new Error('Fetch failed'));

      const histories = await claudeService.prefetchChannelHistories(channels, mockFetchHistory);

      expect(histories).toEqual({});
    });
  });

  describe('filterFilePathsByChannel', () => {
    it('should filter file paths by channel ID', () => {
      const filePaths = [
        { path: '/tmp/C123/file1.txt' },
        { path: '/tmp/C456/file2.txt' },
        { path: '/tmp/C123/file3.txt' }
      ];

      const filtered = claudeService.filterFilePathsByChannel(filePaths, 'C123');

      expect(filtered).toHaveLength(2);
      expect(filtered[0].path).toContain('C123');
      expect(filtered[1].path).toContain('C123');
    });

    it('should handle direct path strings', () => {
      const filePaths = [
        '/tmp/C123/file1.txt',
        '/tmp/C456/file2.txt'
      ];

      const filtered = claudeService.filterFilePathsByChannel(filePaths, 'C123');

      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toContain('C123');
    });

    it('should sanitize channel ID', () => {
      const filePaths = [
        { path: '/tmp/C_23_45/file.txt' }
      ];

      const filtered = claudeService.filterFilePathsByChannel(filePaths, 'C#23@45');

      expect(filtered).toHaveLength(1);
    });

    it('should return empty array for invalid inputs', () => {
      expect(claudeService.filterFilePathsByChannel(null, 'C123')).toEqual([]);
      expect(claudeService.filterFilePathsByChannel([], 'C123')).toEqual([]);
      expect(claudeService.filterFilePathsByChannel([{ path: '/tmp/file.txt' }], null)).toEqual([]);
    });
  });
});