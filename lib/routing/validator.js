'use strict';
const async = require('async');
/**
 * Created by Adrian on 06-Apr-16.
 * This is the class that is used to validate incoming intent data.
 * This is basically a wrapper over the thorin.sanitize() function, that
 * also allows async sanitization.
 */
module.exports = function(thorin) {

  const defaultError = Symbol(),
    defaultValue = Symbol(),
    promises = Symbol(),
    options = Symbol(),
    callbacks = Symbol();

  class ThorinIntentValidator {

    constructor(sanitizeType) {
      this.type = sanitizeType;
      this[defaultError] = null;
      this[defaultValue] = undefined;
      this[options] = undefined; // the thorin.sanitize() options
      this[promises] = []; // An array of promises that can be attached to the validator.
      this[callbacks] = []; // An array of callbacks that can be attached to the validator.
    }

    get defaultValue() {
      if(typeof this[defaultValue] === 'undefined') return undefined;
      if(typeof this[defaultValue] === 'object' && this[defaultValue]) {
        // make a copy of it.
        return JSON.parse(JSON.stringify(this[defaultValue]));
      }
      return this[defaultValue];
    }

    /*
    * Sets the options that we want to pass to thorin.sanitize(type, input, options)
    * */
    options(opt) {
      if(typeof opt === 'undefined') return this;
      this[options] = opt;
      return this;
    }

    /*
    * Attaches a default value to the intent validator.
    * The default value is used when the validation fails.
    * */
    default(val) {
      if(typeof val !== 'undefined') {
        this[defaultValue] = val;
      }
      return this;
    }

    /*
    * Attaches a default error to the intent validator.
     * The default error is used when the validation fails.
     * NOTE: it is either default() or error(), but not both.
     * */
    error(err, a, b,c,d) {
      if(typeof err === 'string') {
        err = thorin.error(err,a,b,c,d);
      }
      if(typeof err !== 'undefined') {
        this[defaultError] = err;
      }
      if(err.ns === 'GLOBAL') err.ns = 'INPUT';
      return this;
    }

    /*
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
      if(typeof fn !== 'function') {
        console.error('Thorin.sanitize.validate: promise() requires a function as the first argument for validator type ' + this.type);
        return this;
      }
      this[promises].push(fn);
      return this;
    }

    /*
    * Attach a callback to the validator.
    * This works exactly as a promise, but in stead doing the then().catch(), it will pass
    * an onDone callback function to it.
    * */
    callback (fn) {
      if(typeof fn !== 'function') {
        console.error('Thorin.sanitize.validate: callback() requires a function as the first argument for validator type ' + this.type);
        return this;
      }
      this[callbacks].push(fn);
      return this;
    }

    /*
    * Returns the default failed validation error.
    * */
    getFailedError(inputKey) {
      return thorin.error('INPUT.NOT_VALID', 'Invalid value for ' + inputKey, 400)
    }

    /*
    * This is called when we want to apply all the validations.
    * Note: this is an asynchronous operation that will require the onDone() function to be a function.
    * */
    run(inputKey, inputValue, onDone) {
      thorinSanitize.call(this, inputValue, (e, result) => {
        if(e) return handleError.call(this, e, onDone);
        if(typeof result === 'undefined' || result == null) {
          // If we have a default value, use it in stead.
          if(typeof this.defaultValue !== 'undefined') {
            result = this.defaultValue;
          } else {
            // If not, use the default error or the generic one.
            if(this[defaultError]) return onDone(this[defaultError]);
            return onDone(this.getFailedError(inputKey));
          }
        }
        if(this[promises].length === 0 && this[callbacks].length === 0) {
          return onDone(null, result);
        }
        // process the results.
        // first, go with promises
        let calls = [];
        this[promises].forEach((promiseFn) => {
          calls.push((done) => {
            let pObj = promiseFn(result);
            if(typeof pObj !== 'object' || !pObj || !pObj.then) {
              console.error('Thorin.sanitize.validate: promise callback does not return a promise for validator type ' + this.type + ' in key ' + inputKey);
              return done();
            }
            let isDone = false;
            pObj.then((newResult) => {
              if(isDone) return; isDone = true;
              result = newResult;
              done();
            }, (e) => {
              if(isDone) return; isDone = true;
              done(e);
            }).catch((e) => {
              if(isDone) return; isDone = true;
              done(e);
            });
          });
        });
        // continue with callbacks.
        if(this[callbacks].length !== 0) {
          this[callbacks].forEach((fn) => {
            calls.push((done) => {
              fn(inputValue, (e, newResult) => {
                if(e) return done(e);
                result = newResult;
                done();
              });
            })
          });
        }
        async.series(calls, (e) => {
          if(e) return onDone(e);
          onDone(null, result);
        });
      });
    }
  }

  /* Handles an error. */
  function handleError(e, done) {
    if(this.defaultValue) return done(null, this.defaultValue);
    if(this[defaultError]) return done(this[defaultError]);
    done(e);
  }

  /* Calls the thorin sanitizer and checks if it's async or sync */
  function thorinSanitize(input, done) {
    let sanitizeRes = thorin.sanitize(this.type, input, this[options]);
    if(typeof sanitizeRes === 'object' && sanitizeRes != null && typeof sanitizeRes.then === 'function') {
      let isDone = false;
      sanitizeRes.then((result) => {
        if(isDone) return; isDone = true;
        done(null, result);
      }, (e) => {
        if(isDone) return; isDone = true;
        done(e);
      }).catch((e) => {
        if(isDone) return; isDone = true;
        done(e);
      });
      return;
    }
    // otherwise, we have a synchronous value.
    done(null, sanitizeRes);
  }

  return ThorinIntentValidator;

};