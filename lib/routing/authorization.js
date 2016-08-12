'use strict';
const async = require('async');
/**
 * Created by Adrian on 03-Apr-16.
 *
 * This is a thorin Authorization class. Its sole purpose is to callback with error, or attach
 * some data in the intent.
 * code.
 */
module.exports = function(thorin) {

  const use = Symbol(),
    validate = Symbol(),
    end = Symbol();

  class ThorinAuthorization {

    constructor(name) {
      this.name = name;
      this[validate] = [];  // array of validations to the intent input
      this[use] = [];   // an array of functions to use.
      this[end] = [];   // array of end symbols.
    }

    get stack() {
      return this[use];
    }
    get validate() {
      return this[validate];
    }

    /*
     * Register an intent input validator.
     * A validator item must be an object, and its keys are the intent's input keys.
     * */
    input(item) {
      if(typeof item === 'object' && item) {
        this[validate].push(item);
      }
      return this;
    }

    /*
    * Registers a use callback. Use callbacks must be pure functions, and not string.s
    * */
    use(fn) {
      if(typeof fn !== 'function') {
        console.error('Thorin.Authorization: use() function ' + fn + ' must be a function');
      } else {
        this[use].push(fn);
      }
      return this;
    }

    end(fn) {
      if(typeof fn !== 'function') {
        console.error('Thorin.Authorization: end() function ' + fn + ' must be a function');
      } else {
        this[end].push(fn);
      }
      return this;
    }

    /*
    * Runs the use function stack with the given intent.
    * */
    _runStack(intentObj, opt, onDone) {
      let calls = [];
      intentObj.on('end', () => {
        for(let i=0; i < this[end].length; i++) {
          try {
            this[end][i](intentObj);
          } catch(e) {
            console.error('Thorin.authorization: end() callback threw an error in authorization ' + this.name, this[end][i]);
            console.error(e);
          }
        }
      });
      /* step one, for each validation, we have to include it in the calls. */
      this[validate].forEach((item) => {
        calls.push((done) => {
          if(intentObj.completed) return done();
          thorin.dispatcher.validateIntent(intentObj, item, done);
        });
      });
      this[use].forEach((fn) => {
        calls.push((done) => {
          try {
            fn(intentObj, done, opt);
          } catch(e) {
            console.error('Thorin.action.runStack: use('+fn.name+') function threw an error in authorization '+ this.name);
            console.trace(e);
            return done(thorin.error(e));
          }
        });
      });
      async.series(calls, onDone);
    }

  }

  return ThorinAuthorization;
};
