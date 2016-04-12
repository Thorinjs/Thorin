'use strict';
/**
 * Created by Adrian on 03-Apr-16.
 *
 * The Thorin Action will register prerequisits for an intent to be processed.
 * It can be viewed as the classical "Route", but with a fancy name.
 */
const async = require('async');
module.exports = function(thorin) {
  const HANDLER_TYPE = {
    AUTHORIZE: 'authorize',
    VALIDATE: 'validate',
    MIDDLEWARE: 'middleware',
    USE: 'use'
  };
  class ThorinIntentAction {

    constructor(name) {
      this.isTemplate = false;
      this.root = ""; // the root that is applied for aliases.
      this.name = name;
      this.aliases = [];
      this.stack = [];
      //this.templates = []; placed at first template() call
      this.ends = [];  // an array of end fns to call when the intent finalizes.
      this.events = {
        before: {},  // a hash of {handlerType: [fns]}
        after: {}   // same as before
      };
    }

    /*
     * Sets an alias to this action.
     * An alias will be typically used by the HTTP transport to
     * map url requests to this action.
     * NOTE:
     * template actions that call the alias() will set the root alias name
     * of the template action. Any other actions that extend this template
     * will have their aliases prepended by this.
     * */
    alias(verb, name) {
      if (this.isTemplate === true) {
        if (typeof verb !== 'string') {
          console.error('Thorin.alias: root alias of template must be a string for template ' + this.name);
          return this;
        }
        this.root = verb;
      } else {
        if (typeof  verb !== 'string' || typeof name !== 'string') {
          console.error('Thorin.alias: verb and alias must be a string for action ' + this.name);
          return this;
        }
        this.aliases.push({
          verb: verb,
          name: name
        });
      }
      return this;
    }

    /*
     * Registers an authorization handler.
     * Authorization handlers are registered through dispatcher.addAuthorization
     * and are named ones. The action authorize() function works only with strings.
     * Usage:
     *   actionObj.authorize('some.authorization', {options})
     * */
    authorize(authName, opt) {
      if (typeof authName !== 'string') {
        console.error('Thorin.action: authorization ' + authName + " of action " + this.name + ' is not a string.');
        return this;
      }
      if (authName instanceof Array) {
        for (let i = 0; i < authName.length; i++) {
          if (typeof authName[i] !== 'string') continue;
          let item = {
            type: HANDLER_TYPE.AUTHORIZE,
            name: authName[i],
            opt: {}
          };
          this.stack.push(item);
        }
        return this;
      }
      let item = {
        type: HANDLER_TYPE.AUTHORIZE,
        name: authName,
        opt: (typeof opt === 'undefined' ? {} : opt)
      };
      this.stack.push(item);
      return this;
    }

    /*
     * Registers a "BEFORE" handler.
     * Before handlers are synchronous functions that are called before specific
     * points in the execution stack. Typically, we have a before(HANDLER_TYPE, fn)
     * Usage:
     *   actionObj.before('validate', (intentObj) => {})
     *   actionObj.before('middleware', 'middlewareName', () => {})
     * */
    before(type, a, b) {
      return addHandler.call(this, 'before', type, a, b);
    }

    after(type, a, b) {
      return addHandler.call(this, 'after', type, a, b);
    }

    /*
     * Adds a new input data validator.
     * Usage:
     *     actionObj.input({
     *       myKey: dispatcher.sanitize("STRING")
     *     })
     * */
    input(obj) {
      if (typeof obj !== 'object' || !obj) {
        console.error('Thorin.action: validator must be a key-value object for action ' + this.name);
        return this;
      }
      let item = {
        type: HANDLER_TYPE.VALIDATE,
        value: obj
      };
      this.stack.push(item);
      return this;
    }

    /*
     * This handler is the one that should be particular to the action.
     * An action can use()
     *   - an array of middleware names (with no options passed to them)
     *   - a middleware name and pass the middleware options to it
     *   - a callback function that will be used within the action handler.
     *   Usage:
     *     actionObj.use('my.middleware', {withMy: 'options'})
     *     actionObj.use(['my:middleware', 'some.other.middleware']
     *     actionObj.use((intentObj) => {});
     * */
    use(fn, a) {
      if (typeof fn === 'function') {  // use an fn()
        let item = {
          type: HANDLER_TYPE.USE,
          fn: fn
        };
        this.stack.push(item);
        return this;
      }
      if (fn instanceof Array) { // array of middleware names.
        for (let i = 0; i < fn.length; i++) {
          if (typeof fn[i] === 'string') {
            let item = {
              type: HANDLER_TYPE.MIDDLEWARE,
              name: fn[i],
              opt: {}
            };
            this.stack.push(item);
          }
        }
        return this;
      }
      if (typeof fn === 'string') {  // a middleware name with options?
        let item = {
          type: HANDLER_TYPE.MIDDLEWARE,
          name: fn,
          opt: (typeof a === 'undefined' ? {} : a)
        };
        this.stack.push(item);
        return this;
      }
      console.warn('Thorin.action: invalid usage of use() for action ' + this.name);
      return this;
    }

    /*
     * Registers an end callback. Similar to the ones in middleware,
     * an end callback will be called whenever the intent will complete.
     * */
    end(fn) {
      if (typeof fn !== 'function') {
        console.error('Thorin.action: invalid function for end() for action ' + this.name);
        return this;
      }
      this.ends.push(fn);
      return this;
    }

    /*
    * Plugins or other components can actually insert functionality into thorin.Action.
    * All they have to do is override the "_runCustomType" function of the action
    * and whenever a custom action that is not in the default handler types will be registered,
    * it will be processed.
    *
    * By default, we do not process the requested action.
    * */
    _runCustomType(intentObj, item, done) {
      done();
    }

    /*
     * The first thing we do when an intent is incoming, we have to run all its
     * stack.
     * */
    _runStack(intentObj, onComplete) {
      let calls = [];
      this.stack.forEach((item) => {
        /* Check the VALIDATE handler. */
        if (item.type === HANDLER_TYPE.VALIDATE) {
          calls.push((done) => {
            if (intentObj.completed) return done();  // skip, we completed.
            this._runHandler('before', HANDLER_TYPE.VALIDATE, intentObj, null, item.value);
            thorin.dispatcher.validateIntent(intentObj, item.value, (e) => {
              this._runHandler('after', HANDLER_TYPE.VALIDATE, intentObj, null, item.value, e);
              done(e);
            });
          });
          return;
        }
        /* Check the MIDDLEWARE handler*/
        if (item.type === HANDLER_TYPE.MIDDLEWARE) {
          let middlewareObj = thorin.dispatcher.getMiddleware(item.name);
          if (!middlewareObj) {
            console.error('Thorin.action._runStack: dispatcher does not have a middleware called ' + item.name + ' for action ' + this.name);
            return;
          }
          calls.push((done) => {
            if (intentObj.completed) return done();  // skip, we completed.
            this._runHandler('before', HANDLER_TYPE.MIDDLEWARE, intentObj, item.name);
            middlewareObj._runStack(intentObj, item.opt, (e) => {
              this._runHandler('after', HANDLER_TYPE.MIDDLEWARE, intentObj, item.name, e);
              done(e);
            });
          });
          return;
        }

        /* Check the AUTHORIZE handler */
        if (item.type === HANDLER_TYPE.AUTHORIZE) {
          let authObj = thorin.dispatcher.getAuthorization(item.name);
          if (!authObj) {
            console.error('Thorin.action._runStack: dispatcher does not have an authorization called ' + item.name + ' for action ' + this.name);
            return;
          }
          calls.push((done) => {
            if (intentObj.completed) return done();  // skip, we completed.
            this._runHandler('before', HANDLER_TYPE.AUTHORIZE, intentObj, item.name);
            authObj._runStack(intentObj, item.opt, (e) => {
              this._runHandler('after', HANDLER_TYPE.AUTHORIZE, intentObj, item.name, e);
              done(e);
            });
          });
          return;
        }

        /* check the USE functionality */
        if (item.type === HANDLER_TYPE.USE) {
          let wasCallCompleted = false;
          calls.push((done) => {
            if (intentObj.completed) return done();  // skip, we completed.
            // when the intent ends or when the first next() is called, we stop this call.
            function doneWrap(e) {
              if (wasCallCompleted) return;
              wasCallCompleted = true;
              done(e);
            }

            intentObj.on('end', doneWrap);
            try {
              item.fn(intentObj, doneWrap);
            } catch (e) {
              console.error('Thorin.action._runStack: use('+item.fn.name+') function threw an error in action '+ this.name);
              console.error(e);
              doneWrap(thorin.error(e));
            }
          });
          return;
        }

        /* Otherwise, we have a different kind of type that was inserted by a plugin. */
        calls.push((done) => {
          this._runCustomType(intentObj, item, done);
        });
      });
      async.series(calls, (err) => {
        calls = null;
        intentObj.on('end', () => {
          for (let i = 0; i < this.ends.length; i++) {
            try {
              this.ends[i](intentObj);
            } catch (e) {
              console.error('Thorin.action: end() callback threw an error in action ' + this.name, this.ends[i]);
              console.error(e);
            }
          }
        });
        onComplete(err);
      });
    }

    /*
     * Triggers a before() registered callback for the given event and intentObj.
     * */

    /* The template() function is overridden by the dispatcher, so that it
     * can control how to extend an action with its template */
    template(name) {
      if(typeof this.templates === 'undefined') this.templates = [];
      this.templates.push(name);
      return this;
    }

    /*
     * This function is called whenever this action wants to include stuff
     * from another action template.
     * */
    _extendFromTemplate(targetData) {
      // extend stack
      this.stack = targetData.stack.concat(this.stack);
      this.ends = targetData.ends.concat(this.ends);
      // extend before events.
      Object.keys(targetData.events.before).forEach((name) => {
        if (typeof this.events.before[name] === 'undefined') {
          this.events.before[name] = [];
        }
        this.events.before[name] = targetData.events.before[name].concat(this.events.before[name]);
      });
      // extend after events.
      Object.keys(targetData.events.after).forEach((name) => {
        if (typeof this.events.after[name] === 'undefined') {
          this.events.after[name] = [];
        }
        this.events.after[name] = targetData.events.after[name].concat(this.events.after[name]);
      });
      // extend the root, if any.
      let fullRoot = this.root;
      if(targetData.root !== '') {
        let beforeRoot = targetData.root;
        if(beforeRoot.charAt(beforeRoot.length-1) === '/') {
          beforeRoot = beforeRoot.substr(0, beforeRoot.length-1);
        }
        fullRoot = beforeRoot + fullRoot;
        this.root = fullRoot;
      }
      if (fullRoot) {
        for (let i = 0; i < this.aliases.length; i++) {
          let item = this.aliases[i];
          // CHECK if we have "/" in the name. If we do, we have to normalize the path.
          let newAlias;
          if (targetData.root.indexOf('/') !== -1 || item.name.indexOf('/') !== -1) {
            if (targetData.root.charAt(targetData.length - 1) !== '/' && item.name.charAt(0) !== '/') {
              targetData.root += '/';
            }
            newAlias = targetData.root + item.name;
            newAlias = newAlias.replace(/\\/g, '/'); // replace duplicated slashes.
            // remove final slash.
            if (newAlias.charAt(newAlias.length - 1) === '/') {
              newAlias = newAlias.substr(0, newAlias.length - 1);
            }
          } else {
            newAlias = targetData.root + item.name;
          }
          this.aliases[i].name = newAlias;
        }
      }
    }

    /*
    * This will run the given event handler, if any fn was registered for it.
    * */
    _runHandler(handlerType, eventName, intentObj, subName, _arg1, _arg2) {
      if (typeof this.events[handlerType][eventName] === 'undefined') return;
      for (let i = 0; i < this.events[handlerType][eventName].length; i++) {
        let item = this.events[handlerType][eventName][i];
        if(typeof subName === 'string') {
          if(typeof item.name === 'string' && item.name !== subName) continue;
        }
        try {
          item.fn(intentObj, _arg1, _arg2);
        } catch (e) {
          console.error('Thorin.action: ' + handlerType + '() called on ' + eventName + (subName ? '[' + subName + ']' : '') + ' caught an error in action ' + this.name);
          console.error(e);
        }
      }
    }
  }

  /* Adds an event handler, either a before or an after */
  function addHandler(handlerType, type, a, b) {
    if (typeof type !== 'string') {
      console.error('Thorin.action: ' + handlerType + ' type ' + type + " of action " + this.name + ' is not a string.');
      return this;
    }
    var item;
    if (type === HANDLER_TYPE.MIDDLEWARE || type === HANDLER_TYPE.AUTHORIZE) {  // we have type, name, fn
      if (typeof a !== 'string' || typeof b !== 'function') {
        console.error('Thorin.action: ' + handlerType + ' middleware "' + a + '" must have syntax: ' + handlerType + '(type, middlewareName, fn) in action ' + this.name);
        return this;
      }
      item = {
        name: a,
        fn: b
      };
    } else {
      item = {};
      if(typeof a === 'function') {
        item.fn = a;
      } else if(typeof a === 'string' && typeof b === 'function') {
        item.name = a;
        item.fn = b;
      }
      if (typeof item.fn !== 'function') {
        console.error('Thorin.action: ' + handlerType + ' "' + type + '" must have syntax: ' + handlerType + '(type, fn) or (type, targetName, fn) in action ' + this.name);
        return this;
      }
    }
    if (typeof this.events[handlerType][type] === 'undefined') {
      this.events[handlerType][type] = [];
    }
    this.events[handlerType][type].push(item);
    return this;
  }
  ThorinIntentAction.HANDLER_TYPE = HANDLER_TYPE;
  return ThorinIntentAction;
};