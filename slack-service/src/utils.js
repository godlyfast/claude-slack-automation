const logger = require('./logger');

/**
 * Gets timeout in milliseconds from environment config
 * Supports both API_TIMEOUT (in seconds) and REQUEST_TIMEOUT_MS (in milliseconds)
 * @param {number} multiplier - Optional multiplier for the timeout
 * @returns {number} Timeout in milliseconds
 */
function getTimeoutMs(multiplier = 1) {
  const baseTimeout = process.env.API_TIMEOUT 
    ? parseInt(process.env.API_TIMEOUT) * 1000 
    : parseInt(process.env.REQUEST_TIMEOUT_MS) || 3000;
  return baseTimeout * multiplier;
}

/**
 * Creates a timeout promise that rejects after specified milliseconds
 * @param {number} ms - Timeout in milliseconds (optional)
 * @param {string} message - Error message to use on timeout
 * @returns {Promise} Promise that rejects after timeout
 */
function createTimeoutPromise(ms, message) {
  const timeout = ms ? parseInt(ms) : getTimeoutMs();
  const errorMessage = message || `Request timed out after ${timeout}ms`;
  
  return new Promise((_, reject) => 
    setTimeout(() => reject(new Error(errorMessage)), timeout)
  );
}

/**
 * Executes a promise with a timeout
 * @param {Promise} promise - Promise to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} timeoutMessage - Error message on timeout
 * @returns {Promise} Result of the promise or timeout error
 */
async function withTimeout(promise, timeoutMs, timeoutMessage) {
  const timeoutPromise = createTimeoutPromise(timeoutMs, timeoutMessage);
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Standard error response handler for Express routes
 * @param {Response} res - Express response object
 * @param {Error} error - Error object
 * @param {string} context - Context for error logging
 */
function handleErrorResponse(res, error, context) {
  logger.error(`Error ${context}:`, error);
  
  const response = {
    success: false,
    error: error.message
  };
  
  // Include retry-after if it's a rate limit error
  if (error.retryAfter) {
    response.retryAfter = error.retryAfter;
    response.error = `Rate limited: ${error.message} (retry after ${error.retryAfter} seconds)`;
  }
  
  res.status(500).json(response);
}

module.exports = {
  getTimeoutMs,
  createTimeoutPromise,
  withTimeout,
  handleErrorResponse
};