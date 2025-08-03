const SlackService = require('../src/slack-service');
const { WebClient, ErrorCode } = require('@slack/web-api');

jest.mock('@slack/web-api');

describe('Rate Limiting', () => {
  let slackService;

  beforeEach(() => {
    slackService = new SlackService('test-token', {});
  });

  it('should retry with exponential backoff on rate limit errors', async () => {
    const mockApiCall = jest.fn()
      .mockRejectedValueOnce({ code: ErrorCode.RateLimitedError, retryAfter: 1 })
      .mockResolvedValueOnce({ ok: true });

    await slackService._apiCallWithRetry(mockApiCall, 'test.method');

    expect(mockApiCall).toHaveBeenCalledTimes(2);
  });
});