'use strict';
const EventEmitter = require('events').EventEmitter;
/**
 * Created by Adrian on 19-Mar-16.
 */

class ITransport extends EventEmitter {

  constructor() {
    super();
    this.setMaxListeners(Infinity);
    this.type = 2;  // by default, we have receivers.
    this.name = 'transport';
  }

  static publicName() { return "transport"; }

  /* Sets the name's instance */
  setName(name) {
    this.name = name;
  }

  /* This is used for bi-directional/sender transports, and must be overridden,
   * with the own logic of sending events from the server to clients. */
  sendIntent(intentObj) {}

  /*
  * This is called when we want to temporary disable an action from being processed.
  * */
  disableAction(actionName) {}

  /*
   * This is called when we want to re-enable a disabled action
   * */
  enableAction(actionName) {}

  /*
  * This is called whenever an intent is registered in the app. The transport
  * must then register its handler.
  * Example:
  *   we have a HTTP transport that will bind to a port and listen to GET/POST requests.
  *   handleIntent(iObj) will be called. the iObj contains information about the path and input data
  *       - the server will have to attach an onSuccess and onError handlers to it,
  *       - and redirect outgoing data through the http response.
  *   - once a request matches an intent and has its incoming data processed,
  *   the transport will then emit an "intent" event, with the incoming data,
  *   authorization data and client information attached. The dispatcher
  *   will handle the rest.
  * */
  routeAction(actionObj) {}
}
/*
* Transports can also allow bi-directional communication (server->client), therefore, the types of transport are:
*   1. BI_DIRECTIONAL (listens for intents and implements a sendIntent() function)
*   2. RECEIVER (only listens for intents)
*   3. SENDER (only sends intents)
* */
ITransport.TYPE = {
  BI_DIRECTIONAL: 1,
  RECEIVER: 2,
  SENDER: 3
};

module.exports = ITransport;