'use strict';
const commonUtil = require('../util/common');
/**
 * The Thorin Intent class is used to defined incoming events or actions.
 * Transports will then match intents based on their actions and
 * validate them.
 * */
module.exports = function init(app) {

  const INTENT_EVENTS = {
    END: 'end',
    CLOSE: 'close'  // fired when the underlying socket is closed.
  };

  class ThorinIntent {

    #rawInput;
    #proxied;
    #rawFilter;
    #rawMeta;
    #rawResult = false; // raw results will not send an object, with {result:}, but the actual value of .result()
    #events; // mini event handler map
    #eventsFired; // {hash of {eventName:true}}
    #timeStart;
    #timeEnd;
    #data;
    #input;
    #filter;  // filter data
    #meta;    // meta data
    #result = null; // output data
    #metaData = null; // pagination data
    #error = null;    // is it an error
    #authorization = null;  // authorization type.
    #authorizationSource; // what kind of authorization
    #client = {}; // incoming client info
    #onSend;  // the onIntentSend function
    #resultHeaders = null;  // any kind of resultHeaders
    #alias; // intent aliases.

    constructor(actionType, rawInputData, onIntentSend) {
      this.action = actionType;
      this.completed = false;
      this.transport = null;
      this.#rawInput = rawInputData;
      this.#proxied = false;
      this.#timeStart = Date.now();
      this.#data = {};
      this.#input = {};
      this.#onSend = onIntentSend;
    }

    /**
     * Internal function used to trigger intent events.
     * This should only be used by core components/plugins
     * */
    __trigger(eventName, _args) {
      if (!this.#events) return;
      if (!this.#events[eventName]) return;
      for (let i = 0; i < this.#events[eventName].length; i++) {
        try {
          this.#events[eventName][i](_args);
        } catch (e) {
          console.log('Thorin.Intent: triggered event ' + eventName + ' on callback function threw an exception.');
          console.error(e);
        }
      }
      if (!this.#eventsFired) this.#eventsFired = {};
      this.#eventsFired[eventName] = true;
      delete this.#events[eventName];
    }

    get proxied() {
      return this.#proxied;
    }

    /**
     * Sets the authorization information for this intent.
     * The authorization information is set at the transport level, depending
     * on the source of it.
     * As an example, HTTP transports may place the Authorization: "Bearer {token}" header value
     * as the authorization data.
     * */
    _setAuthorization(authSource, authId) {
      if (typeof authSource !== 'string' || !authSource) {
        console.log('thorin.Intent: _setAuthorization(source, id) must contain a valid authorization source');
        return this;
      }
      if (typeof authId === 'undefined') {
        console.log('thorin.Intent: _setAuthorization(source, id) must have an authorization id.');
        return this;
      }
      this.#authorization = authId;
      this.#authorizationSource = authSource;
      return this;
    }

    /**
     * An intent's send() function can be proxied, going through another callback
     * before actually calling the send() function. You can look at this like a
     * call that will be called before the send() function. This proxy function can alter
     * errors or results of the intent.
     * WARNING: When proxying an intent, you MUST call the send() of that intent, otherwise
     * it will not send the response to the client.
     * For example:
     *   intentObj.proxy(function(obj) {
     *     console.log("PROXY WITH", obj);
     *     this.send({something: "else"});
     *   });
     *
     *   /////
     *   intentObj.send({some: "object"})
     * */
    proxy(proxyFn) {
      if (this.#proxied) {
        console.warn('Thorin.Intent: intent for action ' + this.action + ' is already proxied.');
        return this;
      }
      this.#proxied = true;
      let oldSend = this.#onSend,
        self = this;
      this.#onSend = function ProxySend() {
        self.#onSend = oldSend;
        try {
          proxyFn.apply(self, arguments);
        } catch (e) {
          console.log('Thorin.intent: proxy function on intent action ' + self.action + ' threw an error.');
          self.error(app.error(e));
          self.send();
        }
      };
      return this;
    }

    /**
     * When an intent is triggered by the dispatcher, this function gets called asynchronously,
     * in order to asynchronously initiate the intent.
     * A plugin or anybody can override this function to insert itself
     * into it, BEFORE it is actually run through its stack.
     * NOTE:
     *   when overriding it, the function MUST call the callback function with (err|null)
     * */
    runCreate(fn) {
      fn();
    }

    /**
     * This will set some specific headers to be sent to the transport layer.
     * */
    resultHeaders(name, _val) {
      if (typeof name === 'object' && name) {
        if (!this.#resultHeaders) this.#resultHeaders = {};
        Object.keys(name).forEach((key) => {
          this.#resultHeaders[key] = name[key];
        });
        return this;
      }
      if (typeof name === 'undefined') return this.#resultHeaders || {};
      if (typeof name === 'string' && typeof _val === 'undefined') {
        if (!this.#resultHeaders) return null;
        return this.#resultHeaders[name] || null;
      }
      if (typeof name === 'string' && typeof _val !== 'undefined') {
        if (!this.#resultHeaders) this.#resultHeaders = {};
        this.#resultHeaders[name] = _val;
        return this;
      }
      return null;
    }

    /**
     * Event handler ON: will call the function only once.
     * */
    on(eventName, fn) {
      if (typeof fn !== 'function') {
        console.log('thorin.intent: .on(eventName, fn), fn is not a function.');
        return this;
      }
      if (!this.#eventsFired) this.#eventsFired = {};
      if (this.#eventsFired[eventName]) {
        try {
          fn();
        } catch (e) {
          console.log('Thorin.Intent: triggered event ' + eventName + ' on callback function threw an exception.');
          console.error(e);
        }
        return this;
      }
      if (!this.#events) this.#events = {};
      if (!this.#events[eventName]) this.#events[eventName] = [];
      this.#events[eventName].push(fn);
      return this;
    }

    /**
     * Sets/gets specific client information.
     * */
    client(key, val) {
      if (typeof key === 'object' && key) {
        Object.keys(key).forEach((a) => {
          this.#client[a] = key[a];
        });
        return this;
      }
      if (typeof key === 'undefined') return this.#client || {};
      if (typeof key === 'string' && typeof val === 'undefined') {
        if (typeof this.#client[key] === 'undefined') return null;
        return this.#client[key];
      }
      this.#client[key] = val;
      return this;
    }


    /**
     * Get/Set additional data to it.
     * */
    data(name, _val) {
      if (typeof name !== 'string') return this.#data || {};
      if (typeof _val === 'undefined') {
        if (!this.#data) return null;
        if (typeof this.#data[name] === 'undefined') return null;
        return this.#data[name];
      }
      if (!this.#data) this.#data = {};
      this.#data[name] = _val;
      return this;
    }

    /**
     * Getter/setter for input data.
     * */
    input(name, _val) {
      if (typeof name === 'undefined') return this.#input || {};
      if (typeof name === 'string') {
        if (typeof _val === 'undefined') {
          if (!this.#input) return null;
          if (typeof this.#input[name] === 'undefined') return null;
          return this.#input[name];
        }
        if (!this.#input) this.#input = {};
        this.#input[name] = _val;
        // override the rawinput as well.
        if (!this.#rawInput) this.#rawInput = {};
        this.#rawInput[name] = _val;
        return this;
      }
      return null;
    }

    /**
     * Manually override the input
     * */
    _setInput(data) {
      if (typeof data === 'object' && data) {
        this.#input = data;
      }
      return this;
    }

    /**
     * Getter/setter for filter data.
     * */
    filter(name, _val) {
      if (typeof name === 'undefined') return this.#filter || {};
      if (typeof name === 'string') {
        if (typeof _val === 'undefined') {
          if (!this.#filter) return null;
          if (typeof this.#filter[name] === 'undefined') return null;
          return this.#filter[name];
        }
        if (!this.#filter) this.#filter = {};
        this.#filter[name] = _val;
        if (!this.#rawFilter) this.#rawFilter = {};
        this.#rawFilter[name] = _val;
        return this;
      }
      if (typeof name === 'object' && name && typeof _val === 'undefined') {
        this.#filter = name;
        if (!this.#rawFilter) this.#rawFilter = {};
        let _keys = Object.keys(name);
        for (let i = 0, len = _keys.length; i < len; i++) {
          this.#rawFilter[_keys[i]] = name[_keys[i]];
        }
      }
      return null;
    }

    /**
     * Manually set the filter
     * */
    _setFilter(obj) {
      if (typeof obj === 'object' && obj) {
        this.#filter = obj;
      }
      return this;
    }

    /**
     * Getter/setter for meta data.
     * */
    meta(name, _val) {
      if (typeof name === 'undefined') return this.#meta || {};
      if (typeof name === 'string') {
        if (typeof _val === 'undefined') {
          if (!this.#meta) return null;
          if (typeof this.#meta[name] === 'undefined') return null;
          return this.#meta[name];
        }
        if (!this.#meta) this.#meta = {};
        this.#meta[name] = _val;
        if (this.#rawMeta) this.#rawMeta = {};
        this.#rawMeta[name] = _val;
        return this;
      }
      return null;
    }

    /**
     * Manually override the meta
     * */
    _setMeta(data) {
      if (typeof data === 'object' && data) {
        this.#meta = data;
      }
      return this;
    }

    /* Checks if the intent is an error yet. */
    hasError() {
      return (this.#error !== null);
    }

    /* Checks if we have any result */
    hasResult() {
      return (this.#result !== null);
    }

    hasRawResult() {
      return (this.#rawResult === true);
    }

    /**
     * Sets the raw result of the intent. Raw results will send the result as is,
     * without wrapping it into an object.
     * */
    rawResult(val) {
      if (typeof val === 'undefined') return;
      this.#rawResult = true;
      this.#result = val;
      return this;
    }


    /**
     * Manually set the given value as the intent's result. This should not be used by anyone outside the core plugins
     * */
    _setResult(val) {
      if (typeof val === 'undefined') val = null;
      this.#result = val;
      return this;
    }

    /**
     * Get/set result information
     * */
    result(name, val) {
      if (typeof name === 'string' && typeof val === 'undefined') {
        if (!this.#result) return null;
        if (typeof this.#result[name] === 'undefined') return null;
        return this.#result[name];
      }
      if (name instanceof Array) {
        this.#result = name;
        return this;
      }
      if (typeof name === 'object' && name) {
        if (typeof name.getDataValue === 'function') { // ignore objects that have toJSON, as the transport will take care of it.
          this.#result = name;
          return this;
        }
        if (typeof name.toJSON === 'function') {
          this.#result = name.toJSON();
        } else {
          this.#result = {};
          Object.keys(name).forEach((key) => {
            this.result(key, name[key]);
          });
        }
        return this;
      }
      if (typeof name === 'string' && !(this.#result instanceof Array)) {
        if (typeof val === 'undefined') {
          if (!this.#result) return null;
          return (typeof this.#result[name] === 'undefined' ? null : this.#result[name]);
        }
        if (!this.#result) this.#result = {};
        this.#result[name] = val;
        return this;
      }
      if (typeof name === 'undefined') {
        return this.#result;
      }
      return this;
    }

    /**
     * Verify if the current request is made by a mobile browser or not. If the intent does not have any client headers,
     * returns false.
     * This is purely a helper function
     * */
    isMobile() {
      let headers = this.client('headers');
      if (!headers) return false;
      let ua = headers['user-agent'];
      if (typeof ua !== 'string' || !ua) return false;
      if (/mobile/i.test(ua)) return true; //general mobile check
      if (/Android/.test(ua)) return true; // android devices
      if (/iPhone/.test(ua)) return true;
      return false;
    }


    /**
     * Sets pagination data or other information that will be used in the root object.. The pagination data will be included in the base response,
     * right next to id and result.
     * */
    setMeta(data, val) {
      if (typeof data === 'object') {
        if (data == null) {
          this.#metaData = null;
          return this;
        }
        Object.keys(data).forEach((k) => {
          this.setMeta(k, data[k]);
        });
        return this;
      }
      if (typeof data === 'string') {
        if (typeof val === 'undefined') {
          if (!this.#metaData) return null;
          return (typeof this.#metaData[data] === 'undefined' ? null : this.#metaData[data]);
        }
        if (!this.#metaData) this.#metaData = {};
        this.#metaData[data] = val;
        return this;
      }
      return this;
    };

    /**
     * Returns any metadata associated with the intent
     * */
    getMeta() {
      return this.#metaData || {};
    }

    /**
     * Marks the intent as error. We can set the error only once.
     * */
    error(err) {
      if (typeof err === 'undefined') return this.#error;
      if (err instanceof Error && err.name.indexOf('Thorin') !== 0) {
        err = app.error(err);
      }
      this.#error = err;
      return this;
    }

    /*
     * Ends the current intent, responding with the result back to the transport layer.
     * */
    send(obj) {
      if (this.#proxied) {
        this.#proxied = false;
        this.#onSend(obj); // proxy the send.
        return;
      }
      if (this.completed) {
        return this;
      }
      this.#timeEnd = Date.now();
      if (!this.#rawResult && typeof obj === 'object' && obj != null) {
        if (obj instanceof Error && !this.hasError()) {
          this.error(obj);
        } else if (!this.hasResult()) {
          this.result(obj);
        }
      }
      this.completed = true;
      const intentResult = {
        "type": this.action
      };
      if (this.hasError()) {
        intentResult.error = this.error();
        this.__trigger(INTENT_EVENTS.END);
        if (typeof this.#onSend === 'function') {
          this.#onSend(true, intentResult, this);
          this.destroy();
        } else {
          this.destroy();
          return intentResult;
        }
      } else {
        // IF we have a raw result, we just send it.
        if (this.#rawResult === true) {
          this.__trigger(INTENT_EVENTS.END);
          if (typeof this.#onSend === 'function') {
            this.#onSend(false, this.#result, this);
            this.destroy();
          } else {
            this.destroy();
            return this.#result;
          }
          return;
        }

        // set any pagination data.
        if (this.#metaData) {
          intentResult.meta = {};
          Object.keys(this.#metaData).forEach((k) => {
            if (k === 'result' || k === "action") return;
            if (typeof intentResult[k] !== 'undefined') return;
            intentResult.meta[k] = this.#metaData[k];
          });
        }
        if (this.hasResult()) {
          intentResult.result = this.result();
        }
        this.__trigger(INTENT_EVENTS.END);
        if (typeof this.#onSend === 'function') {
          this.#onSend(false, intentResult, this);
          this.destroy();
        } else {
          this.destroy();
          return intentResult;
        }
      }
    }

    /*
     * Intent destructor
     * */
    destroy() {
      this.#data = {};
      this.#rawInput = null;
      if (this.#rawFilter) this.#rawFilter = undefined;
      if (this.#filter) this.#filter = undefined;
      if (this.#rawMeta) this.#rawMeta = undefined
      this.#input = {};
      this.#result = null;
      this.#error = null;
      this.#authorization = null;
      this.#client = {};
      this.#metaData = null;
      this.#events = undefined;
      this.#eventsFired = {}
      this.#resultHeaders = null;
      this.#onSend = undefined;
    }


    /*
     * Returns the number of ms it took for the intent to end.
     * */
    get took() {
      if (!this.#timeEnd) return 0;
      return this.#timeEnd - this.#timeStart;
    }

    get authorization() {
      return this.#authorization;
    }

    set authorization(v) {
      console.log(`thorin.Intent: please use _setAuthorization(source,id)`);
    }

    get authorizationSource() {
      return this.#authorizationSource || null;
    }

    get alias() {
      return this.#alias || null;
    }

    set alias(v) {
      if (this.#alias) return;
      this.#alias = v;
    }

    get rawInput() {
      return this.#rawInput;
    }

    get rawMeta() {
      if (!this.#rawMeta) this.#rawMeta = {};
      return this.#rawMeta;
    }

    hasFilter() {
      if (!this.#rawFilter) return false;
      return true;
    }

    get rawFilter() {
      if (!this.#rawFilter) this.#rawFilter = {};
      return this.#rawFilter;
    }

    __setRawFilter(v) {
      if (typeof v !== 'object' || !v) return this;
      this.#rawFilter = v;
      return this;
    }

    __setRawInput(v) {
      if (typeof v !== 'object' || !v) return this;
      this.#rawInput = v;
      return this;
    }

    __setRawMeta(v) {
      if (typeof v !== 'object' || !v) return this;
      this.#rawMeta = v;
      return this;
    }


  }

  commonUtil.expose(ThorinIntent, {
    EVENT: INTENT_EVENTS
  });

  return ThorinIntent;
}
