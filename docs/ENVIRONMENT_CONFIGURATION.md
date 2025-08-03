# Environment Configuration Guide

This guide documents all configurable environment variables for the Claude Slack Bot.

## Configuration File

All configuration is managed through a `config.env` file located in the project root. The Node.js application uses the `dotenv` library to load these variables into the environment.

### Example `config.env`

```bash
# Slack Configuration
SLACK_BOT_TOKEN="xoxp-your-slack-user-token"
SLACK_CHANNELS="#general,#random"
TRIGGER_KEYWORDS="claude,help"
RESPONSE_MODE="mentions" # "all" or "mentions"

# LLM Configuration
LLM_PROVIDER="anthropic" # "anthropic", "openai", or "google"
LLM_API_KEY="your-llm-api-key"
LLM_MODEL="claude-3-sonnet-20240229"

# Service Configuration
SERVICE_PORT=3030
MAX_MESSAGES=15
CHECK_WINDOW=5 # in minutes

# Cache Configuration
CACHE_ENABLED=true
CHANNEL_CACHE_TTL=300 # in seconds
MESSAGE_CACHE_TTL=30 # in seconds
```

## Environment Variables

### Core Configuration

| Variable | Description | Default | Required |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | Your Slack user token (starting with `xoxp-`). | `null` | Yes |
| `SLACK_CHANNELS` | Comma-separated list of channels for the bot to monitor. | `[]` | Yes |
| `TRIGGER_KEYWORDS` | Comma-separated list of keywords that trigger the bot. | `[]` | Yes |
| `RESPONSE_MODE` | Determines how the bot responds: `all` (all messages) or `mentions` (only when mentioned). | `mentions` | No |

### LLM Configuration

| Variable | Description | Default | Required |
|---|---|---|---|
| `LLM_PROVIDER` | The LLM provider to use. Supported: `anthropic`, `openai`, `google`. | `anthropic` | No |
| `LLM_API_KEY` | The API key for your chosen LLM provider. | `null` | Yes |
| `LLM_MODEL` | The specific model to use from the provider. | Varies by provider | No |

### Service Operation

| Variable | Description | Default | Required |
|---|---|---|---|
| `SERVICE_PORT` | The port on which the service will run. | `3030` | No |
| `MAX_MESSAGES` | The maximum number of messages to fetch in each check cycle. | `15` | No |
| `CHECK_WINDOW` | The time window in minutes to check for new messages. | `5` | No |

### Cache Configuration

| Variable | Description | Default | Required |
|---|---|---|---|
| `CACHE_ENABLED` | Enables or disables caching for channels and messages. | `true` | No |
| `CHANNEL_CACHE_TTL` | Time-to-live for channel cache in seconds. | `300` | No |
| `MESSAGE_CACHE_TTL` | Time-to-live for message cache in seconds. | `30` | No |

## Best Practices

*   **Security**: Never commit your `config.env` file to version control. Add it to your `.gitignore` file to prevent accidental exposure of sensitive credentials.
*   **Portability**: Using environment variables ensures that the application is portable and can be easily configured for different deployment environments (development, staging, production) without code changes.