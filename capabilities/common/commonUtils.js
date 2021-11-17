const {logger} = require('@skinternal/skconnectorsdk');

const deriveApiHostFromTokenEndpoint = (tokenEndpoint) => {
  try {
    const url = new URL(tokenEndpoint);
    return url.hostname.replace("auth", "api");
  } catch (err) {
    logger.error("Not a valid token endpoint! tokenEndpoint=" + tokenEndpoint);
    throw err;
  }
};

module.exports = {
  deriveApiHostFromTokenEndpoint,
};
