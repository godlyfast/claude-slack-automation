# Deployment Guide

This guide provides instructions for deploying the Claude Slack Bot using Docker. Containerization ensures a consistent and reproducible environment for running the application.

## Prerequisites

*   [Docker](https://docs.docker.com/get-docker/) installed on your system.
*   A `config.env` file containing the necessary environment variables. See [ENVIRONMENT_CONFIGURATION.md](./ENVIRONMENT_CONFIGURATION.md) for details.

## Building and Running with Docker Compose

The easiest way to deploy the application is with `docker-compose`, which uses the `docker-compose.yml` and `Dockerfile` at the root of the project.

1.  **Build the Docker Image**:
    Open a terminal in the project root and run:
    ```bash
    docker-compose build
    ```
    This command builds the Docker image based on the instructions in the `Dockerfile`.

2.  **Start the Service**:
    Once the build is complete, start the service in detached mode:
    ```bash
    docker-compose up -d
    ```
    The application will now be running in a container, and the service will be accessible on port 3030.

## Dockerfile

The `Dockerfile` defines the environment and steps required to build the application image.

```dockerfile
# Use an official Node.js runtime as a parent image
ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY slack-service/package*.json ./

# Install app dependencies
RUN npm install

# Copy the rest of the application source code
COPY slack-service/ ./

# Make port 3030 available to the world outside this container
EXPOSE 3030

# Define the command to run the app
CMD [ "node", "src/index.js" ]
```

## Docker Compose Configuration

The `docker-compose.yml` file orchestrates the deployment of the application container.

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3030:3030"
    volumes:
      - ./slack-service:/usr/src/app
      - /usr/src/app/node_modules
    env_file:
      - config.env
```

### Key Configuration Points:

*   **`build: .`**: Instructs Docker Compose to build the image from the `Dockerfile` in the current directory.
*   **`ports: - "3030:3030"`**: Maps port 3030 on the host to port 3030 in the container.
*   **`volumes`**: Mounts the `slack-service` directory into the container for development, allowing for live code reloading. The `node_modules` volume prevents the local `node_modules` from overwriting the container's.
*   **`env_file: - config.env`**: Loads environment variables from the `config.env` file.