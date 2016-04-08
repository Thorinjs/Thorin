'use strict';
/**
 * Created by Adrian on 03-Apr-16.
 * The Thorin Intent class is used to defined incoming events or actions.
 * Transports will then match intents based on their actions and
 * validate them.
 */
module.exports = function init(thorin) {
  const input = Symbol(),
    rawInput = Symbol(),
    data = Symbol(),
    client = Symbol(),
    error = Symbol(),
    authorization = Symbol(),
    onSend = Symbol(),
    rootData = Symbol(),
    rawResult = Symbol(),
    timeStart = Symbol(),
    timeEnd = Symbol(),
    events = Symbol(),
    eventsFired = Symbol(),
    result = Symbol();

  const INTENT_EVENTS = {
    END: 'end'
  };

  class ThorinIntent {

    constructor(actionType, rawInputData, onIntentSend) {
      this.completed = false;
      this.proxied = false; // if the default onIntentSend callback was changed.
      this.action = actionType;
      this[rawInput] = rawInputData;
      this[rawResult] = false;  // raw results will not send an object, with {result:}, but the actual value of .result()
      this[events] = {};    // this is our mini event handler. with only .on('event', oneFunctionCall)
      this[eventsFired] = {}; // a hash of {eventName:true}
      this[timeStart] = Date.now();
      this[timeEnd] = null;
      this[data] = {};  // we can attach data to it.
      this[input] = {}; // input data
      this[result] = null;  // output data
      this[rootData] = null;  // pagination data
      this[error] = null;   // error info
      this[authorization] = null; // authorization data
      this[client] = {};  // incoming client data.
      this[onSend] = onIntentSend;
    }

    /* Sets the authorization information for this intent.
     * The authorization information is set at the transport level, depending
     * on the source of it.
     * As an example, HTTP transports may place the Authorization: "Bearer {token}" header value
     * as the authorization data.
     * */
    set authorization(val) {
      if (this[authorization] != null) {
        console.error('Thorin.Intent: authorization information already set for intent on action ' + this.action);
        return;
      }
      this[authorization] = val;
    }

    get authorization() {
      return this[authorization];
    }

    get rawInput() {
      return this[rawInput];
    }

    /*
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
      if(this.proxied) {
        console.warn('Thorin.Intent: intent for action ' + this.action + ' is already proxied.');
        return this;
      }
      this.proxied = true;
      let oldSend = this[onSend];
      this[onSend] = function ProxySend() {
        this[onSend] = oldSend;
        try {
          proxyFn.apply(this, arguments);
        } catch(e) {
          console.error('Thorin.intent: proxy function on intent action ' + this.action + ' threw an error.');
          this.error(thorin.error(e));
          this.send();
        }
      }.bind(this);
      this.proxied = true;
      return this;
    }


    /* Event handler ON: will call the function only once. */
    on(eventName, fn) {
      if (typeof fn !== 'function') {
        console.error('Thorin.intent: .on(eventName, fn), fn is not a function.');
        return this;
      }
      if (this[eventsFired][eventName]) {
        try {
          fn();
        } catch (e) {
          console.error('Thorin.Intent: triggered event ' + eventName + ' on callback function threw an exception.');
          console.error(e);
        }
        return this;
      }
      if (typeof this[events][eventName] === 'undefined') this[events][eventName] = [];
      this[events][eventName].push(fn);
      return this;
    }

    /*
     * Sets/gets specific client information.
     * */
    client(key, val) {
      if (typeof key === 'object' && key) {
        Object.keys(key).forEach((a) => {
          this.client(a, key[a]);
        });
        return this;
      }
      if (typeof key === 'undefined') return this[client];
      if (typeof key === 'string' && typeof val === 'undefined') return (typeof this[client][key] === 'undefined' ? null : this[client][key]);
      this[client][key] = val;
      return this;
    }

    /*
     * Get/Set additional data to it.
     * */
    data(name, _val) {
      if (typeof name !== 'string') return this[data];
      if (typeof name === 'string' && typeof _val === 'udnefined') return this[data][name] || null;
      this[data][name] = _val;
      return this;
    }

    /*
     * Getter/setter for input data.
     * */
    input(name, _val) {
      if (typeof name === 'undefined') return this[input];
      if (typeof name === 'string' && typeof _val === 'undefined') {
        return this[input][name] || null;
      }
      if (typeof name === 'string' && typeof _val !== 'undefined') {
        this[input][name] = _val;
        return this;
      }
      return null;
    }

    /* Checks if the intent is an error yet. */
    hasError() {
      return (this[error] != null);
    }

    /* Checks if we have any result */
    hasResult() {
      return (this[result] != null);
    }

    /*
    * Sets the raw result of the intent. Raw results will send the result as is,
    * without wrapping it into an object.
    * */
    rawResult(val) {
      if(typeof val === 'undefined') return;
      this[rawResult] = true;
      this[result] = val;
      return this;
    }

    /*
     * Get/set result information
     * */
    result(name, val) {
      if(name instanceof Array) {
        this[result] = name;
        return this;
      }
      if (typeof name === 'object' && name) {
        if(typeof name.getDataValue === 'function') { // ignore objects that have toJSON, as the transport will take care of it.
          this[result] = name;
          return this;
        }
        Object.keys(name).forEach((key) => {
          this.result(key, name[key]);
        });
        return this;
      }
      if (typeof name === 'string' && !(this[result] instanceof Array)) {
        if (typeof val === 'undefined') {
          return (typeof this[result][name] === 'undefined' ? null : this[result][name]);
        }
        if (this[result] == null) this[result] = {};
        this[result][name] = val;
        return this;
      }
      if(typeof name === 'undefined') {
        return this[result];
      }
      return this;
    }

    /*
     * Sets pagination data or other information that will be used in the root object.. The pagination data will be included in the base response,
     * right next to id and result.
     * TODO: this should work with a thorin.Pagination
     * */
    rootData(data, val) {
      if (typeof data === 'object') {
        Object.keys(data).forEach((k) => {
          this.rootData(k, data[k]);
        });
        return this;
      }
      if (typeof data === 'string') {
        if (typeof val === 'undefined') {
          return (typeof this[rootData][data] === 'undefined' ? null : this[rootData][data]);
        }
        if (this[rootData] == null) this[rootData] = {};
        this[rootData][data] = val;
        return this;
      }
      return this;
    };


    /*
     * Marks the intent as error. We can set the error only once.
     * */
    error(err) {
      if (typeof err === 'undefined') return this[error];
      if (this[error]) return this;
      if (err instanceof Error && err.name.indexOf('Thorin') !== 0) {
        err = thorin.error(err);
      }
      this[error] = err;
      return this;
    }

    /*
     * Returns the number of ms it took for the intent to end.
     * */
    get took() {
      if (!this[timeEnd]) return 0;
      return this[timeEnd] - this[timeStart];
    }

    /*
     * Ends the current intent, responding with the result back to the transport layer.
     * */
    send(obj) {
      if(this.proxied) {
        this.proxied = false;
        this[onSend].apply(this, arguments);  // proxy the send.
        return;
      }
      if (this.completed) {
        console.error('Thorin.intent: already completed for action ' + this.action);
        return this;
      }
      if (!this[rawResult] && typeof obj === 'object' && obj != null) {
        if (obj instanceof Error && !this.hasError()) {
          this.error(obj);
        } else if (!this.hasResult()) {
          this.result(obj);
        }
      }
      this[timeEnd] = Date.now();
      this.completed = true;
      const intentResult = {
        "action": this.action
      };
      if (this.hasError()) {
        intentResult.error = this.error();
        triggerEvent.call(this, INTENT_EVENTS.END);
        if (typeof this[onSend] === 'function') {
          this[onSend](true, intentResult, this);
        } else {
          return intentResult;
        }
      } else {
        // IF we have a raw result, we just send it.
        if(this[rawResult] === true) {
          triggerEvent.call(this, INTENT_EVENTS.END);
          if (typeof this[onSend] === 'function') {
            this[onSend](false, this[result], this);
          } else {
            return this[result];
          }
          return;
        }

        // set any pagination data.
        if (this[rootData] != null) {
          Object.keys(this[rootData]).forEach((k) => {
            if(k === 'result' || k === "action") return;
            if (typeof intentResult[k] !== 'undefined') return;
            intentResult[k] = this[rootData][k];
          });
        }
        if (this.hasResult()) {
          intentResult.result = this.result();
        }
        triggerEvent.call(this, INTENT_EVENTS.END);
        if (typeof this[onSend] === 'function') {
          this[onSend](false, intentResult, this);
        } else {
          return intentResult;
        }
      }
    }

    /*
     * Intent destructor
     * */
    destroy() {
      this[data] = null;
      this[rawInput] = null;
      this[input] = null;
      this[result] = null;
      this[error] = null;
      this[authorization] = null;
      this[client] = null;
      this[rootData] = null;
      this[events] = {};
      this[eventsFired] = {};
      delete this[onSend];
    }
  }
  ThorinIntent.EVENT = INTENT_EVENTS;

  /*
   * This is called by the intent to trigger an event
   * Event triggering is only for the intent to fire.
   * */
  function triggerEvent(eventName, _args) {
    if (typeof this[events][eventName] === 'undefined') return;
    for (let i = 0; i < this[events][eventName].length; i++) {
      try {
        this[events][eventName][i](_args);
      } catch (e) {
        console.error('Thorin.Intent: triggered event ' + eventName + ' on callback function threw an exception.');
        console.error(e);
      }
    }
    this[eventsFired][eventName] = true;
    delete this[events][eventName];
  }

  return ThorinIntent;
};