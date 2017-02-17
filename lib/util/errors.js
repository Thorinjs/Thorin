'use strict';
/**
 * Created by Adrian on 20-Mar-16.
 */

/* This is a ThorinError that extends the default Error  */
class ThorinGenericError extends Error {

  constructor(_code, _message) {
    super();
    this.code = (_code || "GENERIC_ERROR");
    this.message = (_message || "An error occurred.");
    this.statusCode = 400;
    if (typeof this.code === 'string') {
      this.ns = (this.code.indexOf('.') === -1 ? 'GLOBAL' : this.code.split('.')[0]);
    } else {
      this.ns = 'GENERIC_ERROR';
    }
    // this.data -> the data attached.
    // this.source -> the parent error.
  }

  get name() {
    return 'ThorinGenericError'
  }

  get stack() {
    return this.getStack();
  }

  getStack() {
    if (!this.source) return this.stack;
    return this.source.stack;
  }

  toJSON() {
    let d = {
      code: this.code,
      ns: this.ns,
      message: this.message
    };
    if (this.data) {
      d['data'] = this.data;
    }
    try {
      if (this.source && this.source.fields) {
        d.fields = this.source.fields;
      } else if(this.fields) {
        d.fields = this.fields;
      }
    } catch (e) {
    }
    if (this.statusCode) {
      d.status = this.statusCode;
    }
    return d;
  }
}

/*
 * Prepares to get attached to thorin.error
 * */


module.exports = {
  generic: ThorinGenericError
};
