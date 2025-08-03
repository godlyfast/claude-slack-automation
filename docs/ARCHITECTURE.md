# System Architecture

## Unified Node.js Service

The current architecture is a unified Node.js service that handles all aspects of the bot's operation, from Slack API interaction to message processing and scheduling. This design simplifies the system by removing the need for external shell scripts and consolidating all logic into a single, manageable codebase.

### Proposed Architecture

```mermaid
graph TD
    subgraph "Unified Node.js Service"
        A[API Server (Express.js)]
        B[Scheduler (e.g., node-cron)] --> C{Queue Manager};
        C --> D[Message Fetcher];
        C --> E[Message Processor];
        C --> F[Response Sender];
        D --> G[Slack API Service];
        E --> H[LLM Service];
        F --> G;
        G --> I[Database Service];
        H --> I;
    end

    subgraph "External Systems"
        J[Slack] <--> G;
        K[LLM Providers] <--> H;
        L[Database] <--> I;
    end

    A -- "Provides health checks, status, and manual triggers" --> C;
```

### Key Components

*   **API Server (Express.js)**: Provides endpoints for health checks, status monitoring, and manual control over the service.
*   **Scheduler (node-cron)**: Manages scheduled tasks, such as fetching new messages and sending queued responses.
*   **Queue Manager**: Orchestrates the flow of messages through the system, from fetching to processing and sending.
*   **Slack API Service**: Handles all communication with the Slack API, including fetching messages and sending responses.
*   **LLM Service**: Interfaces with Large Language Model providers like Anthropic, OpenAI, or Google.
*   **Database Service**: Manages all interactions with the database, including storing messages, responses, and application state.

### Benefits of the Unified Architecture

*   **Simplicity**: A single codebase written in Node.js, making it easier to understand and manage.
*   **Maintainability**: A unified structure simplifies debugging, testing, and adding new features.
*   **Performance**: Eliminates the overhead associated with executing shell scripts, leading to better performance.
*   **Reliability**: Can be managed with a robust process manager like PM2 or containerized with Docker for improved reliability and scalability.

## Data and State Management

The application uses a database to manage state and queue messages, ensuring data persistence and resilience.

*   **Database**: While SQLite is used for development, the database layer is designed to be extensible, allowing for a future transition to more scalable solutions like PostgreSQL or MySQL.
*   **Configuration**: Application settings are managed through environment variables, loaded via the `dotenv` library. This provides a flexible and secure way to configure the service for different environments (development, production, etc.).