'use strict';
const commonUtil = require('../util/common');

/**
 * This is a thorin Authorization class. Its sole purpose is to callback with error, or attach
 * some data in the intent.
 * code.
 */
module.exports = function init(app) {

  const HANDLER_TYPE = {
    FILTER: 'filter',
    VALIDATE: 'validate',
    USE: 'use'
  };

  class ThorinAuthorization {

    #validate = [];  // array of validations to the intent input
    #filter = []   // array of filter validations
    #use = [];   // an array of functions to use.
    #end = [];   // array of end symbols.

    constructor(name) {
      this.name = name;
    }

    get stack() {
      return this.#use;
    }

    get validate() {
      return this.#validate;
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
     * Registers a use callback. Use callbacks must be pure functions, and not string.s
     * */
    use(fn) {
      if (typeof fn !== 'function') {
        console.log('Thorin.Authorization: use() function ' + fn + ' must be a function');
      } else {
        this.#use.push(fn);
      }
      return this;
    }

    end(fn) {
      if (typeof fn !== 'function') {
        console.log('Thorin.Authorization: end() function ' + fn + ' must be a function');
      } else {
        this.#end.push(fn);
      }
      return this;
    }

    /**
     * Runs the use function stack with the given intent.
     * */
    async _runStack(intentObj, opt, onDone) {
      intentObj.on('end', () => {
        for (let i = 0; i < this.#end.length; i++) {
          try {
            this.#end[i](intentObj);
          } catch (e) {
            console.log('Thorin.authorization: end() callback threw an error in authorization ' + this.name, this.#end[i]);
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
        for (let i = 0, len = this.#use.length; i < len; i++) {
          if (intentObj.completed) break;
          let fn = this.#use[i];
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
     * Private function to run stack item.
     * */
    #runStackItem = async (item, intentObj, type) => {
      if (type === HANDLER_TYPE.FILTER) {
        await app.dispatcher.validateIntentFilter(intentObj, item);
        return;
      }
      if (type === HANDLER_TYPE.VALIDATE) {
        await app.dispatcher.validateIntent(intentObj, item);
      }
      if (type === HANDLER_TYPE.USE) {
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
            console.log('thorin.authorization._runStack: use(' + item.fn.name + ') function threw an error in authorization ' + this.name);
            console.log(e.stack);
            doneWrap(app.error(e));
          }
        });
      }
    };

  }

  return ThorinAuthorization;
};
