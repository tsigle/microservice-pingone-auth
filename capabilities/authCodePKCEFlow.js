const commonApi = require('./common/commonApi');
const commonUtils = require('./common/commonUtils');
const {logger} = require('@skinternal/skconnectorsdk')

const crypto = require('crypto');
const axios = require('axios');
const url = require('url');

/**
 * authCodePKCEFlow - PingOne Authorization Code Flow with Proof Key for Code Exchange (PKCE) Connector
 *
 * Based on: https://apidocs.pingidentity.com/pingone/devguide/v1/api/#authentication-and-authorization
 *
 * Take the following configuration
 *   authorizeURL    https://auth.pingone.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
 *   clientId        ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee
 *   redirectURI     http://localhost:8000
 *
 * Take the following input schema elements
 *   username
 *   password
 *
 * Returns the following output schema elements
 *   sessionToken
 *   accessToken
 *
 */
const authCodePKCEFlow = async ({companyId,flowId,interactionId,parameters,properties,serr}) => {
  try {
    logger.info('overriding method handle_capability_authenticateUser');

    const {
      authorizeURL,
      clientId,
      redirectURI,
      username,
      password,
    } = properties;

    /**
     * In support of Proof Key for Code Exchange (PKCE) we need to get
     * a codeVerifier and codeChallenge
     */
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier)

    /**
     * Step 1 - SendCodeChallenge
     */
    var res = await authStep1SendCodeChallenge(authorizeURL, clientId, redirectURI, codeChallenge);

    const flowId = url.parse(res.headers.location,true).query["flowId"];

    /**
     * Step 2 - Authenticate User
     */
    var res = await authStep2AuthenticateUser(authorizeURL, flowId, username, password);

    var setCookie = res.headers["set-cookie"];
    console.log (setCookie)

    // Get the Session Token from the cookie
    var regex = /^ST=(.*?);/;

    var sessionToken = '';

    console.log (setCookie)
    setCookie.forEach(
      function ( cookiestr ) {
        var matched = regex.exec(cookiestr)
        if (matched != null) {
          sessionToken = matched[1];
        }
      }
    );

    /**
     * Step 3 - Get Authorization Code
     */
    var res = await getAzCode(authorizeURL, flowId, setCookie)

    const azCode = url.parse(res.headers.location,true).query["code"];

    /**
     * Step 4 - Trade in Authorization Code for Access Token
     */
    var res = await getAccessToken(authorizeURL, clientId, azCode, redirectURI, codeVerifier)


    const body = res.data;
    const accessToken = body.access_token;

    console.log('==================================== Ending ====================================');
    console.log('  ACCESS_TOKEN = ' + accessToken.substr(0,50) + "...");
    console.log(' SESSION_TOKEN = ' + sessionToken);

    /**
     * Return the accessToken and sessionToken with the output schema
     */
    return {
      output: {
        accessToken: accessToken,
        sessionToken: sessionToken
      }
    }
  } catch (err) {
    if (err instanceof serr) {
      throw err;
    }

    // If we get here something went wrong not related to the API request
    logger.debug(err);
    throw new serr("UnexpectedError", {
      message: 'Something went wrong.',
      output: {
        status: res.status
      }
    });
  }
  // catch (err) {
  //   if (err.response && err.response.status === 404) {
  //     return {
  //       output: {
  //         rawResponse: {},
  //       },
  //       eventName: 'continue',
  //     };
  //   }
  //   throw compileErr('authenticateUser', err);
  // }
}

/**
 * Generate the Code Verifier for Authorization Code Flow with PKCE
 */
function generateCodeVerifier(length=50) {
  var s = "";
  do { s += Math.random().toString(36).substr(2); } while (s.length < length);
  s = s.substr(0, length);

  return s;
}

/**
 * Generate the Code Challenge for Authorization Code Flow with PKCE
 */
function generateCodeChallenge(codeVerifier, transformation='sha256') {
  const digest = crypto.createHash(transformation).update(codeVerifier).digest('base64')
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return digest;
}

/**
 * Step 1 - Send the Code Challenge with the Authorization Request
 */
const authStep1SendCodeChallenge = async (authorizeURL, clientId, redirectURI, codeChallenge) => {

  const params = {
    response_type: 'code',
    client_id: clientId,
    scope: 'openid',
    redirect_uri: redirectURI,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  };

  return axios.get(authorizeURL + "/as/authorize",
    {
      maxRedirects: 0,
      params: params,
      validateStatus: (status) => {
      return status === 302
    }
  })
}

// const sendCodeChallengeApi = async ({ authorizeURL, clientId, redirectURI, codeChallenge }) => {
//   const instance = await commonApi.configureAxios({  });

//   const params = {
//     response_type: 'code',
//     client_id: clientId,
//     scope: 'openid',
//     redirect_uri: redirectURI,
//     code_challenge: codeChallenge,
//     code_challenge_method: 'S256'
//   };

//   // const url = `https://${commonUtils.deriveApiHostFromTokenEndpoint(tokenEndpoint)}/v1/environments/${envId}/users/${userId}/password`;
//   return instance.get(authorizeURL + "/as/authorize", {
//     maxRedirects: 0,
//     params: params,
//     validateStatus: (status) => {
//       return status === 302
//     }
//   }, {
//     headers: {
//       'Content-Type': 'application/vnd.pingidentity.password.recover+json',
//       'Authorization': `Bearer ${accessToken}`,
//     },
//   });
// };

/**
 * Step 2 - Authenticate User with Password
 */
const authStep2AuthenticateUser = async (authorizeURL, flowId, username, password) => {

  const headers = {
    "Content-Type": "application/vnd.pingidentity.usernamePassword.check+json"
  }

  const data = {
    username: username,
    password: password
  }

  console.log ("DATA = " + data);
  return axios.post(authorizeURL + "/flows/" + flowId, data, { headers: headers });
}

/**
 *
 */
const getAzCode = async (authorizeURL, flowId, cookies) => {

  const params = {
    flowId: flowId
  };

  const headers = {
    Cookie: cookies
  }

  return axios.get(authorizeURL + "/as/resume",
    {
      params: params,
      headers: headers,
      maxRedirects: 0,
      validateStatus: (status) => {
        return status === 302
      }
    }
  )
}

/**
 *
 */
const getAccessToken = async (authorizeURL, clientId, azCode, redirectURI, codeVerifier) => {

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded"
  }

  const data =  {
    client_id: clientId,
    grant_type: "authorization_code",
    code: azCode,
    redirect_uri: redirectURI,
    code_verifier: codeVerifier
  }

  const body = Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  return axios.post(authorizeURL + "/as/token", body, { headers: headers });
}

module.exports = {
  authCodePKCEFlow,
};