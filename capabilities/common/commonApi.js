const axios = require('axios');
const nodeCache = require('node-cache');
const {logger, serr} = require('@skinternal/skconnectorsdk');
const _ = require('lodash');

// token cache -- will cache with respect to clientId
// ttl is set to 2 hours (with delete on expire) by default
// (so all entries will stick around for max of 2 hours)
// BUT the token data cached contains the date of expiration of token (retrieved from rest response)
// which is what we use to derive whether the cached token is ok to be used.
// https://www.npmjs.com/package/node-cache
const tokenCache = new nodeCache({ stdTTL: 60 * 60 * 2, deleteOnExpire: true });

/**
 * function to Configure axios tailored for ping API interaction
 * Adds a response interceptor for unauthorized requests.
 *
 * @function configureAxios
 * @override
 * @param {object} props that is required by this function.
 *
 * @return {object} response
 */
const configureAxios = (props) => {
  const instance = axios.create();
  instance.interceptors.response.use(response => response,async (err) => {
    return errorResponseHandlerInterceptor(err, props, instance);
  });
  return instance;
};

const configureAxiosInstance = (config = {}) => {
  return axios.create(config);
};

// /**
//  * function to Get the access token. Note - this should be called once the token cache has been checked to avoid excessive fetching of access tokens.
//  *
//  * @function getAccessToken
//  * @override
//  * @param {object} payload contains the props (tokenEndpoint, envId, clientId, clientSecret, managementTokenAuthenticationMethod) that are required by this function.
//  *
//  * @return {object} containing access token
//  */
// const getAccessToken = async ({ tokenEndpoint, clientId, clientSecret, managementTokenAuthenticationMethod }) => {

//   const tokenFromCache = await tokenCache.get(clientId);

//   if(tokenFromCache && tokenFromCache.accessToken) { // if cache has access tokens, check expiration

//     const currentTimestamp = Date.now(); // UTC milliseconds
//     const canUseCachedToken = tokenFromCache.expiresOnMillis > currentTimestamp
//       && ((tokenFromCache.expiresOnMillis - currentTimestamp) > 60000);

//     if(canUseCachedToken) { // is not expired AND will expire after more than a min -- get cached value
//       //TODO: consider tuning the 60 sec cutoff for token cache usage
//       return tokenFromCache.accessToken;
//     }
//   }

//   // we need to fetch a new access token
//   let token = null;

//   const body = `${encodeURIComponent('grant_type')}=${encodeURIComponent(
//     'client_credentials'
//   )}&${encodeURIComponent('client_id')}=${encodeURIComponent(
//     clientId
//   )}&${encodeURIComponent('client_secret')}=${encodeURIComponent(
//     clientSecret
//   )}`;

//   const apiResult = async () => {
//     if (managementTokenAuthenticationMethod === 'client_secret_basic') { // basic auth method
//       return axios.post(
//         tokenEndpoint + '?grant_type=client_credentials', {}, {
//           headers: {
//             'Content-Type': 'application/x-www-form-urlencoded',
//           },
//           auth: {
//             username: clientId,
//             password: clientSecret,
//           }
//         });
//     } else { // non-basic auth method
//       return axios.post(tokenEndpoint, body, {
//         headers: {
//           'Content-Type': 'application/x-www-form-urlencoded',
//         },
//       });
//     }
//   };

//   const tokenResponse = await apiResult();
//   token = tokenResponse.data.access_token;
//   const expiresOn = Date.now() + (tokenResponse.data.expires_in * 1000);
//   tokenCache.set(clientId, {
//     accessToken: tokenResponse.data.access_token,
//     expiresOnMillis: expiresOn
//   });

//   return token;
// };

/**
 * function to handle unauthorized response
 * @async
 * @function errorResponseHandlerInterceptor
 * @override
 * @param {object} err that are required by this function.
 * @param {object} props
 * @param {object} instance
 *
 * @return {object} response
 */
const errorResponseHandlerInterceptor = async (err, props, instance) => {
  const {tokenEndpoint, envId, clientId, clientSecret, managementTokenAuthenticationMethod} = props;
  const originalRequest = err.config;
  const code = err.response && err.response.status;

  // If the request is a retry request, simply clear the tokens.
  if (originalRequest.__isRetryRequest) {
    tokenCache.del(clientId);
    return Promise.reject(err);
  }

  if (code === 401) {
    originalRequest.__isRetryRequest = true;

    return Promise.reject(err);
  }
  return Promise.reject(err);
};

const apiResponseToSerrProps = (responseBody, responseHeaders, responseStatus) => {
    return {
    output: {
      rawResponse: responseBody,
      headers: responseHeaders,
      statusCode: responseStatus,
    },
    details: {
      rawResponse: responseBody,
      headers: responseHeaders,
      statusCode: responseStatus,
    },
    message: 'Something went wrong.',
  };
};

// doRequest does something with Axios and is expected to return the Axios response on success.
// On error this method will throw an serr per the standard. If you need to do something special with
// the serr you can send in an serrModifier that gives you a chance to mutate the standard error
// before it is thrown.
//
// Note: You'll most likely want to send a serrModifier to set the serr code correctly. You can do that
// by serr.code = 'someCode'.
const doAxiosRequest = async (doRequest, serrModifier) => {
  try {
    return await doRequest();
  } catch (err) {
    logger.debug(err);

    if (err instanceof serr) {
      throw err;
    }

    let errData = _.get(err, 'response.data', null) || {};
    let errStatusCode = _.get(err, 'response.status', null);
    let errHeaders = _.get(err, 'response.headers', null);
    const notSuccessfulRequestSerr = new serr('NotSuccessful', apiResponseToSerrProps(errData, errHeaders, errStatusCode));

    if (serrModifier) {
      serrModifier(notSuccessfulRequestSerr);
    }

    throw notSuccessfulRequestSerr;
  }
};

const pingApiErrorSerrModifier = (serr) => {
  const errStatusCode = _.get(serr, 'output.statusCode');

  if (errStatusCode === 400) {
    const errorDetailCode = _.get(serr, 'output.rawResponse.details[0].code', null);
    const errorDetailTarget = _.get(serr, 'output.rawResponse.details[0].target', null);
    const errorDetailMessage = _.get(serr, 'output.rawResponse.details[0].message', null);

    if (errorDetailCode) {
      serr.code = _.camelCase(errorDetailCode);
    } else {
      serr.code = 'pingValidationError'
    }

    if (errorDetailTarget && errorDetailMessage) {
      serr.message = `${errorDetailTarget}: ${errorDetailMessage}`
    } else if (errorDetailMessage) {
      serr.message = errorDetailMessage;
    } else {
      serr.message = 'There was a validation error';
    }
  } else if (errStatusCode === 404) {
    serr.code = 'notFound';
    serr.message = _.get(serr, 'output.rawResponse.message', 'The requested resource was not found.');
  } else if (errStatusCode === 403) {
    serr.code = 'accessFailed';
    serr.message = 'The connector does not have the Ping entitlements required to complete the action.';
  } else {
    serr.code = 'unexpectedError';
  }
}

module.exports = {
  // getAccessToken,
  configureAxios,
  apiResponseToSerrProps,
  doAxiosRequest,
  configureAxiosInstance,
  pingApiErrorSerrModifier,
};
