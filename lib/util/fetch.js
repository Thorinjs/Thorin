'use strict';
const nodeFetch = require('node-fetch-abort');
/**
 * Created by Adrian on 15-Apr-16.
 * We can define a set of fetcher sources, which we use to
 * fetch data.
 */
module.exports = function (thorin) {

  const fetchers = {};
  let thorinVersion = '1.x';
  try {
    thorinVersion = thorinthorin.version.split('.');
    thorinVersion.pop(); //remove latest .
    thorinVersion = thorinVersion.join('.');
  } catch(e) {}

  /*
   * Creates a new fetcher instance.
   * */
  function createFetcher(url, opt, _name) {
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
     * NOTE:
     *  giving a "request" callback in the options will
     *  call when the http request object is available.
     * */
    function doDispatch(action, _payload, _options) {
      let bodyPayload = {
        type: action,
        payload: {}
      };
      if (typeof _payload === 'object' && _payload) {
        bodyPayload.payload = _payload;
      }
      let options = (typeof _options === 'object' && _options ? _options : {});
      try {
        bodyPayload = JSON.stringify(bodyPayload);
      } catch (e) {
        return Promise.reject(thorin.error('FETCH.DATA', 'Failed to stringify fetch payload.', e, 400));
      }
      let fetchOptions = thorin.util.extend({
        body: bodyPayload,
        headers: {
          connection: 'keep-alive'
        }
      }, opt, options);
      let statusCode;
      return nodeFetch(url, fetchOptions)
        .then((res) => {
          statusCode = res.status;
          return res.json();
        }).then((resultData) => {
          if (statusCode >= 200 && statusCode <= 299) {
            delete resultData.type;
            return Promise.resolve(resultData);
          }
          const errData = resultData.error || {},
            msg = errData.message || 'Failed to execute fetch',
            status = errData.status || 400,
            code = (errData.code || 'FETCH.ERROR');
          let err = thorin.error(code, msg, status);
          err.ns = 'FETCH';
          if (!err.data) err.data = {};
          err.data.action = action;
          throw err;
        }).catch((e) => {
          if (e && e.ns === 'FETCH') return Promise.reject(e);
          let msg = '',
            status = 400,
            code = 'FETCH.';
          if (e) {
            if (e instanceof SyntaxError) {
              code += 'RESPONSE';
              msg = 'Request data could not be processed.';
            } else {
              switch (e.type) {
                case 'request-timeout':
                  code += 'TIMEOUT';
                  msg = 'Request timed out';
                  break;
                default:
                  code += 'ERROR';
                  msg = 'Could not contact the server';
                  status = statusCode || 400;
              }
            }
          }
          let tErr = thorin.error(code, msg, status, e);
          if (!tErr.data) tErr.data = {};
          tErr.data.action = action;
          return Promise.reject(tErr);
        });
    }

    fetcher.dispatch = function dispatch(action, _payload) {
      let args = Array.prototype.slice.call(arguments);
      if (typeof args[args.length - 1] === 'function') {
        let fn = args.pop();
        return doDispatch
          .apply(this, args)
          .then((r) => {
            fn(null, r);
          })
          .catch((e) => {
            fn(e, null);
          });
      }
      return doDispatch.apply(this, arguments);
    };

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
  const fetcherObj = {};
  fetcherObj.fetcher = function fetcher(name, url, opt) {
    if (typeof name === 'string' && name.indexOf('://') === -1) {
      let fetcherObj = fetchers[name] || null;
      if (typeof url === 'undefined') {  // thorin.fetcher(name)
        return fetcherObj;
      }
      // thorin.fetcher('name', 'action', {payload})
      if (typeof url === 'string' && fetcherObj) {
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

  /*
   * This is a wrapper over the node-fetch request-like fetcher.
   * ARGUMENTS:
   *
   * */
  fetcherObj.fetch = function DoFetch(url, opt, done) {
    if (typeof url !== 'string') {
      console.error('Thorin.fetch() requires the URL as the first argument.');
      return Promise.reject('FETCH.INVALID_URL', 'Invalid or missing URL');
    }
    if (typeof opt !== 'object' || !opt) opt = {};
    const headers = {
      'User-Agent': 'thorin/' + thorinVersion
    };
    if (typeof opt.authorization === 'string') {
      headers['Authorization'] = opt.authorization;
      delete opt.authorization;
    }
    opt = thorin.util.extend({
      follow: 10,
      timeout: 40000,
      headers: headers
    }, opt);
    if (typeof opt.body === 'object' && opt.body) {
      try {
        opt.body = JSON.stringify(opt.body);
        if (!opt.headers['Content-Type']) {
          opt.headers['Content-Type'] = 'application/json';
        }
      } catch (e) {
      }
    }
    let args = Array.prototype.slice.call(arguments);
    if (typeof args[args.length - 1] === 'function') {
      return doFetch(url, opt, args[args.length - 1]);
    }
    if (typeof done === 'function') {
      return doFetch(url, opt, done);
    }
    return new Promise((resolve, reject) => {
      doFetch(url, opt, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  };

  function doFetch(url, opt, done) {
    let statusCode,
      isDone = false;
    nodeFetch(url, opt).then((res) => {
      statusCode = res.status;
      if (statusCode >= 200 && statusCode < 400) {
        isDone = true;
        return done(null, res);
      }
      let contentType = res.headers.get('content-type');
      if (contentType && contentType.indexOf('/json') !== -1) {
        return res.json().then((err) => {
          if (isDone) return;
          isDone = true;
          let errData = {};
          if (typeof err.error === 'object' && err.error) {
            errData = err.error;
          }
          let msg = errData.message || 'Failed to execute fetch',
            status = errData.status || statusCode,
            code = errData.code || 'FETCH.ERROR';
          let tErr = thorin.error(code, msg, status, err);
          tErr.ns = 'FETCH';
          if (!tErr.data) tErr.data = {};
          tErr.data.url = url;
          isDone = true;
          done(tErr);
        });
      }
      return res.text().then((text) => {
        if (isDone) return;
        isDone = true;
        let tErr = thorin.error('FETCH.ERROR', 'Could not contact server', statusCode);
        tErr.data = text;
        isDone = true;
        done(tErr);
      });
    }).catch((e) => {
      if (isDone) return;
      isDone = true;
      let msg = '',
        status = 400,
        code = 'FETCH.';
      if (e) {
        if (e instanceof SyntaxError) {
          code += 'RESPONSE';
          msg = 'Request data could not be processed';
        } else {
          switch (e.type) {
            case 'request-timeout':
              code += 'TIMEOUT';
              msg = 'Request timed out';
              break;
            default:
              code += 'ERROR';
              msg = 'Could not retrieve server data';
              status = statusCode || 400;
          }
        }
      }
      let tErr = thorin.error(code, msg, status, e);
      if (!tErr.data) tErr.data = {};
      tErr.data.url = url;
      done(tErr);
    });
  }

  return fetcherObj;
}
