/**
 * PingOne Auth
 */
const sdk = require('@skinternal/skconnectorsdk')
const {logger} = require('@skinternal/skconnectorsdk')
const {
  authCodePKCEFlow,
} = require('./capabilities');

const redisList = 'pingOneAuthConnector';

const registerCapabilities = () => {
  sdk.methods.handle_capability_authCodePKCEFlow = authCodePKCEFlow;

}
/**
 * Initialize is the main function to start this service. It initializes sdk with name of the connector.
 */
const initialize = async () =>{
  try {
    registerCapabilities();
    const response = await sdk.initalize(redisList)
    console.log(response)
    logger.info('Started microservice-pingone-auth');
  } catch(err){
    console.log(err);
    logger.error('Error starting microservice-pingone-auth');
  }
}

initialize();
