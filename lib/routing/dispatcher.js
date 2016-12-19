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

  const eventerObj = new EventEmitter();  // we use this for internal event firing.
  eventerObj.setMaxListeners(Infinity);
  const transports = Symbol(),
    tracking = Symbol(),
    actions = Symbol(),
    templates = Symbol(),
    templatesPending = Symbol(),
    middleware = Symbol(),
    authorizations = Symbol(),
    IntentValidator = initValidator(thorin);

  const unsavedActions = [];  //array of {action, transport}

  let transportId = 0,
    actionId = 0;

  class ThorinDispatcher extends EventEmitter {
    constructor() {
      super();
      this.setMaxListeners(Infinity);
      this[templatesPending] = {};
      this[templates] = {};   // a hash of already defined action templates.
      this[middleware] = {};  // a hash of {middlewareName: middlewareObj}
      this[authorizations] = {};  // a hash of authorizations.
      this[transports] = [];  // an array of transports that were registered
      this[actions] = {};     // a hash of {action.name, action}
      this[tracking] = {};    // a hash of actionId:transportId to keep track of who was registered where.
      this.started = false;
    }

    /* Expose our actions, but as an array rather than a hash */
    get actions() {
      let items = [];
      Object.keys(this[actions]).forEach((name) => items.push(this[actions][name].action));
      return items;
    }

    /*
     * Registers a transport. Transports are used to intercept dispatcher intents.
     * */
    registerTransport(transportObj) {
      if (!(transportObj instanceof thorin.Interface.Transport)) {
        console.error('Thorin.dispatcher.registerTransport: transport does not extend thorin.Interface.Transport');
        return this;
      }
      this[transports].push(transportObj);
      this.emit('transport', transportObj);
      transportObj._id = transportId;
      transportId++;
      // We have to let the action get populated with stuff.
      if (this.started) {
        attachActionsToTransport.call(this, transportObj);
      }
      return this;
    }

    /*
     * Registers a template action. Template actions can be used as actions
     * that can be extended by the ones using the template.
     * Note: templates are always loaded first because they are the first ones
     * that can be extended, so they need to have all their information loaded.
     * */
    addTemplate(actionObj) {
      if (typeof actionObj === 'string') {
        actionObj = new thorin.Action(actionObj);
      }
      if (!(actionObj instanceof thorin.Action)) {
        console.error('Thorin.dispatcher.addTemplate: template action is not an instance of thorin.Action');
        return this;
      }
      if (typeof this[templates][actionObj.name] !== 'undefined') {
        console.error('Thorin.dispatcher.addTemplate: template action ' + actionObj.name + " is already defined.");
        return this;
      }
      actionObj.isTemplate = true;
      // We have to wait for the action to register its templates.
      process.nextTick(checkActionTemplates.bind(this, actionObj, () => {
        this.emit('template', actionObj);
      }));
      return actionObj;
    }

    /*
     * Registers a new action and attaches it to transports.
     * ACTION OPTIONS:
     *   transport -> will attach the action only on the given transport.
     *   save -> if set to false, we will not save the action.
     * */
    addAction(actionObj, opt) {
      if (typeof opt !== 'object') opt = {};
      if (typeof actionObj === 'string') {
        actionObj = new thorin.Action(actionObj);
      }
      if (!(actionObj instanceof thorin.Action)) {
        console.error('Thorin.dispatcher.addAction: action is not an instance of thorin.Action');
        return this;
      }
      /* Transports can alter the default options of an action */
      if (typeof actionObj.getCustomOptions === 'function') {
        opt = actionObj.getCustomOptions(opt);
        delete actionObj.getCustomOptions;
      }
      if (opt.save !== false && typeof this[actions][actionObj.name] !== 'undefined') {
        console.error('Thorin.dispatcher.addAction: action ' + actionObj.name + ' already exists.');
        return actionObj;
      }
      actionObj._id = actionId;
      actionId++;
      if (opt.save !== false) {
        this[actions][actionObj.name] = {
          action: actionObj,
          opt: opt
        };
      }
      // We have to wait for the action to register its templates.
      process.nextTick(checkActionTemplates.bind(this, actionObj, () => {
        // If we're started, we have to attach the action to the transport.
        if (opt.save !== false) {
          for (let i = 0; i < this[transports].length; i++) {
            let transportObj = this[transports][i];
            if (opt.transport && opt.transport !== transportObj.name) continue;
            let itm = {};
            itm[actionObj.name] = true;
            attachActionsToTransport.call(this, transportObj, itm);
          }
        } else if (typeof opt.transport === 'string') {
          unsavedActions.push({
            action: actionObj,
            opt
          });
          for (let i = 0; i < this[transports].length; i++) {
            let transportObj = this[transports][i];
            if (transportObj.name !== opt.transport) continue;
            let k = transportObj._id + ':' + actionObj._id;
            if (typeof this[tracking][k] !== 'undefined') continue;
            transportObj.routeAction(actionObj.name);
            this[tracking][k] = true;
          }
        }

        actionObj._register();
        this.emit('action', actionObj);
      }));
      return actionObj;
    }

    /*
     * Registers a new middleware.
     * */
    addMiddleware(middlewareObj) {
      if (typeof middlewareObj === 'string') {
        middlewareObj = new thorin.Middleware(middlewareObj);
        if (typeof this[middleware][middlewareObj.name] !== 'undefined') {
          console.error('Thorin.addMiddleware: middleware already exists: ' + middlewareObj.name);
        } else {
          this[middleware][middlewareObj.name] = middlewareObj;
          this.emit('middleware', middlewareObj);
        }
        return middlewareObj;
      }
      if (!(middlewareObj instanceof thorin.Middleware)) {
        console.error('Thorin.addMiddleware: middleware is not an instance of thorin.Middleware');
        return this;
      }
      if (typeof this[middleware][middlewareObj.name] !== 'undefined') {
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
      if (typeof authObj === 'string') {
        authObj = new thorin.Authorization(authObj);
      }
      if (!(authObj instanceof thorin.Authorization)) {
        console.error('Thorin.addAuthorization: authorization is not an instance of thorin.Authorization');
        return this;
      }
      if (typeof this[authorizations][authObj.name] !== 'undefined') {
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
      return this[actions][name] && this[actions][name].action || null;
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
     * Start the dispatcher and bind all the actions that were added.
     * */
    start() {
      if (this.started) return;
      // For all our transports, we have to attach all the actions.
      this[transports].forEach((tObj) => {
        attachActionsToTransport.call(this, tObj);
      });
      this.started = true;
    }

    /*
     * Manually dispatch an action internally, having the AUTHORIZATION
     * set to LOCAL
     * Arguments:
     *   - action - the action to execute
     *   - payload - the raw payload to use.
     *   - intentObj - if set, we will clone the data from it.
     * */
    dispatch(action, payload, _intentObj) {
      if (typeof payload !== 'object' || !payload) payload = {};
      return new Promise((resolve, reject) => {
        let intentObj = new thorin.Intent(action, payload, (err, data, intentObj) => {
          if (err) return reject(data);
          resolve(data);
        });
        intentObj.transport = 'local';
        if (_intentObj) {
          intentObj.client(_intentObj.client());
        }
        intentObj._setAuthorization('LOCAL', "NONE");
        thorin.dispatcher.triggerIntent(intentObj);
      });
    }


    /*
     * This function is called by the transport layer to signal a new intent.
     * */
    triggerIntent(intentObj) {
      const actionType = intentObj.action,
        actionObj = this[actions][actionType] && this[actions][actionType].action || null;
      if (!actionObj || actionObj.isTemplate) {  // this shouldn't happen.
        return intentObj.error(thorin.error('SERVER.NOT_FOUND', 'The requested resource was not found or is currently unavailable.', 404));
      }
      function onCreated(e) {
        if (e) {
          return intentObj.error(e).send();
        }
        actionObj._runStack(intentObj, (e) => {
          if (e instanceof Error) {
            if (e.name && e.name.indexOf('Thorin') === -1) {
              e = thorin.error(e);
            }
            if (!intentObj.hasError()) {
              intentObj.error(e);
            }
          }
          if (!intentObj.completed) {
            intentObj.send();
          }
          this.emit('intent', intentObj);
        });
      }

      onCreated = onCreated.bind(this);
      try {
        intentObj.runCreate(onCreated);
      } catch (e) {
        console.error('Thorin.dispatcher.triggerIntent: intent for action ' + actionType + ' threw an error in its runCreate()');
        console.trace(e);
        return onCreated(null);
      }
    }

    /*
     * Validates the incoming intent data with the value.
     * */
    validateIntent(intentObj, validations, onDone) {
      if (typeof validations !== 'object' || validations == null) {
        console.error('Thorin.dispatcher.validateIntent: validation data must be a key-value object');
        return onDone();
      }
      let calls = [],
        inputData = intentObj.rawInput;
      Object.keys(validations).forEach((keyName) => {
        let validatorObj = validations[keyName];
        if (!(validatorObj instanceof IntentValidator)) {
          console.error('Thorin.dispatcher.validateIntent: please use dispatcher.validate() with your action input() field ' + keyName + ' in action ' + intentObj.action);
          return;
        }
        calls.push((done) => {
          validatorObj.run(keyName, inputData[keyName], (e, keyValue) => {
            if (e) {
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

  function checkActionTemplates(actionObj, done) {
    let checked = 0,
      self = this;

    function checkEmit() {
      if (checked !== actionObj.templates.length) return;
      if (actionObj.isTemplate) {
        self[templates][actionObj.name] = actionObj;
        eventerObj.emit('template.' + actionObj.name, actionObj);
      }
      done && done();
    }

    for (let i = 0; i < actionObj.templates.length; i++) {
      let tName = actionObj.templates[i];
      if (typeof this[templates][tName] === 'undefined') {
        eventerObj.on('template.' + tName, (templateObj) => {
          checked++;
          extendAction.call(this, actionObj, templateObj);
          checkEmit();
        });
      } else {
        checked++;
        extendAction.call(this, actionObj, this[templates][tName]);
      }
    }
    checkEmit();
  }

  /*
   * Attaches the .template() function to actions
   * */
  function extendAction(actionObj, parentActionObj) {
    actionObj._extendFromParent(parentActionObj);
  }

  /*
   * Attach all current actions to a transport.
   * */
  function attachActionsToTransport(transportObj, _actions) {
    let actionList = (typeof _actions === 'object' ? _actions : this[actions]);
    Object.keys(actionList).forEach((name) => {
      let actionObj = this[actions][name] && this[actions][name].action;
      let k = transportObj._id + ':' + actionObj._id;
      if (typeof this[tracking][k] !== 'undefined') return;
      transportObj.routeAction(actionObj);
      this[tracking][k] = true;
    });
    for (let i = 0; i < unsavedActions.length; i++) {
      let item = unsavedActions[i];
      if (item.opt.transport !== transportObj.name) continue;
      let k = transportObj._id + ':' + item.action._id;
      if (typeof this[tracking][k] !== 'undefined') continue;
      transportObj.routeAction(item.action);
      this[tracking][k] = true;
    }
  }

  return new ThorinDispatcher();
};
