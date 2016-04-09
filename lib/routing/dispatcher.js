'use strict';
const EventEmitter = require('events').EventEmitter,
  async = require('async'),
  initValidator = require('./validator');
/**
 * Created by Adrian on 03-Apr-16.
 * The Thorin dispatcher can be viewed as a mini router. It will
 * handle intent creation, sending and receiving.
 * It is similar to the dispatcher in flux.
 * EVENTS EMITTED:
 *  middleware -> when a middleware was added
 *  action -> when an action was added
 *  transport -> when a transport was added
 *
 *  intent -> when an intent was completed.
 */

module.exports = function init(thorin) {

  const transports = Symbol(),
    tracking = Symbol(),
    actions = Symbol(),
    templates = Symbol(),
    templatesPending = Symbol(),
    middleware = Symbol(),
    authorizations = Symbol(),
    IntentValidator = initValidator(thorin);

  let transportId = 0,
    actionId = 0;

  class ThorinDispatcher extends EventEmitter {
    constructor() {
      super();
      this[templatesPending] = {};
      this[templates] = {};   // a hash of already defined action templates.
      this[middleware] = {};  // a hash of {middlewareName: middlewareObj}
      this[authorizations] = {};  // a hash of authorizations.
      this[transports] = [];  // an array of transports that were registered
      this[actions] = {};     // a hash of {action.name, action}
      this[tracking] = {};    // a hash of actionId:transportId to keep track of who was registered where.
    }

    /*
    * Registers a transport. Transports are used to intercept dispatcher intents.
    * */
    registerTransport(transportObj) {
      if(!(transportObj instanceof thorin.Interface.Transport)) {
        console.error('Thorin.dispatcher.registerTransport: transport does not extend thorin.Interface.Transport');
        return this;
      }
      this[transports].push(transportObj);
      this.emit('transport', transportObj);
      transportObj._id = transportId;
      transportId++;
      // We have to let the action get populated with stuff.
      setTimeout(() => {
        Object.keys(this[actions]).forEach((name) => {
          let actionObj = this[actions][name];
          let k = transportObj._id + ':' + actionObj._id;
          if(typeof this[tracking][k] !== 'undefined') return;
          transportObj.routeAction(actionObj);
          this[tracking][k] = true;
        });
      }, 10);
      return this;
    }

    /*
    * Registers a template action. Template actions can be used as actions
    * that can be extended by the ones using the template.
    * */
    addTemplate(actionObj) {
      if(typeof actionObj === 'string') {
        actionObj = new thorin.Action(actionObj);
      }
      if(!(actionObj instanceof thorin.Action)) {
        console.error('Thorin.dispatcher.addTemplate: template action is not an instance of thorin.Action');
        return this;
      }
      if(typeof this[templates][actionObj.name] !== 'undefined') {
        console.error('Thorin.dispatcher.addTemplate: template action ' + actionObj.name + " is already defined.");
        return this;
      }
      actionObj.isTemplate = true;
      this[templates][actionObj.name] = actionObj;
      if(typeof this[templatesPending][actionObj.name] !== 'undefined') {
        process.nextTick(() => {
          for(let i=0; i < this[templatesPending][actionObj.name].length; i++) {
            let sourceAction = this[templatesPending][actionObj.name][i];
            sourceAction._extendFromTemplate(actionObj);
          }
        });
      }
      return actionObj;
    }

    /*
    * Registers a new action and attaches it to transports.
    * ACTION OPTIONS:
    *   transport -> will attach the action only on the given transport.
    * */
    addAction(actionObj, opt) {
      if(typeof opt !== 'object') opt = {};
      if(typeof actionObj === 'string') {
        actionObj = new thorin.Action(actionObj);
      }
      if(!(actionObj instanceof thorin.Action)) {
        console.error('Thorin.dispatcher.addAction: action is not an instance of thorin.Action');
        return this;
      }
      if(typeof this[actions][actionObj.name] !== 'undefined') {
        console.error('Thorin.dispatcher.addAction: action ' + actionObj.name + ' already exists.');
        return actionObj;
      }
      actionObj._id = actionId;
      actionId++;
      this[actions][actionObj.name] = actionObj;
      this.emit('action', actionObj);
      process.nextTick(() => {
        for(let i=0; i < this[transports].length; i++) {
          let transportObj = this[transports][i],
            k = transportObj._id + ':' + actionObj._id;
          if(opt.transport && opt.transport !== transportObj.name) continue;
          if(typeof this[tracking][k] !== 'undefined') continue;
          transportObj.routeAction(actionObj);
          this[tracking][k] = true;
        }
      });
      /* Override the template function of an action */
      actionObj.template = function SetTemplate(name) {
        if(typeof this[templates][name] !== 'undefined') {
          process.nextTick(() => {
            actionObj._extendFromTemplate(this[templates][name]);
          });
        } else {
          if(!this[templatesPending][name]) {
            this[templatesPending][name] = [];
          }
          this[templatesPending][name].push(actionObj);
        }
        return actionObj;
      }.bind(this);
      return actionObj;
    }

    /*
    * Registers a new middleware.
    * */
    addMiddleware(middlewareObj) {
      if(typeof middlewareObj === 'string') {
        middlewareObj = new thorin.Middleware(middlewareObj);
        if(typeof this[middleware][middlewareObj.name] !== 'undefined') {
          console.error('Thorin.addMiddleware: middleware already exists: ' + middlewareObj.name);
        } else {
          this[middleware][middlewareObj.name] = middlewareObj;
          this.emit('middleware', middlewareObj);
        }
        return middlewareObj;
      }
      if(!(middlewareObj instanceof thorin.Middleware)) {
        console.error('Thorin.addMiddleware: middleware is not an instance of thorin.Middleware');
        return this;
      }
      if(typeof this[middleware][middlewareObj.name] !== 'undefined') {
        console.error('Thorin.addMiddleware: middleware already exists: ' + middlewareObj.name);
        return this;
      }
      this[middleware][middlewareObj.name] = middlewareObj;
      this.emit('middleware', middlewareObj);
      return this;
    }

    /*
    * Registers a new authorization object to the dispatcher.
    * Authorizations have their sole purpose to verify if the
    * incoming intent has access to the requested action.
    * */
    addAuthorization(authObj) {
      if(typeof authObj === 'string') {
        authObj = new thorin.Authorization(authObj);
      }
      if(!(authObj instanceof thorin.Authorization)) {
        console.error('Thorin.addAuthorization: authorization is not an instance of thorin.Authorization');
        return this;
      }
      if(typeof this[authorizations][authObj.name] !== 'undefined') {
        console.error('Thorin.addAuthorization: authorization already exists: ' + authObj.name);
      } else {
        this[authorizations][authObj.name] = authObj;
        this.emit('authorization', authObj);
      }
      return authObj;
    }

    /* Returns the requested middleware object. */
    getMiddleware(name) {
      return this[middleware][name] || null;
    }

    /*
    * Returns the given authorization object
    * */
    getAuthorization(name) {
      return this[authorizations][name] || null;
    }

    /*
    * Returns the given action
    * */
    getAction(name) {
      return this[actions][name] || null;
    }

    /*
    * This will perform sanitization on the given input of an intent.
    * The sanitize() function returns an object with:
    *   - default(value:any) -> any default value that can be applied, if the validation fails
    *   - error (error) -> specific error when the validation fails.
    *  NOTE:
    *   it is default() OR error(), not both.
    * */
    validate(sanitizerType, opt) {
      return new IntentValidator(sanitizerType, opt);
    }

    /*------------ INTENT SPECIFIC FUNCTIONS, called by transports or actions. ---------------*/

    /*
    * This function is called by the transport layer to signal a new intent.
    * */
    triggerIntent(intentObj) {
      const actionType = intentObj.action,
        actionObj = this[actions][actionType];
      if(!actionObj || actionObj.isTemplate) {  // this shouldn't happen.
        return intentObj.error(thorin.error('SERVER.NOT_FOUND', 'The requested resource was not found or is currently unavailable.', 404));
      }
      function onCreated(e) {
        if(e) {
          return intentObj.error(e).send();
        }
        actionObj._runStack(intentObj, (e) => {
          if(e instanceof Error) {
            if(e.name && e.name.indexOf('Thorin') === -1) {
              e = thorin.error(e);
            }
            if(!intentObj.hasError()) {
              intentObj.error(e);
            }
          }
          if(!intentObj.completed) {
            intentObj.send();
          }
          this.emit('intent', intentObj);
          process.nextTick(() => {
            intentObj.destroy();
          });
        });
      }
      onCreated = onCreated.bind(this);
      try {
        intentObj.runCreate(onCreated);
      } catch(e) {
        console.error('Thorin.dispatcher.triggerIntent: intent for action ' + actionType + ' threw an error in its runCreate()');
        console.trace(e);
        return onCreated(null);
      }


    }

    /*
    * Validates the incoming intent data with the value.
    * */
    validateIntent(intentObj, validations, onDone) {
      if(typeof validations !== 'object' || validations == null) {
        console.error('Thorin.dispatcher.validateIntent: validation data must be a key-value object');
        return onDone();
      }
      let calls = [],
        inputData = intentObj.rawInput;
      Object.keys(validations).forEach((keyName) => {
        let validatorObj = validations[keyName];
        if(!(validatorObj instanceof IntentValidator)) {
          console.error('Thorin.dispatcher.validateIntent: please use dispatcher.validate() with your action input() field ' + keyName +' in action ' + intentObj.action);
          return;
        }
        calls.push((done) => {
          validatorObj.run(keyName, inputData[keyName], (e, keyValue) => {
            if(e) {
              e.data = {
                field: keyName
              };
              return done(e);
            }
            intentObj.input(keyName, keyValue);
            done();
          });
        });
      });
      async.series(calls, onDone);
    }

  }

  return new ThorinDispatcher();
};