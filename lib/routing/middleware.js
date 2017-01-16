'use strict';
/**
 * Created by Adrian on 03-Apr-16.
 *
 * This is a thorin Middleware class. It gives a sense of organisation for
 * code.
 */
const async = require('async');
module.exports = function (thorin) {

  const validate = Symbol(),
    use = Symbol(),
    filter = Symbol(),
    end = Symbol();

  class ThorinMiddleware {

    constructor(name) {
      this.name = name;
      this[validate] = [];  // array of validations to the intent input
      this[filter] = [];
      this[end] = [];     // array of fns to run
      this[use] = [];   // an array of functions/middlewares to use.
    }

    get stack() {
      return this[use];
    }

    get validate() {
      return this[validate];
    }

    get _filter() {
      return this[filter];
    }

    /*
     * Register an intent input validator.
     * A validator item must be an object, and its keys are the intent's input keys.
     * */
    input(item) {
      if (typeof item === 'object' && item) {
        this[validate].push(item);
      }
      return this;
    }

    filter(item) {
      if (typeof item === 'object' && item) {
        this[filter].push(item);
      }
      return this;
    }

    /*
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
        this[use].push(item);
      } else if (typeof name === 'function') {
        let item = {
          fn: name,
          opt: opt || {}
        }
        if (typeof conditionFn === 'function') item.condition = conditionFn;
        this[use].push(item);
      }
      return this;
    }

    /* Registers a middleware to be run after intent has completed. */
    end(fn) {
      this[end].push(fn);
      return this;
    }

    /*
     * Runs all the functionality that was previously registered with the given intentObj.
     * */
    _runStack(intentObj, opt, onDone) {
      let calls = [];
      /* step one, for each validation, we have to include it in the calls. */
      this[filter].forEach((item) => {
        calls.push((done) => {
          if (intentObj.completed) return done();
          thorin.dispatcher.validateIntentFilter(intentObj, item, done);
        });
      });
      this[validate].forEach((item) => {
        calls.push((done) => {
          if (intentObj.completed) return done();
          thorin.dispatcher.validateIntent(intentObj, item, done);
        });
      });

      /* Step two: for each use() we try to call it. */
      this[use].forEach((item) => {
        if (item.name) { // we have an external middleware.
          let middlewareObj = thorin.dispatcher.getMiddleware(item.name);
          if (!middlewareObj) {
            console.error('Thorin.middleware.runStack: dispatcher does not have a middleware called ' + item.name + ' for middleware ' + this.name);
            return;
          }
          calls.push((done) => {
            if (intentObj.completed) return done();
            /* CHECK if we should run the middleware (if it has a condition) */
            if (typeof item.condition === 'function') {
              let shouldRun;
              try {
                shouldRun = item.condition(intentObj);
              } catch (e) {
                console.error('Thorin.middleware._runStack: use(' + item.fn.name + ') function threw an error in middleware condition for ' + this.name);
                return done();
              }
              if (shouldRun !== true) return done();
            }
            middlewareObj._runStack(intentObj, item.opt, done);
          });
          return;
        }
        // We have a normal fn.
        if (item.fn) {
          calls.push((done) => {
            if (intentObj.completed) return done();
            try {
              item.fn(intentObj, done, opt);
            } catch (e) {
              console.error('Thorin.middleware.runStack: use(' + item.fn.name + ') function threw an error in middleware ' + this.name);
              done(thorin.error(e));
            }
          });
        }
      });
      async.series(calls, (e) => {
        calls = null;
        intentObj.on('end', () => {
          for (let i = 0; i < this[end].length; i++) {
            try {
              this[end][i](intentObj);
            } catch (e) {
              console.error('Thorin.middleware: end() callback threw an error in middleware ' + this.name, this[end][i]);
              console.error(e);
            }
          }
        });
        onDone(e);
      });
    }

  }

  return ThorinMiddleware;
};
