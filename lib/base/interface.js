'use strict';
/**
 * These are our basic Thorin-component interfaces
 * Whenever a plugin,store or transport wants to integrate with thorin,
 * they need to extend these interfaces.
 * */
const Interface = {
  Module: require('../../interface/module'),
  Sanitizer: require('../../interface/sanitizer'),
  Store: require('../../interface/store'),
  Transport: require('../../interface/transport')
};
module.exports = Interface;
