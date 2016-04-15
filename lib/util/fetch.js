'use strict';
const nodeFetch = require('node-fetch');
/**
 * Created by Adrian on 15-Apr-16.
 * We can define a set of fetcher sources, which we use to
 * fetch data.
 */
module.exports = function(thorin) {

  const fetchers = {};

  /*
   * Creates a new fetcher instance.
   * */
  function createFetcher(url, opt, _name) {
    let thorinVersion = thorin.version.split('.');
    thorinVersion.pop(); //remove latest .
    thorinVersion = thorinVersion.join('.');
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'thorin/' + thorinVersion
    };
    if (typeof opt.authorization === 'string') {
      let authToken = opt.authorization;
      delete opt.authorization;
      headers['Authorization'] = 'Bearer ' + authToken;
    }
    opt = thorin.util.extend({
      method: 'POST',
      follow: 1,
      timeout: 40000,
      headers: headers
    }, opt);

    function fetcher(action, _payload) {
      return fetcher.dispatch.apply(this, arguments);
    }

    /*
     * Handles the fetcherObj.dispatch(actionName, _payload)
     * */

    function doDispatch(action, _payload, done) {
      let bodyPayload = {
        type: action,
        payload: {}
      };
      if(typeof _payload === 'object' && _payload) {
        bodyPayload.payload = _payload;
      }
      try {
        bodyPayload = JSON.stringify(bodyPayload);
      } catch(e) {
        return done(thorin.error('FETCH.DATA', 'Failed to stringify fetch payload.', e, 400));
      }
      let fetchOptions = thorin.util.extend({
        body: bodyPayload
      }, opt);
      let statusCode;
      nodeFetch(url, fetchOptions).then((res) => {
        statusCode = res.status;
        return res.json();
      }).then((resultData) => {
        if(statusCode >= 200 && statusCode <= 299) {
          delete resultData.type;
          return done(null, resultData);
        }
        const errData = resultData.error || {},
          msg = errData.message || 'Failed to execute fetch',
          status = errData.status || 400,
          code = (errData.code || 'FETCH.ERROR');
        let err = thorin.error(code, msg, status)
        err.ns = 'FETCH';
        done(err);
      }).catch((e) => {
        let msg = '',
          status = 400,
          code = 'FETCH.';
        if (e) {
          if(e instanceof SyntaxError) {
            code += 'RESPONSE';
            msg = 'Fetch received invalid data.';
          } else {
            switch (e.type) {
              case 'request-timeout':
                code += 'TIMEOUT';
                msg = 'Fetch request timed out.';
                break;
              default:
                code += 'ERROR';
                msg = 'Failed to fetch data.';
                status = statusCode || 400;
            }
          }
        }
        done(thorin.error(code, msg, status, e));
      });
    }

    fetcher.dispatch = function dispatch(action, _payload, _fn) {
      let args = Array.prototype.slice.call(arguments);
      if (typeof args[args.length - 1] === 'function') {
        return doDispatch.apply(this, args);
      }
      return new Promise((resolve, reject) => {
        doDispatch(action, _payload, (e, res) => {
          if (e) return reject(e);
          resolve(res);
        });
      });
    }

    if (_name) {
      /* Destroys the fetcher. */
      fetcher.destroy = function DestroyFetcher() {
        delete fetchers[_name];
      }
    }

    return fetcher;
  }

  /*
   * thorin.fetcher() will create a Fetch() instance, configured to work
   * with the thorin's HTTP transport /dispatch endpoint. Thorin.fetcher
   * uses https://www.npmjs.com/package/node-fetch, so any options that it uses
   * will be available in opt
   * OPTIONS:
   *   - authorization: the Bearer {TOKEN} authorization header.
   * Arguments:
   *   thorin.fetcher("http://mydomain.com/dispatch", {fetchOptions})
   *   thorin.fetcher("myFetcher") => getter of a previous fetcher
   *   thorin.fetcher("myFetcher", 'http://mydomain.com/dispatch', {}) -> creates a new fetcher, saves & returns it.
   *   thorin.fetcher("myFetcher", "myAction", {payload}) => returns the fetcher with that name and calls the fetch.
   * */
  return function fetcher(name, url, opt) {
    if (typeof name === 'string' && name.indexOf('://') === -1) {
      let fetcherObj = fetchers[name] || null;
      if(typeof url === 'undefined') {  // thorin.fetcher(name)
        return fetcherObj;
      }
      // thorin.fetcher('name', 'action', {payload})
      if(typeof url === 'string' && fetcherObj) {
        return fetcherObj.dispatch(url, opt);
      }
    }
    // thorin.fetcher("https://domain.com/dispatch", {myOpt}) -> create a fetcher that will not be cached.
    if (typeof name === 'string' && typeof url === 'object' && url) {
      return createFetcher(name, url);
    }
    // thorin.fetcher("myFetcher", "http://john.com/dispatch", {myOpt}) -> create a fetcher that will be cached.
    if (typeof name === 'string' && typeof url === 'string') {
      if (typeof opt !== 'object' || !opt) opt = {};
      let fetcherObj = createFetcher(url, opt, name);
      if (typeof fetchers[name] !== 'undefined') {
        console.error('Thorin.fetcher: fetcher ' + name + ' already cached. Skipping caching.');
      } else {
        fetchers[name] = fetcherObj;
      }
      return fetcherObj;
    }
    console.warn('Thorin.fetcher: invalid call for fetcher()');
    return thorin;
  }
}