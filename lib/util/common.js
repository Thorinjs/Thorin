'use strict';

/**
 * Prints a deprecation warning.
 * */
let _deprecatedShown = {};
exports.deprecate = function deprecate(msg) {
  if (_deprecatedShown[msg]) return;
  _deprecatedShown[msg] = true;
  console.log(_deprecatedShown);
}

/**
 * Simple wrapper over Object.assign() that exposes the given prop
 * on the object, making it non-writable or non-enumerable.
 * */
exports.expose = function expose(obj, props = {}) {
  Object.keys(props || {}).forEach((propName) => {
    Object.defineProperty(obj, propName, {
      value: props[propName],
      enumerable: false,
      writable: true
    });
  });
};

/*
 * Returns a component by its full name.
 * Names:
 * store.{name}, transport.{name}, library.{name}, plugin.{name}
 * */
exports.getComponentByName = function getComponentByName(app, name) {
  let componentType = name.substr(0, name.indexOf('.')).toLowerCase(),
    compName = name.substr(name.indexOf('.') + 1);
  switch (componentType) {
    case 'store':
      return app.store(compName);
    case 'transport':
      return app.transport(compName);
    case 'library':
    case 'lib':
      return app.lib(compName);
    case 'plugin':
      return app.plugin(compName);
    case 'module':
      return app.module(compName);
    default:
      return null;
  }
}
exports.isPromise = function isPromise(res) {
  return (typeof res === 'object' && res && typeof res.then === 'function');
}


module.exports.isArray = function isArray(fn) {
  return (fn instanceof Array);
}

module.exports.isImplemented = function isImplemented(fn, target) {
  return (target.isPrototypeOf(fn));
}


module.exports.isUndefined = function isUndefined(fn) {
  if (typeof fn === 'undefined') return true;
  if (Object.prototype.toString.call(fn) === '[object Undefined]') return true;
  return false;
}

module.exports.isClass = function isClass(fn) {
  if (typeof fn !== 'function') return false;
  let fullFn = fn.toString();
  let cIdx = fullFn.indexOf(' ');
  if (cIdx !== -1 && fullFn.substr(0, cIdx).toLowerCase() === 'class') {
    return true;
  }
  return false;
}

module.exports.isObject = function isObject(o) {
  return (typeof o === 'object' && o);
}

module.exports.isFunction = function isFunction(f) {
  return (typeof f === 'function');
}

/*
* Checks if the given function has an argument.
* */
module.exports.hasFunctionArgument = function hasFunctionArgument(fn) {
  try {
    let fnStr = fn.toString(),
      fnName = fn.name;
    // first, remove the function name, and wait for ()
    let inner = fnStr.substr(fnStr.indexOf(fnName) + fnName.length).trim();
    // callArgs
    let pIdx = inner.indexOf('(');
    if (pIdx === -1) return false;
    inner = inner.substr(pIdx);
    let eIdx = inner.indexOf(')');
    if (eIdx === -1) return false;
    inner = inner.substr(0, eIdx + 1).trim();  // we now should have (args)
    inner = inner.substr(1, inner.length - 2).trim();  // remove ( and )
    inner = inner.replace(/ /g, '');
    if (!inner) return false;
    return true;
  } catch (e) {
    return false;
  }
}

module.exports.cloneOpt = function cloneOpt(opt) {
  try {
    if (typeof opt !== 'object' || !opt) return {};
    let keys = Object.keys(opt);
    for (let i = 0; i < keys.length; i++) {
      let k = keys[i];
      if (typeof opt[k] === 'function') {
        return opt;
      }
    }
    return JSON.parse(JSON.stringify(opt));
  } catch (e) {
    return opt;
  }
}
