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