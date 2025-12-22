'use strict';
const nodeFetch = require('node-fetch');
const http = require('http');
const https = require('https');
/**
 * We can define a set of fetcher sources, which we use to
 * fetch data.
 */
module.exports = function (app) {
  let httpAgentAlive,
    httpsAgentAlive,
    httpAgentSingle,
    httpsAgentSingle;

  const fetchers = {};
  let thorinVersion = '2';

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
    opt = app.util.extend({
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
    async function doDispatch(action, payload = {}, options = {}) {
      let bodyPayload = {
        type: action,
        payload
      };
      try {
        bodyPayload = JSON.stringify(bodyPayload);
      } catch (e) {
        throw app.error('FETCH.DATA', 'Failed to stringify fetch payload.', e, 400);
      }
      let fetchOptions = app.util.extend({
        body: bodyPayload,
        headers: {
          connection: 'keep-alive'
        }
      }, opt, options);
      if (options.agent) {
        fetchOptions.agent = options.agent;
      }
      let statusCode,
        resultData;
      try {
        let fObj = await nodeFetch(url, fetchOptions);
        statusCode = fObj.status;
        resultData = await fObj.json();
      } catch (e) {
        if (e.ns) throw e;
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
        let tErr = app.error(code, msg, status, e);
        if (e?.data) tErr.data = e.data;
        tErr.source = e;
        throw tErr;
      }
      if (statusCode >= 200 && statusCode <= 299) {
        if (resultData.type) {
          delete resultData.type;
        }
        return resultData;
      }
      const errData = resultData.error || {},
        msg = errData.message || 'Failed to execute fetch',
        status = errData.status || 400,
        code = (errData.code || 'FETCH.ERROR');
      let err = app.error(code, msg, status);
      err.ns = err.code.indexOf('.') === -1 ? 'FETCH' : err.code.split('.')[0];
      if (errData.data) err.data = errData.data;
      err.source = errData;
      throw err;
    }

    fetcher.dispatch = function dispatch(action, payload, opt) {
      let args = Array.prototype.slice.call(arguments);
      if (typeof args[args.length - 1] === 'function') {
        let fn = args.pop();
        doDispatch(action, payload, opt)
          .then((r) => fn(null, r))
          .catch((e) => fn(e, null));
        return;
      }
      return doDispatch(action, payload, opt);
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
   * app.fetcher() will create a Fetch() instance, configured to work
   * with the thorin's HTTP transport /dispatch endpoint. app.fetcher
   * uses https://www.npmjs.com/package/node-fetch, so any options that it uses
   * will be available in opt
   * OPTIONS:
   *   - authorization: the Bearer {TOKEN} authorization header.
   * Arguments:
   *   app.fetcher("http://mydomain.com/dispatch", {fetchOptions})
   *   app.fetcher("myFetcher") => getter of a previous fetcher
   *   app.fetcher("myFetcher", 'http://mydomain.com/dispatch', {}) -> creates a new fetcher, saves & returns it.
   *   app.fetcher("myFetcher", "myAction", {payload}) => returns the fetcher with that name and calls the fetch.
   * */
  const fetcherObj = {};
  fetcherObj.fetcher = function fetcher(name, url, opt) {
    if (typeof name === 'string' && name.indexOf('://') === -1) {
      let fetcherObj = fetchers[name] || null;
      if (typeof url === 'undefined') {  // app.fetcher(name)
        return fetcherObj;
      }
      // app.fetcher('name', 'action', {payload})
      if (typeof url === 'string' && fetcherObj) {
        return fetcherObj.dispatch(url, opt);
      }
    }
    // app.fetcher("https://domain.com/dispatch", {myOpt}) -> create a fetcher that will not be cached.
    if (typeof name === 'string' && typeof url === 'object' && url) {
      return createFetcher(name, url);
    }
    // app.fetcher("myFetcher", "http://john.com/dispatch", {myOpt}) -> create a fetcher that will be cached.
    if (typeof name === 'string' && typeof url === 'string') {
      if (typeof opt !== 'object' || !opt) opt = {};
      let fetcherObj = createFetcher(url, opt, name);
      if (typeof fetchers[name] !== 'undefined') {
        console.log('Thorin.fetcher: fetcher ' + name + ' already cached. Skipping caching.');
      } else {
        fetchers[name] = fetcherObj;
      }
      return fetcherObj;
    }
    console.log('Thorin.fetcher: invalid call for fetcher()');
  }

  /*
   * This is a wrapper over the node-fetch request-like fetcher.
   * ARGUMENTS:
   *
   * */
  fetcherObj.fetch = function DoFetch(url, opt, done) {
    if (typeof url !== 'string') {
      console.log('Thorin.fetch() requires the URL as the first argument.');
      throw app.error('FETCH.URL', 'Invalid or missing URL');
    }
    if (typeof opt !== 'object' || !opt) opt = {};
    const headers = {
      'User-Agent': 'thorin/' + thorinVersion
    };
    if (typeof opt.authorization === 'string') {
      headers['Authorization'] = opt.authorization;
      delete opt.authorization;
    }
    let fetchAgent = opt.agent;
    opt = app.util.extend({
      follow: 10,
      timeout: 40000,
      keepAlive: false,
      headers: headers
    }, opt);
    if (fetchAgent) {
      opt.agent = fetchAgent;
    } else if (typeof opt.keepAlive === 'boolean') {
      let isAlive = opt.keepAlive;
      delete opt.keepAlive;
      opt.agent = function (_parsedURL) {
        if (_parsedURL.protocol === 'http:') {
          if (isAlive) {
            if (!httpAgentAlive) {
              httpAgentAlive = new http.Agent({
                keepAlive: true
              });
            }
            return httpAgentAlive;
          }
          if (!httpAgentSingle) {
            httpAgentSingle = new http.Agent({
              keepAlive: false
            });
          }
          return httpAgentSingle;
        }
        if (isAlive) {
          if (!httpsAgentAlive) {
            httpsAgentAlive = new https.Agent({
              keepAlive: true
            });
          }
          return httpsAgentAlive;
        }
        if (!httpsAgentSingle) {
          httpsAgentSingle = new https.Agent({
            keepAlive: false
          });
        }
        return httpsAgentSingle;
      }
    }
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
      isDone = false,
      isJson = false;
    if (opt.json === true) {
      isJson = true;
      delete opt.json;
    }
    nodeFetch(url, opt).then((res) => {
      statusCode = res.status;
      if (statusCode >= 200 && statusCode < 400) {
        if (!isJson) {
          isDone = true;
          return done(null, res);
        }
        return res.json().then((json) => {
          if (isDone) return;
          isDone = true;
          done(null, json);
        });
      }
      let contentType = res.headers.get('content-type');
      if (contentType && contentType.indexOf('/json') !== -1) {
        return res.json().then((err) => {
          if (isDone) return;
          isDone = true;
          let errData = {};
          if (typeof err === 'object' && err) {
            if (typeof err.error === 'object' && err.error) {
              errData = err.error;
            } else {
              errData.error = err;
            }
          }
          let msg = errData.message || 'Failed to contact server',
            status = errData.status || statusCode,
            code = errData.code || 'FETCH.ERROR';
          let tErr = app.error(code, msg, status, (typeof err === 'object' && err && !err.error ? err : null));
          tErr.ns = code.indexOf('.') === -1 ? 'FETCH' : code.split('.')[0];
          if (errData.data) tErr.data = errData.data;
          if (errData.error) tErr.error = errData.error;
          isDone = true;
          done(tErr);
        });
      }
      return res.text().then((text) => {
        if (isDone) return;
        isDone = true;
        let tErr = app.error('FETCH.ERROR', 'Could not contact server', statusCode);
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
      let tErr = app.error(code, msg, status, e);
      if (!tErr.data) tErr.data = {};
      tErr.data.url = url;
      tErr.source = e;
      done(tErr);
    });
  }

  return fetcherObj;
}
