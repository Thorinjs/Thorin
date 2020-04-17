'use strict';
global.THORIN_ROOT = __dirname;
const thorin = require('../lib/index');

thorin.run(() => {
  console.log('HAY');
})
