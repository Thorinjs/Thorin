/* crux-equivalent with sequelize support. */
module.exports = (model, db) => {

  model.tableName('anotherTable');
  model.option('updatedAt', false)
    .option('createdAt', false);

  model
    .field('id', model.PRIMARY, {
      autoIncrement: true
    })
    .field('another_field', model.STRING(30), {
      defaultValue: 'something'
    });

  model
    .belongsTo('something', {
      as: 'sometinh',
      foreignKey: 'something_id'
    })
    .hasMany('somethingElse', {
      as: 'many'
    });

  model
    .method(function getSomething() {

    });

  

  model.static('key', 'value');
  model.static('functionName', function() {

  });

  model.hook('beeforeSomething', function() {
    return Promise.resolve(); // promise support.
  });

};