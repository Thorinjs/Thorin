'use strict';
/**
 * Created by Adrian on 03-Apr-16.
 *
 * This is a thorin Middleware class. It gives a sense of organisation for
 * code.
 */
const commonUtil = require('../util/common');
const HANDLER_TYPE = {
  FILTER: 'filter',
  VALIDATE: 'validate',
  USE: 'use'
};

module.exports = function init(app) {

  class ThorinMiddleware {

    #validate = [];    // array of validations to the intent input
    #filter = [];
    #end = [];         // array of fns to run
    #use = [];        // an array of functions/middlewares to use

    constructor(name) {
      this.name = name;
    }

    get stack() {
      return this.#use;
    }

    get validate() {
      return this.#validate;
    }

    get end() {
      return this.#end;
    }

    get _filter() {
      return this.#filter;
    }

    /**
     * Register an intent input validator.
     * A validator item must be an object, and its keys are the intent's input keys.
     * */
    input(item) {
      if (typeof item === 'object' && item) {
        this.#validate.push(item);
      }
      return this;
    }

    /**
     * Register an intent filter validator.
     * A validator item must be an object, and its keys are the intent's input keys.
     * */
    filter(item) {
      if (typeof item === 'object' && item) {
        this.#filter.push(item);
      }
      return this;
    }

    /**
     * Middlewares can use other middlewares.
     * Or, they can have as many callback functions as they want,
     * - OPTIONAL: if a conditionFn is specified, the middleware will be executed only when the result of the conditional function is true.
     * Usage:
     *   .use("otherMiddlewareName", {options})
     *     OR
     *   .use("otherMiddlewareName")
     *     OR
     *   .use(function(intentObj, next, opt) {})
     * */
    use(name, opt, conditionFn) {
      if (typeof name === 'string') {
        if (typeof opt !== 'object') opt = {};
        let item = {
          opt: opt,
          name: name
        };
        if (typeof conditionFn === 'function') item.condition = conditionFn;
        this.#use.push(item);
      } else if (typeof name === 'function') {
        let item = {
          fn: name,
          opt: opt || {}
        };
        if (typeof conditionFn === 'function') item.condition = conditionFn;
        this.#use.push(item);
      }
      return this;
    }

    /**
     * Registers an on-end callback function
     * */
    end(fn) {
      if (typeof fn !== 'function') {
        console.log('Thorin.Middleware: end() function ' + fn + ' must be a function for ' + this.name);
      } else {
        this.#end.push(fn);
      }
      return this;
    }

    /**
     * Runs all the functionality that was previously registered with the given intentObj.
     * */
    async _runStack(intentObj, opt, onDOne) {
      intentObj.on('end', () => {
        let ends = this.#end;
        for (let i = 0; i < ends.length; i++) {
          try {
            ends[i](intentObj);
          } catch (e) {
            console.log('Thorin.middleware: end() callback threw an error in authorization ' + this.name, ends[i]);
            console.error(e);
          }
        }
      });
      let err;
      try {
        /* step one, for each validation, we have to include it in the calls. */
        for (let i = 0, len = this.#filter.length; i < len; i++) {
          if (intentObj.completed) break;
          let item = this.#filter[i];
          await this.#runStackItem(item, intentObj, HANDLER_TYPE.FILTER);
        }
        /* Next, go for validates */
        for (let i = 0, len = this.#validate.length; i < len; i++) {
          if (intentObj.completed) break;
          let item = this.#validate[i];
          await this.#runStackItem(item, intentObj, HANDLER_TYPE.VALIDATE);
        }
        /* Finally, run the stack */
        let stack = this.#use;
        for (let i = 0, len = stack.length; i < len; i++) {
          if (intentObj.completed) break;
          let fn = stack[i];
          await this.#runStackItem({
            fn,
            opt: commonUtil.cloneOpt(opt || {})
          }, intentObj, HANDLER_TYPE.USE);
        }
      } catch (e) {
        err = e;
      }
      if (onDone) return onDone(err);
      if (err) throw err;
    }

    /**
     * Runs a single stack item.
     * */
    #runStackItem = async (item, intentObj, type) => {
      if (type === HANDLER_TYPE.FILTER) {
        await app.dispatcher.validateIntentFilter(intentObj, item);
        return;
      }
      if (type === HANDLER_TYPE.VALIDATE) {
        await app.dispatcher.validateIntent(intentObj, item);
        return;
      }
      if (type === HANDLER_TYPE.USE) {
        /* CHECK if we should run the middleware (if it has a condition) */
        if (typeof item.condition === 'function') {
          let shouldRun;
          try {
            shouldRun = item.condition(intentObj);
          } catch (e) {
            console.log('thorin.midleware._runStack: use(' + item.fn.name + ') function threw an error in middleware condition ' + this.name);
            return;
          }
          if (shouldRun !== true) return;
        }
        /* CHECK if we have a name */
        if (item.name) {
          let mObj = app.dispatcher.getMiddleware(item.name);
          if (!mObj) {
            console.log(`thorin.middleware.runStack: middleware [${item.name}] is not registered to be called from ${tihs.name}`);
            return;
          }
          await mObj._runStack(intentObj, commonUtil.cloneOpt(item.opt));
          return;
        }
        /* CHECK if we have normal fn */
        if (item.fn) {
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
              console.log('thorin.middleware._runStack: use(' + item.fn.name + ') function threw an error in authorization ' + this.name);
              console.log(e);
              doneWrap(app.error(e));
            }
          });
        }
      }
    }
  }

  commonUtil.expose(ThorinMiddleware, {
    HANDLER_TYPE
  });

  return ThorinMiddleware;
}

module.exports.HANDLER_TYPE = HANDLER_TYPE;
