
module.exports = {
  'store.sql.username': '$ENV:SQL_USER',
  'store.sql.password': "$ENV:SQL_PASSWORD",
  "store.sql.database": "$ARG:DATABASE",

  "store.redis.optCache.username": "JohnDoe",

  "lib.myLibrary": {
    key: 'myKey',
    secret: '$ENV:LIB_SECRET' // this gets merged with lib default configs.
  },
  lib: {
    thisAlso: 'works'
  }
};