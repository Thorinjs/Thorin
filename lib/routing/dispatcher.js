'use strict';
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
const EventEmitter = require('events').EventEmitter,
  TValidator = require('./validator');

module.exports = function init(app) {

  const eventerObj = new EventEmitter();  // we use this for internal event firing.
  eventerObj.setMaxListeners(Infinity);
  const IntentValidator = TValidator(app);

  class ThorinDispatcher extends EventEmitter {

    #unsavedActions = []; // array of {action,transport}
    #templates = {};   // a hash of already defined action templates.
    #middleware = {};  // a hash of {middlewareName: middlewareObj}
    #authorizations = {};  // a hash of authorizations.
    #transports = [];  // an array of transports that were registered
    #actions = {};     // a hash of {action.name, action}
    #tracking = {};    // a hash of actionId:transportId to keep track of who was registered where.
    #transportId = 0;
    #actionId = 0;

    constructor() {
      super();
      this.setMaxListeners(Infinity);
      this.started = false;
    }

    /* Expose our actions, but as an array rather than a map */
    get actions() {
      let items = [];
      Object.keys(this.#actions).forEach((name) => items.push(this.#actions[name].action));
      return items;
    }

    /**
     * Registers a transport. Transports are used to intercept dispatcher intents.
     * */
    registerTransport(transportObj) {
      if (!(transportObj instanceof app.Interface.Transport)) {
        console.log('Thorin.dispatcher.registerTransport: transport does not extend thorin.Interface.Transport');
        return this;
      }
      this.#transports.push(transportObj);
      this.emit('transport', transportObj);
      transportObj._id = this.#transportId;
      this.#transportId++;
      // We have to let the action get populated with stuff.
      if (this.started) {
        this.#attachActionsToTransport(transportObj);
      }
      return this;
    }

    /**
     * Registers a template action. Template actions can be used as actions
     * that can be extended by the ones using the template.
     * Note: templates are always loaded first because they are the first ones
     * that can be extended, so they need to have all their information loaded.
     * */
    addTemplate(actionObj) {
      if (typeof actionObj === 'string') {
        actionObj = new app.Action(actionObj);
      }
      if (!(actionObj instanceof app.Action)) {
        console.log('Thorin.dispatcher.addTemplate: template action is not an instance of thorin.Action');
        return this;
      }
      if (typeof this.#templates[actionObj.name] !== 'undefined') {
        console.log('Thorin.dispatcher.addTemplate: template action ' + actionObj.name + " is already defined.");
        return this;
      }
      actionObj.isTemplate = true;
      // We have to wait for the action to register its templates.
      process.nextTick(async () => {
        await this.#checkActionTemplates(actionObj);
        this.emit('template', actionObj);
      });
      return actionObj;
    }


    /**
     * Registers a new action and attaches it to transports.
     * ACTION OPTIONS:
     *   transport -> will attach the action only on the given transport.
     *   save -> if set to false, we will not save the action.
     * */
    addAction(actionObj, opt) {
      if (typeof opt !== 'object') opt = {};
      if (typeof actionObj === 'string') {
        actionObj = new app.Action(actionObj);
      }
      if (!(actionObj instanceof app.Action) && typeof actionObj.use !== 'function') {
        console.log('Thorin.dispatcher.addAction: action is not an instance of thorin.Action');
        return this;
      }
      /* Transports can alter the default options of an action */
      if (typeof actionObj.getCustomOptions === 'function') {
        opt = actionObj.getCustomOptions(opt);
        delete actionObj.getCustomOptions;
      }
      if (opt.save !== false && typeof this.#actions[actionObj.name] !== 'undefined') {
        console.log('Thorin.dispatcher.addAction: action ' + actionObj.name + ' already exists.');
        return actionObj;
      }
      actionObj._id = this.#actionId;
      this.#actionId++;
      if (opt.save !== false) {
        this.#actions[actionObj.name] = {
          action: actionObj,
          opt: opt
        };
      }
      // We have to wait for the action to register its templates.
      process.nextTick(async () => {
        await this.#checkActionTemplates(actionObj);
        // If we're started, we have to attach the action to the transport.
        if (opt.save !== false) {
          for (let i = 0; i < this.#transports.length; i++) {
            let transportObj = this.#transports[i];
            if (opt.transport && opt.transport !== transportObj.name) continue;
            let itm = {};
            itm[actionObj.name] = true;
            this.#attachActionsToTransport(transportObj, itm);
          }
        } else if (typeof opt.transport === 'string') {
          this.#unsavedActions.push({
            action: actionObj,
            opt
          });
          for (let i = 0; i < this.#transports.length; i++) {
            let transportObj = this.#transports[i];
            if (transportObj.name !== opt.transport) continue;
            let k = transportObj._id + ':' + actionObj._id;
            if (typeof this.#tracking[k] !== 'undefined') continue;
            transportObj.routeAction(actionObj.name);
            this.#tracking[k] = true;
          }
        }
        actionObj._register();
        this.emit('action', actionObj);
      });
      return actionObj;
    }

    /**
     * Registers a new middleware.
     * */
    addMiddleware(middlewareObj) {
      if (typeof middlewareObj === 'string') {
        middlewareObj = new app.Middleware(middlewareObj);
        if (typeof this.#middleware[middlewareObj.name] !== 'undefined') {
          console.log('Thorin.addMiddleware: middleware already exists: ' + middlewareObj.name);
        } else {
          this.#middleware[middlewareObj.name] = middlewareObj;
          this.emit('middleware', middlewareObj);
        }
        return middlewareObj;
      }
      if (!(middlewareObj instanceof app.Middleware)) {
        console.log('Thorin.addMiddleware: middleware is not an instance of thorin.Middleware');
        return this;
      }
      if (typeof this.#middleware[middlewareObj.name] !== 'undefined') {
        console.log('Thorin.addMiddleware: middleware already exists: ' + middlewareObj.name);
        return this;
      }
      this.#middleware[middlewareObj.name] = middlewareObj;
      this.emit('middleware', middlewareObj);
      return this;
    }

    /**
     * Registers a new authorization object to the dispatcher.
     * Authorizations have their sole purpose to verify if the
     * incoming intent has access to the requested action.
     * */
    addAuthorization(authObj) {
      if (typeof authObj === 'string') {
        authObj = new app.Authorization(authObj);
      }
      if (!(authObj instanceof app.Authorization)) {
        console.log('Thorin.addAuthorization: authorization is not an instance of thorin.Authorization');
        return this;
      }
      if (typeof this.#authorizations[authObj.name] !== 'undefined') {
        console.log('Thorin.addAuthorization: authorization already exists: ' + authObj.name);
      } else {
        this.#authorizations[authObj.name] = authObj;
        this.emit('authorization', authObj);
      }
      return authObj;
    }

    /* Returns the requested middleware object. */
    getMiddleware(name) {
      return this.#middleware[name] || null;
    }

    /*
     * Returns the given authorization object
     * */
    getAuthorization(name) {
      return this.#authorizations[name] || null;
    }

    /*
     * Returns the given action
     * */
    getAction(name) {
      if (!this.#actions[name]) return null;
      return this.#actions[name].action;
    }

    /**
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

    /**
     * Creates a new custom validator, to be used outside actions, in a similar fashion.
     * Given an object{} with keys/validators, it will create, cache and return a validation
     * function to be used to validate incoming data.
     *  @Arguments
     *    - data{} - the data object that defines the fields that need to be validated.
     *    - opt.clean=true - if set to true, clean fields that are not in the data.
     * */
    createValidator(data = {}) {
      let fields = Object.keys(data);
      return async function validate(input, opt = {}) {
        let result = opt.clean === false ? input : {};
        for (let i = 0, len = fields.length; i < len; i++) {
          let field = fields[i],
            validatorObj = data[field];
          if (!validatorObj) {
            console.warn(`Field [${field}] does not contain a validator`);
          }
          result[field] = await validatorObj.run(field, input[field]);
        }
        return result;
      }
    }


    /*------------ INTENT SPECIFIC FUNCTIONS, called by transports or actions. ---------------*/

    /*
     * Start the dispatcher and bind all the actions that were added.
     * */
    start() {
      if (this.started) return;
      // For all our transports, we have to attach all the actions.
      this.#transports.forEach((tObj) => {
        this.#attachActionsToTransport(tObj);
      });
      this.started = true;
    }

    /**
     * Manually dispatch an action internally, having the AUTHORIZATION
     * set to LOCAL
     * Arguments:
     *   - action - the action to execute
     *   - payload - the raw payload to use.
     *   - intentObj - if set, we will clone the data from it.
     * */
    dispatch(action, payload, _intentObj, _preserveAuth) {
      if (typeof payload !== 'object' || !payload) payload = {};
      return new Promise((resolve, reject) => {
        let intentObj = new app.Intent(action, payload, (wasErr, data) => {
          if (wasErr) return reject(data);
          resolve(data);
        });
        intentObj.transport = 'local';
        if (_intentObj) {
          intentObj.client(_intentObj.client());
          let _data = _intentObj.data();
          if (typeof _data === 'object' && _data) {
            Object.keys(_data).forEach((d) => {
              intentObj.data(d, _data[d]);
            });
          }
        }
        if (_intentObj && _preserveAuth === true && _intentObj.authorizationSource) {
          intentObj._setAuthorization(_intentObj.authorizationSource, _intentObj.authorization);
        } else {
          intentObj._setAuthorization('LOCAL', 'NONE');
        }
        this.triggerIntent(intentObj);
      });
    }

    /**
     * This function is called by the transport layer to signal a new intent.
     * */
    triggerIntent(intentObj) {
      const actionType = intentObj.action,
        actionObj = this.#actions[actionType] && this.#actions[actionType].action || null;
      if (!actionObj || actionObj.isTemplate) {  // this shouldn't happen.
        return intentObj.error(app.error('SERVER.NOT_FOUND', 'The requested resource was not found or is currently unavailable.', 404));
      }

      try {
        intentObj.runCreate(async (e) => {
          if (e) {
            return intentObj.error(e).send();
          }
          let err;
          try {
            await actionObj._runStack(intentObj);
          } catch (e) {
            err = e;
          }
          if (err) {
            if (err.name && err.name.indexOf('Thorin') === -1) {
              err = app.error(err);
            }
            if (!intentObj.hasError()) {
              intentObj.error(err);
            }
          }
          if (!intentObj.completed) {
            intentObj.send();
          }
          this.emit('intent', intentObj);
        });
      } catch (e) {
        console.log('Thorin.dispatcher.triggerIntent: intent for action ' + actionType + ' threw an error in its runCreate()');
        console.trace(e);
      }
    }

    /**
     * Validates the incoming intent data with the value.
     * */
    async validateIntent(intentObj, validations, onDone) {
      if (typeof validations !== 'object' || validations == null) {
        console.log('Thorin.dispatcher.validateIntent: validation data must be a key-value object');
        if (onDone) return onDone();
        return;
      }
      let inputData = intentObj.rawInput,
        validationKeys = Object.keys(validations);
      try {
        for (let i = 0, len = validationKeys.length; i < len; i++) {
          let keyName = validationKeys[i];
          let validatorObj = validations[keyName];
          if (!(validatorObj instanceof IntentValidator)) {
            console.log('Thorin.dispatcher.validateIntent: please use dispatcher.validate() with your action input() field ' + keyName + ' in action ' + intentObj.action);
            continue;
          }
          let keyValue = await validatorObj.run(keyName, inputData[keyName]);
          intentObj.input(keyName, keyValue);
        }
      } catch (e) {
        if (onDone) return onDone(e);
        throw e;
      }
    }

    /**
     * Validates the incoming intent's FILTER data.
     * */
    async validateIntentFilter(intentObj, validations, onDone) {
      if (typeof validations !== 'object' || validations == null) {
        console.log('Thorin.dispatcher.validateIntentFilter: validation data must be a key-value object');
        if (onDone) return onDone();
        return;
      }
      let inputData = intentObj.rawFilter,
        validationKeys = Object.keys(validations);
      try {
        for (let i = 0, len = validationKeys.length; i < len; i++) {
          let keyName = validationKeys[i];
          let validatorObj = validations[keyName];
          if (!(validatorObj instanceof IntentValidator)) {
            console.log('Thorin.dispatcher.validateIntentFilter: please use dispatcher.validate() with your action filter() field ' + keyName + ' in action ' + intentObj.action);
            continue;
          }
          let keyValue = await validatorObj.run(keyName, inputData[keyName]);
          intentObj.filter(keyName, keyValue);
        }
      } catch (e) {
        if (onDone) return onDone(e);
        throw e;
      }
    }


    #attachActionsToTransport = (transportObj, _actions) => {
      let actionList = (typeof _actions === 'object' ? _actions : this.#actions);
      Object.keys(actionList).forEach((name) => {
        let actionObj = this.#actions[name] && this.#actions[name].action;
        if (actionObj) {
          let opt = this.#actions[name].opt;
          if (opt.transport && opt.transport !== transportObj.name) return;
        }
        let k = transportObj._id + ':' + actionObj._id;
        if (typeof this.#tracking[k] !== 'undefined') return;
        transportObj.routeAction(actionObj);
        this.#tracking[k] = true;
      });
      for (let i = 0; i < this.#unsavedActions.length; i++) {
        let item = this.#unsavedActions[i];
        if (item.opt.transport && item.opt.transport !== transportObj.name) continue;
        let k = transportObj._id + ':' + item.action._id;
        if (typeof this.#tracking[k] !== 'undefined') continue;
        transportObj.routeAction(item.action);
        this.#tracking[k] = true;
      }
    }

    #checkActionTemplates = async (actionObj) => {
      return new Promise((done) => {
        let checked = 0,
          templates = this.#templates,
          isDone = false;

        function checkEmit() {
          if (checked !== actionObj.templates.length) return;
          if (actionObj.isTemplate) {
            templates[actionObj.name] = actionObj;
            eventerObj.emit('template.' + actionObj.name, actionObj);
          }
          if (isDone) return;
          isDone = true;
          done();
        }

        for (let i = 0; i < actionObj.templates.length; i++) {
          let tName = actionObj.templates[i];
          if (typeof this.#templates[tName] === 'undefined') {
            eventerObj.on('template.' + tName, (templateObj) => {
              checked++;
              this.#extendAction(actionObj, templateObj);
              checkEmit();
            });
          } else {
            checked++;
            this.#extendAction(actionObj, this.#templates[tName]);
          }
        }
        checkEmit();
      });
    }

    /**
     * Attaches the .template() function to actions
     * */
    #extendAction = (actionObj, parentActionObj) => {
      actionObj._extendFromParent(parentActionObj);
    }

  }

  return ThorinDispatcher;
}

