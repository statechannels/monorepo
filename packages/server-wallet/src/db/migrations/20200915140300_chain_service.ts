import * as Knex from 'knex';

const channels = 'channels';
const chainServiceRequests = 'chain_service_requests';
const fundingStrategy = 'funding_strategy';

export async function up(knex: Knex): Promise<any> {
  await knex.schema.alterTable(channels, table => {
    table.specificType(chainServiceRequests, 'text[]').notNullable();
    table.string(fundingStrategy).notNullable();
  });

  await knex.raw(`\
    ALTER TABLE ${channels}
    ADD CONSTRAINT valid_chain_service_requests
    CHECK (
      ${chainServiceRequests} <@ ARRAY['fund']
    )
  `);
}

export async function down(knex: Knex): Promise<any> {
  await knex.schema.alterTable(channels, table => {
    table.dropColumn(chainServiceRequests);
    table.dropColumn(fundingStrategy);
  });
}
