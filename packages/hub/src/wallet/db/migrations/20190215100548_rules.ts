import * as Knex from 'knex';
import { addAddressCheck } from '../utils';

const TABLE_NAME = 'rules';

exports.up = (knex: Knex) => {
  return knex.schema
    .createTable(TABLE_NAME, table => {
      table.increments();
      table
        .string('address')
        .notNullable()
        .unique();
      table
        .string('name')
        .notNullable()
        .unique();
    })
    .then(() => {
      return addAddressCheck(knex, TABLE_NAME, 'address');
    });
};

exports.down = (knex: Knex) => knex.schema.dropTable(TABLE_NAME);
