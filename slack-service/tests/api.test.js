const request = require('supertest');
const API = require('../src/api');
const SlackService = require('../src/slack-service');

jest.mock('../src/slack-service');

describe('API', () => {
  let api;
  let app;
  let mockSlackService;

  beforeEach(() => {
    mockSlackService = {
      getUnrespondedMessages: jest.fn(),
      postResponse: jest.fn(),
      db: {
        getRespondedMessages: jest.fn()
      }
    };

    SlackService.mockImplementation(() => mockSlackService);
    api = new API(mockSlackService);
    app = api.app;
  });

  afterEach(() => {
    if (api.server) {
      api.stop();
    }
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('GET /messages/unresponded', () => {
    it('should return unresponded messages', async () => {
      const mockMessages = [
        { id: 'msg-1', text: 'Test message 1' },
        { id: 'msg-2', text: 'Test message 2' }
      ];

      mockSlackService.getUnrespondedMessages.mockResolvedValue(mockMessages);

      const response = await request(app).get('/messages/unresponded');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        count: 2,
        messages: mockMessages
      });
    });

    it('should handle errors gracefully', async () => {
      mockSlackService.getUnrespondedMessages.mockRejectedValue(new Error('Service error'));

      const response = await request(app).get('/messages/unresponded');
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Service error'
      });
    });
  });

  describe('POST /messages/respond', () => {
    it('should post response successfully', async () => {
      const requestBody = {
        message: { id: 'msg-1', channel: '#general', thread_ts: '123' },
        response: 'Test response'
      };

      mockSlackService.postResponse.mockResolvedValue({ ok: true });

      const response = await request(app)
        .post('/messages/respond')
        .send(requestBody);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockSlackService.postResponse).toHaveBeenCalledWith(
        requestBody.message,
        requestBody.response
      );
    });

    it('should return 400 for missing message', async () => {
      const response = await request(app)
        .post('/messages/respond')
        .send({ response: 'Test' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: 'Missing message or response'
      });
    });

    it('should return 400 for missing response', async () => {
      const response = await request(app)
        .post('/messages/respond')
        .send({ message: { id: 'msg-1' } });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: 'Missing message or response'
      });
    });

    it('should handle posting errors', async () => {
      mockSlackService.postResponse.mockRejectedValue(new Error('Slack error'));

      const response = await request(app)
        .post('/messages/respond')
        .send({
          message: { id: 'msg-1', channel: '#general' },
          response: 'Test response'
        });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Slack error'
      });
    });
  });

  describe('GET /messages/responded', () => {
    it('should return responded messages', async () => {
      const mockMessages = [
        { id: 1, message_id: 'msg-1', response_text: 'Response 1' },
        { id: 2, message_id: 'msg-2', response_text: 'Response 2' }
      ];

      mockSlackService.db.getRespondedMessages.mockResolvedValue(mockMessages);

      const response = await request(app).get('/messages/responded');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        count: 2,
        messages: mockMessages
      });
    });

    it('should respect limit query parameter', async () => {
      mockSlackService.db.getRespondedMessages.mockResolvedValue([]);

      await request(app).get('/messages/responded?limit=50');
      expect(mockSlackService.db.getRespondedMessages).toHaveBeenCalledWith(50);
    });

    it('should use default limit when not provided', async () => {
      mockSlackService.db.getRespondedMessages.mockResolvedValue([]);

      await request(app).get('/messages/responded');
      expect(mockSlackService.db.getRespondedMessages).toHaveBeenCalledWith(100);
    });
  });

  describe('404 handler', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/unknown/route');
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Not found' });
    });
  });

  describe('Server lifecycle', () => {
    it('should start and stop server', (done) => {
      const server = api.start(0);
      expect(server).toBeDefined();
      
      server.on('listening', () => {
        api.stop();
        done();
      });
    });
  });
});