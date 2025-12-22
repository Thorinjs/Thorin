'use strict';
/**
 * Created by Adrian on 06-Apr-16.
 * This is the class that is used to validate incoming intent data.
 * This is basically a wrapper over the thorin.sanitize() function, that
 * also allows async sanitization.
 */
module.exports = function init(app) {

  class ThorinIntentValidator {

    #defaultError = null;
    #defaultValue;
    #options;        // the thorin.sanitize() options
    #promises = [];   // An array of promises that can be attached to the validator
    #callbacks = [];  // An array of callbacks that can be attached to the validator
    #fieldName;

    constructor(sanitizeType, _opt = {}) {
      this.type = sanitizeType;
      this.#options = _opt;
    }

    set fieldName(v) {
      this.#fieldName = v;
    }

    get fieldName() {
      return this.#fieldName || null;
    }


    get defaultValue() {
      let dType = typeof this.#defaultValue;
      if (dType === 'undefined') return undefined;
      if (dType === 'object' && this.#defaultValue) {
        // make copy
        return JSON.parse(JSON.stringify(this.#defaultValue));
      }
      return this.#defaultValue;
    }

    /**
     * Clones the current validator.
     * */
    clone(opt = {}) {
      let c = new ThorinIntentValidator(this.type, { ...this.#options, ...opt });
      c.__clone({
        defaultError: this.#defaultError,
        defaultValue: this.#defaultValue,
        promises: this.#promises,
        callbacks: this.#callbacks,
        fieldName: this.#fieldName
      });
      return c;
    }

    /*
    * Internal function to clone from parent data.
    * */
    __clone(d = {}) {
      this.#defaultError = d.defaultError;
      this.#defaultValue = d.defaultValue;
      this.#promises = d.promises.concat([]);
      this.#callbacks = d.callbacks.concat([]);
      this.#fieldName = d.fieldName;
    }

    /**
     * Sets the options that we want to pass to thorin.sanitize(type, input, options)
     * */
    options(opt) {
      if (typeof opt === 'undefined') return this.#options;
      this.#options = opt;
      return this;
    }

    /**
     * Attaches a default value to the intent validator.
     * The default value is used when the validation fails.
     * */
    default(val) {
      if (typeof val === 'undefined') return this.#defaultValue;
      this.#defaultValue = val;
      return this;
    }

    /**
     * Attaches a default error to the intent validator.
     * The default error is used when the validation fails.
     * NOTE: it is either default() or error(), but not both.
     * */
    error(err, a, b, c, d) {
      let eType = typeof err;
      if (eType === 'undefined') return this.#defaultError;
      if (eType === 'string') {
        err = app.error(err, a, b, c, d);
      }
      if (typeof err !== 'undefined') {
        this.#defaultError = err;
      }
      if (err.ns === 'GLOBAL') err.ns = 'DATA';
      return this;
    }

    /**
     * Attach a promise to the validator.
     * When a promise is attached, right after the sanitizer completes and contains an
     * accepted value, we will run the promises with the resulting value.
     * Should the promise fail, we stop the validator. The end result
     * of the validator will be the resolved value of the promise.
     * EX:
     * action.input({
     *   firstName: dispatcher.validate("STRING").default("John").promise((inputStr) => {Promise.resolve("John Doe"})
     * })
     * */
    promise(fn) {
      if (typeof fn !== 'function') {
        console.log('Thorin.sanitize.validate: promise() requires a function as the first argument for validator type ' + this.type);
        return this;
      }
      this.#promises.push(fn);
      return this;
    }

    /**
     * Attach a callback to the validator.
     * This works exactly as a promise, but in stead doing the then().catch(), it will pass
     * an onDone callback function to it.
     * */
    callback(fn) {
      if (typeof fn !== 'function') {
        console.log('Thorin.sanitize.validate: callback() requires a function as the first argument for validator type ' + this.type);
        return this;
      }
      this.#callbacks.push(fn);
      return this;
    }

    /**
     * Returns the default failed validation error.
     * */
    getFailedError(inputKey) {
      return app.error('DATA.INPUT', `Provided value is not valid`, { field: inputKey }, 400);
    }

    /**
     * This is called when we want to apply all the validations.
     * Note: this is an asynchronous operation that will require the onDone() function to be a function.
     * */
    async run(inputKey, inputValue, onDone) {
      let result;
      try {
        result = await app.sanitize(this.type, inputValue, this.#options);
      } catch (e) {
        console.log(e);
        return this.#handleError(e, onDone);
      }
      if (typeof result === 'undefined' || result == null) {
        let _def = this.defaultValue;
        if (typeof _def === 'function') _def = _def(inputValue);
        // If we have a default value, use it in stead.
        if (typeof _def !== 'undefined') {
          // IF our default value is null, result with it.
          if (_def == null) {
            if (onDone) return onDone(null, null);
            return _def;
          }
          result = _def;
        } else {
          // If not, use the default error or the generic one.
          let err = this.#defaultError || this.getFailedError(inputKey);
          if (typeof err.message === 'string' && err.message.indexOf('$') !== -1) {
            let optKeys = Object.keys(this.#options);
            for (let j = 0, jlen = optKeys.length; j < jlen; j++) {
              let oKey = optKeys[j],
                oVal = this.#options[oKey],
                oValType = typeof oVal;
              if (oValType === 'number' || oValType === 'string') {
                err.message = err.message.replace(`$${oKey}`, oVal);
              }
            }
          }
          if (!err.data) err.data = {
            field: inputKey
          };
          if (onDone) return onDone(err);
          throw err;
        }
      }
      // Check if we need to do something async.
      if (this.#promises.length === 0 && this.#callbacks.length === 0) {
        if (onDone) return onDone(null, result);
        return result;
      }
      // first check all promises.
      try {
        for (let i = 0, len = this.#promises.length; i < len; i++) {
          let fn = this.#promises[i];
          result = await fn(result, this.#options);
        }
        // Next with callbacks
        for (let i = 0, len = this.#callbacks.length; i < len; i++) {
          let fn = this.#callbacks[i];
          result = await promisify(fn, result);
        }
      } catch (e) {
        return this.#handleError(e, onDone);
      }
      if (onDone) return onDone(null, result);
      return result;
    }


    /**
     * Handles an error, internally.
     * */
    #handleError = (e, done) => {
      if (typeof this.#defaultValue !== 'undefined') {
        if (done) return done(null, this.#defaultValue);
        return this.#defaultValue;
      }
      let err = this.#defaultError || e;
      if (done) return done(err);
      throw err;
    }

  }

  /*
  * Convert callback to promise
  * */
  function promisify(fn, d) {
    return new Promise((resolve, reject) => {
      let isDone = false;
      try {
        fn(d, function (e, res) {
          if (isDone) return;
          isDone = true;
          if (e) return reject(e);
          resolve(res);
        });
      } catch (e) {
        if (isDone) return;
        isDone = true;
        reject(e);
      }
    });
  }

  return ThorinIntentValidator;
};
