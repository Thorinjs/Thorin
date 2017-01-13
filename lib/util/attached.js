'use strict';
/**
 * Created by Adrian on 20-Mar-16.
 * These are attached utilities on the thorin root app.
 */
const async = require('async');
const ThorinError = require('./errors'),
  FetchInit = require('./fetch');

module.exports = function AttachUtilities(app) {

  /*
   * This is an error constructor. It will basically create an error,
   * with an errorCode, message and additional options.
   * Ways to call:
   *   thorin.error(code=string)
   *   thorin.error(code=string, message=string)
   *   thorin.error(code=string, message=string, statusCode=number)
   *   thorin.error(code=string, message=string, errorInstance=error)
   *   thorin.error(errorInstance) -> this will not expose any error messages.
   * */
  function thorinErrorWrapper(a, b, c, d) {
    if (a instanceof ThorinError.generic) return a;
    if (a instanceof Error) {
      let e = new ThorinError.generic(a.code || 'GENERIC_ERROR');
      e.source = a;
      if (a.statusCode) {
        e.statusCode = a.statusCode;
        if (a.message) {
          e.message = a.message;
        }
      } else {
        e.statusCode = 500;
      }
      // Check if we have a Sequelize error.
      return e;
    }
    if (typeof a === 'string' && !b && !c) { // code
      return new ThorinError.generic(a);
    }
    if (typeof a === 'string' && typeof b === 'string' && !c) {  //code,message
      let e = new ThorinError.generic(a, b);
      if (typeof d === 'number') {
        e.statusCode = d;
      }
      return e;
    }
    if (typeof a === 'string' && typeof b === 'string' && typeof c === 'number') { // code,message,statusCode
      let e = new ThorinError.generic(a, b);
      e.statusCode = c;
      if (typeof d === 'object' && d != null) {
        e.data = d;
      }
      return e;
    }
    if (typeof a === 'string' && typeof b === 'string') {
      let e = new ThorinError.generic(a, b);
      if (c instanceof Error) {
        e.source = c;
      } else if (typeof c === 'object' && c != null) {
        e.data = c;
      }
      if (typeof d === 'number') {
        e.statusCode = d;
      }
      return e;
    }
    return new ThorinError.generic();
  }

  app.error = function thorinError() {
    let e = thorinErrorWrapper.apply(this, arguments);
    return app.parseError(e);
  };

  /*
   * Performs a series call through the array of items.
   * The items can contain:
   *   a. functions that return promises, in which case we wait for their resolving.
   *   b. undefined, in which case we just call and forget.
   *   Ways to call:
   *     thorin.series(items=[], stopOnError=false) - we will call all the items, regardless if they fail or not. By default, we stop on errors.
   *     thorin.series(items=[], onComplete=function(), stopOnError=false) -> will not return a promise, but work with callbacks.
   *     if you call thorin.series([arrayOfItems], true)
   * */
  app.series = function PromiseSeries(items, _onComplete, _stopOnError) {
    if (!(items instanceof Array)) throw new Error('thorin.series: requires an array as the first argument.');
    let onComplete = (typeof _onComplete === 'function' ? _onComplete : false),
      stopOnError = (_onComplete === false ? false : (_stopOnError !== false));
    if (onComplete) {
      return doSeries(items, stopOnError, (e, r) => {
        try {
          onComplete(e, r);
        } catch (err) {
          console.error(`Thorin.series() encountered an error in final callback`);
          console.trace(err);
        }
      });
    }
    return new Promise((resolve, reject) => {
      doSeries(items, stopOnError, (e) => {
        if (e) {
          reject(e);
          return null;
        }
        resolve();
        return null;
      });
    });
  };
  function doSeries(items, stopOnError, finalFn) {
    if (items.length === 0) return finalFn();
    let calls = [],
      isStopped = false,
      currentNext,
      stopError;

    function stopSeries(e) {
      if (typeof e !== 'undefined') {
        stopError = app.error(e);
      }
      isStopped = true;
      if (currentNext) {
        currentNext();
      }
      return null;
    }

    items.forEach((fn) => {
      if (typeof fn !== 'function') return;
      calls.push((done) => {
        if (isStopped) return done();
        let promiseObj;
        currentNext = done;
        try {
          promiseObj = fn(stopSeries);
        } catch (e) {
          if (stopOnError) {
            return done(e);
          }
          return done();
        }
        let isDone = false;
        if (typeof promiseObj === 'object' && promiseObj && typeof promiseObj.then === 'function' && typeof promiseObj.catch === 'function') {
          promiseObj.then((res) => {
            if (isDone || isStopped) return null;
            isDone = true;
            done(null, res);
            return null;
          }, (e) => {
            if (isDone || isStopped) return null;
            isDone = true;
            if (stopOnError) {
              done(e);
              return null;
            }
            done();
            return null;
          });
          promiseObj.catch((e) => {
            if (isDone || isStopped) return null;
            isDone = true;
            if (stopOnError) {
              done(e);
              return null;
            }
            done();
            return null;
          });
          return null;
        } else {
          if (isDone || isStopped) return;
          isDone = true;
          done();
          return null;
        }
      });
    });
    async.series(calls, (e) => {
      if (isStopped) {
        if (stopError) {
          finalFn(stopError);
          return null;
        }
        finalFn();
        return null;
      }
      if (e) {
        finalFn(e);
        return null;
      }
      finalFn();
      return null;
    });
  }

  /*
   * Exposes a thorin.fetcher() function that performs thorin-based /dispatch actions to external sources.
   * The main difference between this and thorin.fetch() is that this will perform ONLY POST requests
   * to a single endpoint (the one given) with a payload of {type, payload}
   * */
  const fetchObj = FetchInit(app);
  app.fetcher = fetchObj.fetcher;

  /*
   * Exposes a thorin.fetch() which is a wrapper over the node-fetch module.
   * */
  app.fetch = fetchObj.fetch;
  app.Error = ThorinError.generic;
};
