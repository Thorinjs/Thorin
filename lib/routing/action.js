'use strict';
const commonUtil = require('../util/common');
const TMiddleware = require('./middleware');
/**
 * The Thorin Action will register prerequisits for an intent to be processed.
 * It can be viewed as the classical "Route", but with a fancy name.
 */
const HANDLER_TYPE = {
  AUTHORIZE: 'authorize',
  VALIDATE_FILTER: 'filter',
  MIDDLEWARE: 'middleware',
  PROXY: 'proxy',
  ...TMiddleware.HANDLER_TYPE
};
module.exports = function init(app) {

  class ThorinAction {

    #onRegisteredFns; // an array of functions that will be called when the action was registered in the dispatcher.
    #isTemplate = false;
    #hasDebug = true;
    #aliases = [];
    #stack = [];
    #templates = [];   // placed at first template() call
    #ends = [];     // an array of end fns to call when the intent finalizes.
    #events = {
      before: {},    // a hash of {handlerType: [fns]}
      after: {}       // same as before
    };

    constructor(name) {
      this.root = ""; // the root that is applied for aliases.
      this.name = name;
    }

    /*
    * Other plugins/modules can implement their own
    * getCustomOptions()
    * */


    get hasDebug() {
      return this.#hasDebug;
    }

    set hasDebug(v) {
      this.#hasDebug = v;
    }

    get isTemplate() {
      return this.#isTemplate;
    }

    set isTemplate(v) {
      this.#isTemplate = true;
    }

    get stack() {
      return this.#stack;
    }

    set stack(v) {
      this.#stack = v;
    }

    get aliases() {
      return this.#aliases;
    }

    set aliases(v) {
      if (v instanceof Array) {
        this.#aliases = v;
      }
    }

    get templates() {
      return this.#templates;
    }

    set templates(v) {
      this.#templates = v;
    }

    get ends() {
      return this.#ends;
    }

    set ends(v) {
      this.#ends = v;
    }

    get events() {
      return this.#events;
    }

    /** Adds an event handler, either a before or an after */
    #addHandler = (handlerType, type, a, b) => {
      if (typeof type !== 'string') {
        console.log(`Thorin.action: ${handlerType} type ${type} of action ${this.name} is not a string`);
        return this;
      }
      let item;
      if (type === HANDLER_TYPE.MIDDLEWARE || type === HANDLER_TYPE.AUTHORIZE) {  // we have type, name, fn
        if (typeof a !== 'string' || typeof b !== 'function') {
          console.log('Thorin.action: ' + handlerType + ' middleware "' + a + '" must have syntax: ' + handlerType + '(type, middlewareName, fn) in action ' + this.name);
          return this;
        }
        item = {
          name: a,
          fn: b
        };
      } else {
        item = {};
        if (typeof a === 'function') {
          item.fn = a;
        } else if (typeof a === 'string' && typeof b === 'function') {
          item.name = a;
          item.fn = b;
        }
        if (typeof item.fn !== 'function') {
          console.log('Thorin.action: ' + handlerType + ' "' + type + '" must have syntax: ' + handlerType + '(type, fn) or (type, targetName, fn) in action ' + this.name);
          return this;
        }
      }
      if (!this.#events[handlerType][type]) {
        this.#events[handlerType][type] = [];
      }
      this.#events[handlerType][type].push(item);
      return this;
    }

    /**
     * This will run the given event handler, if any fn was registered for it.
     * */
    _runHandler(handlerType, eventName, intentObj, subName, _arg1, _arg2) {
      if (typeof this.#events[handlerType][eventName] === 'undefined') return;
      for (let i = 0; i < this.#events[handlerType][eventName].length; i++) {
        let item = this.#events[handlerType][eventName][i];
        if (typeof subName === 'string') {
          if (typeof item.name === 'string' && item.name !== subName) continue;
        }
        try {
          item.fn(intentObj, _arg1, _arg2);
        } catch (e) {
          console.log('Thorin.action: ' + handlerType + '() called on ' + eventName + (subName ? '[' + subName + ']' : '') + ' caught an error in action ' + this.name);
          console.log(e);
        }
      }
    }

    /**
     * Disables any kind of debugging for this action
     * */
    debug(v) {
      this.#hasDebug = (typeof v === 'boolean' ? v : false);
      return this;
    }

    /**
     * Sets an alias to this action.
     * An alias will be typically used by the HTTP transport to
     * map url requests to this action.
     * NOTE:
     * template actions that call the alias() will set the root alias name
     * of the template action. Any other actions that extend this template
     * will have their aliases prepended by this.
     * */
    alias(verb, name) {
      if (this.#isTemplate === true) {
        if (typeof verb !== 'string') {
          console.log('Thorin.alias: root alias of template must be a string for template ' + this.name);
          return this;
        }
        this.root = verb;
      } else {
        if (typeof verb === 'string' && typeof name === 'undefined') { // we have only name-based aliases.
          this.#aliases.push({
            name: verb
          });
          return this;
        }
        if (typeof verb !== 'string') {
          console.log('Thorin.alias: verb and alias must be a string for action ' + this.name);
          return this;
        }
        this.#aliases.push({
          verb,
          name
        });
      }
      return this;
    }

    /**
     * Registers an authorization handler.
     * Authorization handlers are registered through dispatcher.addAuthorization
     * and are named ones. The action authorize() function works only with strings.
     * Usage:
     *   actionObj.authorize('some.authorization', {options})
     *    - OPTIONAL: if a conditionFn is specified, the authorization will be executed only when the result of the conditional function is true.
     * */
    authorize(authName, opt = {}, conditionFn) {
      if (typeof authName !== 'string') {
        console.log(`thorin.action.authorize: ${authName} of action ${this.name} is not a string`);
        return this;
      }
      if (authName instanceof Array) {
        for (let i = 0; i < authName.length; i++) {
          if (typeof authName[i] !== 'string') continue;
          let item = {
            type: HANDLER_TYPE.AUTHORIZE,
            name: authName[i],
            opt
          };
          if (typeof conditionFn === 'function') item.condition = conditionFn;
          this.#stack.push(item);
        }
        return this;
      }
      let item = {
        type: HANDLER_TYPE.AUTHORIZE,
        name: authName,
        opt
      };
      if (typeof conditionFn === 'function') item.condition = conditionFn;
      this.#stack.push(item);
      return this;
    }

    /**
     * Adds a new input data validator.
     * Usage:
     *     actionObj.input({
     *       myKey: dispatcher.sanitize("STRING")
     *     })
     * */
    input(obj) {
      if (typeof obj !== 'object' || !obj) {
        console.log('thorin.action: validator must be a key-value object for action ' + this.name);
        return this;
      }
      let item = {
        type: HANDLER_TYPE.VALIDATE,
        value: obj
      };
      this.#stack.push(item);
      return this;
    }

    /**
     * Since some requests (specifically UPDATE requests) can rely on two different input payloads,
     * one for filtering, the other for raw data, the input can now also have filter() data.
     * By default, the incoming data will be:
     * {
     *   "type": "my.action",
     *   "filter": {
     *     "id": "1"
     *   },
     *   "payload": {
     *     "name": "John"
     *   }
     * }
     * // use the filter() in WHERE statements when querying for instances
     * // use input() for actual data to work with.
     * // NOTE: validation works exactly like in the input() part.
     * */
    filter(obj) {
      if (typeof obj !== 'object' || !obj) {
        console.log('thorin.action: validator must be a key-value object for action ' + this.name);
        return this;
      }
      let item = {
        type: HANDLER_TYPE.VALIDATE_FILTER,
        value: obj
      };
      this.#stack.push(item);
      return this;
    }

    /**
     * Performs internal proxying from one action to another.
     * OPTIONS:
     *        - action=string -> the target namespace
     *        - payload=object -> the base payload that will override the intent input.
     *        - rawInput=false -> should we use intentObj.input() or intentObj.rawInput
     *        - exclude: [],  -> array of keys to exclude from input
     * */
    proxy(proxyServiceName, opt) {
      if (typeof proxyServiceName !== 'string' || !proxyServiceName) {
        console.log(`thorin.action.proxy() of action ${this.name} must have a valid string for the proxy service name`);
        return this;
      }
      let tmp = proxyServiceName.split('#'),
        proxyName = tmp[0],
        serviceName = tmp[1];
      if (proxyName !== 'self') {
        if (typeof super.proxy === 'function') {
          return super.proxy.apply(this, arguments);
        }
        console.log(`thorin.action.proxy() must contain the following pattern: self#{actionName} [current: ${proxyServiceName}]`);
        return this;
      }
      opt = {
        action: serviceName,
        rawInput: true,
        exclude: [],
        payload: {},
        ...opt
      };
      this.#stack.push({
        name: proxyServiceName,
        type: HANDLER_TYPE.PROXY,
        opt
      });
      return this;
    }

    /**
     * This handler is the one that should be particular to the action.
     * An action can use()
     *   - an array of middleware names (with no options passed to them)
     *   - a middleware name and pass the middleware options to it
     *   - a callback function that will be used within the action handler.
     *   - OPTIONAL: if a conditionFn is specified, the middleware will be executed only when the result of the conditional function is true.
     *   Usage:
     *     actionObj.use('my.middleware', {withMy: 'options'})
     *     actionObj.use(['my:middleware', 'some.other.middleware']
     *     actionObj.use((intentObj) => {});
     * */
    use(fn, a, conditionFn) {
      if (typeof fn === 'function') {  // use an fn()
        let item = {
          type: HANDLER_TYPE.USE,
          fn: fn
        };
        if (typeof a === 'object' && a) {
          item.opt = a;
        }
        if (typeof conditionFn === 'function') item.condition = conditionFn;
        this.#stack.push(item);
        return this;
      }
      if (fn instanceof Array) { // array of middleware names.
        for (let i = 0; i < fn.length; i++) {
          if (typeof fn[i] === 'string') {
            let item = {
              type: HANDLER_TYPE.MIDDLEWARE,
              name: fn[i],
              opt: {}
            };
            if (typeof conditionFn === 'function') item.condition = conditionFn;
            this.#stack.push(item);
          }
        }
        return this;
      }
      if (typeof fn === 'string') {  // a middleware name with options?
        let item = {
          type: HANDLER_TYPE.MIDDLEWARE,
          name: fn,
          opt: (typeof a === 'undefined' ? {} : a)
        };
        if (typeof conditionFn === 'function') item.condition = conditionFn;
        this.#stack.push(item);
        return this;
      }
      console.warn('thorin.action: invalid usage of use() for action ' + this.name);
      return this;
    }

    /**
     * Registers an end callback. Similar to the ones in middleware,
     * an end callback will be called whenever the intent will complete.
     * */
    end(fn) {
      if (typeof fn !== 'function') {
        console.log('thorin.action: invalid function for end() for action ' + this.name);
        return this;
      }
      this.#ends.push(fn);
      return this;
    }

    /**
     * This function is called when the dispatcher has registered the action, AFTER
     * it was extended from its parent template (if any).
     * */
    onRegister(fn) {
      if (!this.#onRegisteredFns) this.#onRegisteredFns = [];
      this.#onRegisteredFns.push(fn);
      return this;
    }

    /**
     * This is called by the dispatcher when it was registered.
     * */
    _register() {
      if (!this.#onRegisteredFns) return;
      for (let i = 0; i < this.#onRegisteredFns.length; i++) {
        try {
          this.#onRegisteredFns[i].call(this, this);
        } catch (e) {
          console.log('Thorin action ' + this.name + ' caught an error in onRegister()', e);
        }
      }
      this.#onRegisteredFns = undefined;
    }

    /**
     * Registers a "BEFORE" handler.
     * Before handlers are synchronous functions that are called before specific
     * points in the execution stack. Typically, we have a before(HANDLER_TYPE, fn)
     * Usage:
     *   actionObj.before('validate', (intentObj) => {})
     *   actionObj.before('middleware', 'middlewareName', () => {})
     * */
    before(type, a, b) {
      return this.#addHandler('before', type, a, b);
    }

    after(type, a, b) {
      return this.#addHandler('after', type, a, b);
    }

    /**
     * Plugins or other components can actually insert functionality into thorin.Action.
     * All they have to do is override the "_runCustomType" function of the action
     * and whenever a custom action that is not in the default handler types will be registered,
     * it will be processed.
     *
     * */
    async _runCustomType(intentObj, handler, done) {
      if (handler.type !== HANDLER_TYPE.PROXY) {
        if (done) return done();
        return;
      }
      let opt = handler.opt,
        action = opt.action,
        intentInput = {};
      if (opt.rawInput === true || typeof opt.fields === 'object' && opt.fields) {
        intentInput = intentObj.rawInput;
      } else {
        intentInput = intentObj.input();
      }
      let payload = opt.payload ? JSON.parse(JSON.stringify(opt.payload)) : {};
      if (typeof opt.fields === 'object' && opt.fields) {
        Object.keys(opt.fields).forEach((keyName) => {
          if (typeof intentInput[keyName] === 'undefined') return;
          let newKeyName = opt.fields[keyName];
          if (newKeyName === true) {
            payload[keyName] = intentInput[keyName];
          } else if (typeof newKeyName === 'string') {
            payload[newKeyName] = intentInput[keyName];
          }
        });
      } else {
        payload = Object.assign({}, intentInput, opt.payload);
      }

      if (opt.exclude instanceof Array) {
        for (let i = 0; i < opt.exclude.length; i++) {
          let keyName = opt.exclude[i];
          if (typeof payload[keyName] !== 'undefined') delete payload[keyName];
        }
      }

      this._runHandler(
        'before',
        HANDLER_TYPE.PROXY,
        intentObj,
        action,
        payload
      );
      try {
        let res = await app.dispatcher.dispatch(action, payload, intentObj, true);
        if (typeof res.meta !== 'undefined') {
          intentObj.setMeta(res.meta);
        }
        if (typeof res.result !== 'undefined') {
          intentObj.result(res.result);
        }
      } catch (e) {
        intentObj.error(app.error(e.error || e));
        this._runHandler(
          'after',
          HANDLER_TYPE.PROXY,
          intentObj,
          action,
          payload
        );
      }
      if (done) return done();
    }

    /*
     * The first thing we do when an intent is incoming, we have to run all its
     * stack.
     * */
    async _runStack(intentObj, onComplete) {
      intentObj.on('end', () => {
        for (let i = 0; i < this.#ends.length; i++) {
          try {
            this.#ends[i](intentObj);
          } catch (e) {
            console.log('thorin.action: end() callback threw an error in action ' + this.name, this.#ends[i]);
            console.log(e);
          }
        }
      });
      let err;
      try {
        for (let i = 0, len = this.#stack.length; i < len; i++) {
          let item = this.#stack[i];
          await this.#runStackItem(item, intentObj);
          if (intentObj.completed) break;
        }
      } catch (e) {
        err = e;
      }
      // handle async/with callback
      if (onComplete) return onComplete(err);
      if (err) throw err;
    }

    /**
     * Run an individual stack item.
     * */
    #runStackItem = async (item, intentObj) => {
      if (intentObj.completed) return;
      /** Check the FILTER handler */
      if (item.type === HANDLER_TYPE.VALIDATE_FILTER) {
        this._runHandler('before', HANDLER_TYPE.VALIDATE_FILTER, intentObj, null, item.value);
        let err;
        try {
          await app.dispatcher.validateIntentFilter(intentObj, item.value);
        } catch (e) {
          err = e;
        }
        this._runHandler('after', HANDLER_TYPE.VALIDATE_FILTER, intentObj, null, item.value, err);
        if (err) throw err;
        return;
      }
      /** Check the VALIDATE handler. */
      if (item.type === HANDLER_TYPE.VALIDATE) {
        this._runHandler('before', HANDLER_TYPE.VALIDATE, intentObj, null, item.value);
        let err;
        try {
          await app.dispatcher.validateIntent(intentObj, item.value);
        } catch (e) {
          err = e;
        }
        this._runHandler('after', HANDLER_TYPE.VALIDATE, intentObj, null, item.value, err);
        if (err) throw err;
        return;
      }
      /** Check the MIDDLEWARE handler*/
      if (item.type === HANDLER_TYPE.MIDDLEWARE) {
        let middlewareObj = app.dispatcher.getMiddleware(item.name);
        if (!middlewareObj) {
          console.log('thorin.action._runStack: dispatcher does not have a middleware called ' + item.name + ' for action ' + this.name);
          return;
        }
        /* CHECK if we should run the middleware (if it has a condition) */
        if (typeof item.condition === 'function') {
          let shouldRun;
          try {
            shouldRun = item.condition(intentObj);
          } catch (e) {
            console.log('thorin.action._runStack: use(' + item.fn.name + ') function threw an error in middleware condition of action ' + this.name);
            return;
          }
          if (shouldRun !== true) return;
        }
        this._runHandler('before', HANDLER_TYPE.MIDDLEWARE, intentObj, item.name);
        let err;
        try {
          await middlewareObj._runStack(intentObj, commonUtil.cloneOpt(item.opt));
        } catch (e) {
          err = e;
        }
        this._runHandler('after', HANDLER_TYPE.MIDDLEWARE, intentObj, item.name, err);
        if (err) throw err;
        return;
      }
      /** Check the AUTHORIZE handler */
      if (item.type === HANDLER_TYPE.AUTHORIZE) {
        let authObj = app.dispatcher.getAuthorization(item.name);
        if (!authObj) {
          console.log('thorin.action._runStack: dispatcher does not have an authorization called ' + item.name + ' for action ' + this.name);
          return;
        }
        /* CHECK if we should run the middleware (if it has a condition) */
        if (typeof item.condition === 'function') {
          let shouldRun;
          try {
            shouldRun = item.condition(intentObj);
          } catch (e) {
            console.log('thorin.action._runStack: use(' + item.fn.name + ') function threw an error in authorization condition of action ' + this.name);
            return;
          }
          if (shouldRun !== true) return;
        }
        this._runHandler('before', HANDLER_TYPE.AUTHORIZE, intentObj, item.name);
        let err;
        try {
          await authObj._runStack(intentObj, commonUtil.cloneOpt(item.opt));
        } catch (e) {
          err = e;
        }
        this._runHandler('after', HANDLER_TYPE.AUTHORIZE, intentObj, item.name, err);
        if (err) throw err;
        return;
      }

      /** Check the USE functionality */
      if (item.type === HANDLER_TYPE.USE) {
        return new Promise((resolve, reject) => {
          let wasCallCompleted = false;

          // when the intent ends or when the first next() is called, we stop this call.
          function doneWrap(e) {
            if (wasCallCompleted) return;
            wasCallCompleted = true;
            if (e) return reject(e);
            resolve();
          }

          intentObj.on('end', doneWrap);
          try {
            let p = item.fn(intentObj, doneWrap, commonUtil.cloneOpt(item.opt));
            if (commonUtil.isPromise(p)) {
              p.catch(doneWrap);
            }
          } catch (e) {
            console.log('thorin.action._runStack: use(' + item.fn.name + ') function threw an error in action ' + this.name);
            console.log(e);
            doneWrap(app.error(e));
          }
        });
      }

      /** By default, run the custom type */
      return new Promise((resolve, reject) => {
        let wasCallCompleted = false;

        // when the intent ends or when the first next() is called, we stop this call.
        function doneWrap(e) {
          if (wasCallCompleted) return;
          wasCallCompleted = true;
          if (e) return reject(e);
          resolve();
        }

        try {
          let p = this._runCustomType(intentObj, item, doneWrap);
          if (commonUtil.isPromise(p)) {
            p.catch(doneWrap);
          }
        } catch (e) {
          console.log('thorin.action._runCustomType: use(' + item.fn.name + ') function threw an error in action ' + this.name);
          console.log(e);
          doneWrap(app.error(e));
        }
      });
    }

    /** The template() function is overridden by the dispatcher, so that it
     * can control how to extend an action with its template */
    template(name) {
      this.#templates.push(name);
      return this;
    }

    /**
     * This function is called whenever this action wants to include stuff
     * from another action template.
     * */
    _extendFromParent(parentObj) {
      // extend stack
      this.#stack = parentObj.stack.concat(this.#stack);
      this.#ends = parentObj.ends.concat(this.#ends);
      if (this.#hasDebug !== false) {
        this.#hasDebug = parentObj.hasDebug;
      }
      // extend before events.
      Object.keys(parentObj.events.before || {}).forEach((name) => {
        if (!this.#events.before[name]) this.#events.before[name] = [];
        this.#events.before[name] = parentObj.events.before[name].concat(this.#events.before[name]);
      });
      // extend after events.
      Object.keys(parentObj.events.after || {}).forEach((name) => {
        if (!this.#events.after[name]) this.#events.after[name] = [];
        this.#events.after[name] = parentObj.events.after[name].concat(this.#events.after[name]);
      });
      // extend the root, if any.
      let fullRoot = this.root;
      if (parentObj.root !== '') {
        let beforeRoot = parentObj.root;
        if (beforeRoot.charAt(beforeRoot.length - 1) === '/') {
          beforeRoot = beforeRoot.substr(0, beforeRoot.length - 1);
        }
        fullRoot = beforeRoot + fullRoot;
        if (fullRoot.charAt(fullRoot.length - 1) === '/') fullRoot = fullRoot.substr(0, fullRoot.length - 1);
        this.root = fullRoot;
      }
      if (fullRoot !== '') {
        for (let i = 0; i < this.#aliases.length; i++) {
          let item = this.#aliases[i];
          // CHECK if we have "/" in the name. If we do, we have to normalize the path.
          if (item.name.charAt(0) !== '/') item.name = '/' + item.name;
          this.#aliases[i].name = fullRoot + item.name;
        }
      }
      // extend exposed req/res if any
      if (parentObj.exposeRequest === true) this.exposeRequest = true;
      if (parentObj.exposeResponse === true) this.exposeResponse = true;
      if (parentObj.aliasOnly) this.aliasOnly = true;
    }

  }

  commonUtil.expose(ThorinAction, {
    HANDLER_TYPE
  });

  return ThorinAction;
};

