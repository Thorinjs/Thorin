'use strict';
const thorinFetch = require('./lib/util/fetch');
const extend = require('extend'),
  ThorinError = require('./lib/util/errors');
/*
* This is the raw thorin fetcher
* */
const wrapper = {
  util: {
    extend: (source) => {
      let target = {};
      let args = Array.prototype.slice.call(arguments);
      args.reverse();
      args.push(target);
      args.push(true);
      args = args.reverse();
      return extend.apply(extend, args);
    }
  },
  error: (code, message, status) => {
    let e = new ThorinError.generic(code, message);
    if (typeof status === 'number') {
      e.statusCode = status;
    }
    e.ns = 'FETCH';
    return e;
  }
};
module.exports = thorinFetch(wrapper).fetch;
